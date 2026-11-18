import type { Project, ProjectTask } from './models';
import type { TaskGraphEdge, TaskEdgeKind } from './task-graph';
import {
  TASK_EDGE_KINDS,
  edgeKey,
  rebuildGraphEdgesFromLegacy,
  stripOrphanTaskReferences,
  taskGraphValidationIssues,
  applyGraphEdgesToLegacyFields,
} from './task-graph';
import { dedupeTaskGraphEdges, graphEdgesForDisplay } from './task-graph-recovery';

export interface GraphRecoveryPending {
  edge: TaskGraphEdge;
  issue: string;
  alternatives: TaskGraphEdge[];
}

export interface GraphRecoverySession {
  active: boolean;
  confirmed_edges: TaskGraphEdge[];
  remaining_candidates: TaskGraphEdge[];
  skipped: TaskGraphEdge[];
  pending?: GraphRecoveryPending;
}

const KIND_PRIORITY: Record<TaskEdgeKind, number> = {
  tree: 0,
  fork: 1,
  join: 2,
  ordering: 3,
  cycle: 4,
};

function isCritiqueTask(task: ProjectTask | undefined): boolean {
  return task?.node_kind === 'critique' || task?.graph_type === 'critique';
}

function sortCandidates(edges: TaskGraphEdge[]): TaskGraphEdge[] {
  return [...edges].sort((left, right) => {
    const kindDelta = (KIND_PRIORITY[left.kind] ?? 9) - (KIND_PRIORITY[right.kind] ?? 9);
    if (kindDelta !== 0) return kindDelta;
    return left.edge_id.localeCompare(right.edge_id);
  });
}

export function collectRecoveryCandidateEdges(project: Project, tasks: ProjectTask[]): TaskGraphEdge[] {
  const display = graphEdgesForDisplay(project, tasks);
  return sortCandidates(display);
}

function isRedundantCandidate(candidate: TaskGraphEdge, confirmed: TaskGraphEdge[]): boolean {
  if (candidate.kind === 'ordering') {
    return confirmed.some(
      (edge) => edge.kind === 'tree'
        && edge.from_task_id === candidate.from_task_id
        && edge.to_task_id === candidate.to_task_id,
    );
  }
  return confirmed.some(
    (edge) => edge.edge_id === candidate.edge_id
      || (edge.from_task_id === candidate.from_task_id
        && edge.to_task_id === candidate.to_task_id
        && edge.kind === candidate.kind),
  );
}

export function buildRecoveryAlternatives(candidate: TaskGraphEdge, tasks: ProjectTask[]): TaskGraphEdge[] {
  const byId = new Map(tasks.map((task) => [task.task_id, task]));
  const from = byId.get(candidate.from_task_id);
  const to = byId.get(candidate.to_task_id);
  const out: TaskGraphEdge[] = [];
  for (const kind of TASK_EDGE_KINDS) {
    const break_condition = kind === 'cycle'
      ? (candidate.break_condition?.trim() || 'human:REVIEW')
      : undefined;
    out.push({
      edge_id: edgeKey(candidate.from_task_id, candidate.to_task_id, kind),
      from_task_id: candidate.from_task_id,
      to_task_id: candidate.to_task_id,
      kind,
      ...(break_condition ? { break_condition } : {}),
    });
  }
  if (isCritiqueTask(from) || isCritiqueTask(to)) {
    out.push({
      edge_id: edgeKey(candidate.from_task_id, candidate.to_task_id, 'cycle'),
      from_task_id: isCritiqueTask(from) ? candidate.from_task_id : candidate.to_task_id,
      to_task_id: isCritiqueTask(from) ? candidate.to_task_id : candidate.from_task_id,
      kind: 'cycle',
      break_condition: 'human:REVIEW',
    });
  }
  return dedupeTaskGraphEdges(out);
}

export function tryAutoResolveEdge(
  candidate: TaskGraphEdge,
  confirmed: TaskGraphEdge[],
  issue: string,
  tasks: ProjectTask[],
): TaskGraphEdge | 'skip' | null {
  if (isRedundantCandidate(candidate, confirmed)) return 'skip';

  const byId = new Map(tasks.map((task) => [task.task_id, task]));
  const from = byId.get(candidate.from_task_id);
  const to = byId.get(candidate.to_task_id);

  if (/Accidental dependency cycle/i.test(issue)) {
    if (candidate.kind === 'ordering') {
      if (isCritiqueTask(from) || isCritiqueTask(to)) {
        const critiqueId = isCritiqueTask(from) ? candidate.from_task_id : candidate.to_task_id;
        const workId = isCritiqueTask(from) ? candidate.to_task_id : candidate.from_task_id;
        return {
          edge_id: edgeKey(critiqueId, workId, 'cycle'),
          from_task_id: critiqueId,
          to_task_id: workId,
          kind: 'cycle',
          break_condition: 'human:REVIEW',
        };
      }
    }
    if (confirmed.some((edge) => edge.kind === 'ordering' && edge.edge_id === candidate.edge_id)) {
      return 'skip';
    }
  }

  if (candidate.kind === 'cycle' && !candidate.break_condition?.trim()) {
    return { ...candidate, break_condition: 'human:REVIEW' };
  }

  if (candidate.kind === 'tree') {
    const legacyOnly = rebuildGraphEdgesFromLegacy(tasks).some(
      (edge) => edge.kind === 'tree'
        && edge.from_task_id === candidate.from_task_id
        && edge.to_task_id === candidate.to_task_id,
    );
    if (legacyOnly) return candidate;
  }

  return null;
}

export function advanceGraphRecoverySession(
  session: GraphRecoverySession,
  tasks: ProjectTask[],
): GraphRecoverySession {
  const taskIds = new Set(tasks.map((task) => task.task_id));
  const next: GraphRecoverySession = {
    ...session,
    pending: undefined,
  };

  while (next.remaining_candidates.length > 0) {
    const candidate = next.remaining_candidates[0]!;
    if (isRedundantCandidate(candidate, next.confirmed_edges)) {
      next.remaining_candidates = next.remaining_candidates.slice(1);
      continue;
    }

    const trial = [...next.confirmed_edges, candidate];
    let issues = taskGraphValidationIssues(trial, taskIds);
    if (issues.length === 0) {
      next.confirmed_edges = trial;
      next.remaining_candidates = next.remaining_candidates.slice(1);
      continue;
    }

    const auto = tryAutoResolveEdge(candidate, next.confirmed_edges, issues[0]!, tasks);
    if (auto === 'skip') {
      next.skipped.push(candidate);
      next.remaining_candidates = next.remaining_candidates.slice(1);
      continue;
    }
    if (auto) {
      const autoTrial = [...next.confirmed_edges, auto];
      issues = taskGraphValidationIssues(autoTrial, taskIds);
      if (issues.length === 0) {
        next.confirmed_edges = autoTrial;
        next.remaining_candidates = next.remaining_candidates.slice(1);
        continue;
      }
    }

    next.pending = {
      edge: candidate,
      issue: issues[0]!,
      alternatives: buildRecoveryAlternatives(candidate, tasks),
    };
    break;
  }

  if (!next.pending && next.remaining_candidates.length === 0) {
    next.active = false;
  }

  return next;
}

export function startInteractiveGraphRecovery(
  project: Project,
  tasks: ProjectTask[],
): { project: Project; tasks: ProjectTask[]; session: GraphRecoverySession } {
  const stripped = stripOrphanTaskReferences(tasks, new Set(tasks.map((task) => task.task_id)));
  const candidates = collectRecoveryCandidateEdges(project, stripped.tasks);

  let session: GraphRecoverySession = project.graph_recovery_session?.active
    ? { ...project.graph_recovery_session }
    : {
        active: true,
        confirmed_edges: [],
        remaining_candidates: candidates,
        skipped: [],
      };

  if (!session.pending) {
    session = advanceGraphRecoverySession(session, stripped.tasks);
  }

  const complete = !session.active && !session.pending;
  const synced = complete
    ? applyGraphEdgesToLegacyFields(stripped.tasks, session.confirmed_edges)
    : stripped.tasks;

  const projectNext: Project = {
    ...project,
    task_graph_edges: session.confirmed_edges,
    ...(complete
      ? {}
      : {
          task_graph_validation_issue: session.pending?.issue
            ?? 'Resolving task graph connections step by step…',
          graph_recovery_session: session,
        }),
  };

  if (complete) {
    delete projectNext.graph_recovery_session;
    delete projectNext.task_graph_validation_issue;
    projectNext.task_graph_edges = session.confirmed_edges;
  }

  return { project: projectNext, tasks: synced, session };
}

export type GraphRecoveryResolution = {
  action: 'apply' | 'skip';
  edge?: TaskGraphEdge;
};

export function resolveGraphRecoverySession(
  session: GraphRecoverySession,
  tasks: ProjectTask[],
  resolution: GraphRecoveryResolution,
): { session: GraphRecoverySession; tasks: ProjectTask[] } {
  if (!session.pending && resolution.action === 'skip') {
    return { session, tasks };
  }

  let next: GraphRecoverySession = { ...session, pending: undefined };
  const pendingEdge = session.pending?.edge;

  if (resolution.action === 'skip') {
    if (pendingEdge) {
      next.skipped = [...next.skipped, pendingEdge];
      if (next.remaining_candidates[0]?.edge_id === pendingEdge.edge_id) {
        next.remaining_candidates = next.remaining_candidates.slice(1);
      } else {
        next.remaining_candidates = next.remaining_candidates.filter(
          (edge) => edge.edge_id !== pendingEdge.edge_id,
        );
      }
    }
  } else if (resolution.action === 'apply' && resolution.edge) {
    next.confirmed_edges = [...next.confirmed_edges, resolution.edge];
    const removeId = pendingEdge?.edge_id ?? resolution.edge.edge_id;
    next.remaining_candidates = next.remaining_candidates.filter(
      (edge) => edge.edge_id !== removeId,
    );
  }

  next.active = true;
  next = advanceGraphRecoverySession(next, tasks);

  const complete = !next.active && !next.pending;
  const synced = complete
    ? applyGraphEdgesToLegacyFields(tasks, next.confirmed_edges)
    : tasks;

  return { session: next, tasks: synced };
}