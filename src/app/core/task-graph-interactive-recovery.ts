import type { Project, ProjectTask } from './models';
import type { TaskGraphEdge, TaskEdgeKind } from './task-graph';
import {
  TASK_EDGE_KINDS,
  edgeKey,
  rebuildGraphEdgesFromLegacy,
  stripOrphanTaskReferences,
  taskGraphValidationIssues,
  applyGraphEdgesToLegacyFields,
  repairProjectTaskGraph,
} from './task-graph';
import { dedupeTaskGraphEdges, graphEdgesForDisplay } from './task-graph-recovery';
import {
  buildTaskRecoveryDiskSnapshot,
  mergeGraphRecoveryDiskHints,
} from './graph-recovery-disk';
import { canRevealTaskOnMindmap, partitionTasksForRecovery } from './graph-recovery-reachability';

export type GraphRecoveryPending =
  | {
      kind: 'edge';
      edge: TaskGraphEdge;
      issue: string;
      alternatives: TaskGraphEdge[];
    }
  | {
      kind: 'orphan';
      task_id: string;
      issue: string;
      disk_snapshot: string;
    }
  | {
      kind: 'orphan_review';
      task_id: string;
      issue: string;
      disk_snapshot: string;
    };

export type GraphRecoveryMode = 'staged' | 'edge';
export type GraphRecoveryPhase = 'connected' | 'orphaned';

export interface GraphRecoverySession {
  active: boolean;
  mode: GraphRecoveryMode;
  phase?: GraphRecoveryPhase;
  confirmed_edges: TaskGraphEdge[];
  remaining_candidates: TaskGraphEdge[];
  skipped: TaskGraphEdge[];
  pending?: GraphRecoveryPending;
  /** Staged recovery: tasks shown on the mindmap in execution order. */
  revealed_task_ids?: string[];
  /** Task ids still waiting to appear in the current phase. */
  pending_task_ids?: string[];
  /** Tasks linked to the project/subproject graph on disk. */
  connected_task_ids?: string[];
  /** On-disk tasks not in the connected component. */
  orphaned_task_ids?: string[];
  /** Orphans the user chose not to add. */
  discarded_task_ids?: string[];
  /** Full edge set read from local project + task fields. */
  source_edge_pool?: TaskGraphEdge[];
  auto_advance_ms?: number;
  paused?: boolean;
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

const SCHEDULING_EDGE_KINDS = new Set<TaskEdgeKind>(['tree', 'ordering', 'fork', 'join']);

/** Task execution order for staged mindmap reveal (cycle edges do not schedule). */
export function executionOrderTaskIds(tasks: ProjectTask[], edges: TaskGraphEdge[]): string[] {
  const byId = new Map(tasks.map((task) => [task.task_id, task]));
  const ids = [...byId.keys()];
  const indegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const id of ids) {
    indegree.set(id, 0);
    adj.set(id, []);
  }
  for (const edge of edges) {
    if (!SCHEDULING_EDGE_KINDS.has(edge.kind)) continue;
    if (!byId.has(edge.from_task_id) || !byId.has(edge.to_task_id)) continue;
    if (edge.from_task_id === edge.to_task_id) continue;
    indegree.set(edge.to_task_id, (indegree.get(edge.to_task_id) ?? 0) + 1);
    adj.get(edge.from_task_id)!.push(edge.to_task_id);
  }
  const queue = ids
    .filter((id) => (indegree.get(id) ?? 0) === 0)
    .sort((left, right) => {
      const lo = byId.get(left)!;
      const ro = byId.get(right)!;
      return lo.order - ro.order || lo.title.localeCompare(ro.title);
    });
  const order: string[] = [];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    const children = [...(adj.get(id) ?? [])].sort((left, right) => {
      const lo = byId.get(left)!;
      const ro = byId.get(right)!;
      return lo.order - ro.order || lo.title.localeCompare(ro.title);
    });
    for (const child of children) {
      const nextDeg = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, nextDeg);
      if (nextDeg === 0) queue.push(child);
    }
    queue.sort((left, right) => {
      const lo = byId.get(left)!;
      const ro = byId.get(right)!;
      return lo.order - ro.order || lo.title.localeCompare(ro.title);
    });
  }
  for (const id of ids.sort((left, right) => {
    const lo = byId.get(left)!;
    const ro = byId.get(right)!;
    return lo.order - ro.order || lo.title.localeCompare(ro.title);
  })) {
    if (!seen.has(id)) order.push(id);
  }
  return order;
}

function edgesBetweenRevealedTasks(
  pool: TaskGraphEdge[],
  revealed: Set<string>,
  confirmed: TaskGraphEdge[],
  skipped: TaskGraphEdge[],
): TaskGraphEdge[] {
  const skipIds = new Set([...confirmed, ...skipped].map((edge) => edge.edge_id));
  return sortCandidates(pool.filter((edge) => {
    if (skipIds.has(edge.edge_id)) return false;
    return revealed.has(edge.from_task_id) && revealed.has(edge.to_task_id);
  }));
}

export function initStagedGraphRecoverySession(
  project: Project,
  tasks: ProjectTask[],
): GraphRecoverySession {
  const hints = mergeGraphRecoveryDiskHints(project, tasks);
  const pool = dedupeTaskGraphEdges([
    ...collectRecoveryCandidateEdges(project, hints.tasks),
    ...hints.edges,
  ]);
  const partition = partitionTasksForRecovery(hints.tasks, pool);
  const connectedTasks = hints.tasks.filter((task) => partition.connected.includes(task.task_id));
  const order = executionOrderTaskIds(connectedTasks, pool);
  return {
    active: true,
    mode: 'staged',
    phase: 'connected',
    confirmed_edges: [],
    remaining_candidates: [],
    skipped: [],
    revealed_task_ids: [],
    pending_task_ids: order,
    connected_task_ids: partition.connected,
    orphaned_task_ids: partition.orphaned,
    discarded_task_ids: [],
    source_edge_pool: pool,
    auto_advance_ms: 5000,
    paused: false,
  };
}

function transitionToOrphanPhase(session: GraphRecoverySession): GraphRecoverySession {
  const orphans = session.orphaned_task_ids ?? [];
  if (orphans.length === 0) {
    return { ...session, active: false, phase: 'orphaned', pending: undefined, paused: false };
  }
  return {
    ...session,
    active: true,
    phase: 'orphaned',
    pending_task_ids: [...orphans],
    pending: undefined,
    paused: false,
  };
}

function stagedOrphanReviewStep(
  project: Project,
  session: GraphRecoverySession,
  tasks: ProjectTask[],
): GraphRecoverySession {
  const pendingIds = [...(session.pending_task_ids ?? [])];
  if (pendingIds.length === 0) {
    return { ...session, active: false, paused: false, pending: undefined };
  }
  const nextTaskId = pendingIds.shift()!;
  const revealed = new Set(session.revealed_task_ids ?? []);
  revealed.add(nextTaskId);
  const task = tasks.find((item) => item.task_id === nextTaskId);
  return {
    ...session,
    revealed_task_ids: [...revealed],
    pending_task_ids: pendingIds,
    paused: true,
    pending: {
      kind: 'orphan_review',
      task_id: nextTaskId,
      issue: 'This task was not part of the connected project graph on disk. Connect it to an existing task or choose Do Not Add.',
      disk_snapshot: task
        ? buildTaskRecoveryDiskSnapshot(project, task, tasks)
        : '{}',
    },
  };
}

/** Reveal the next task and try to confirm its mindmap links from storage. */
export function stagedGraphRecoveryStep(
  project: Project,
  session: GraphRecoverySession,
  tasks: ProjectTask[],
): GraphRecoverySession {
  if (session.mode !== 'staged' || !session.active || session.pending || session.paused) return session;

  if (session.phase === 'orphaned') {
    return stagedOrphanReviewStep(project, session, tasks);
  }

  const revealed = new Set(session.revealed_task_ids ?? []);
  const pendingIds = [...(session.pending_task_ids ?? [])];
  const pool = session.source_edge_pool ?? [];

  if (pendingIds.length === 0) {
    let finished = advanceGraphRecoverySession(
      { ...session, pending: undefined },
      tasks,
      revealed,
    );
    if (finished.pending) {
      finished.paused = true;
      return finished;
    }
  return transitionToOrphanPhase(finished);
  }

  const nextTaskId = pendingIds[0]!;
  if (!canRevealTaskOnMindmap(nextTaskId, tasks, pool, revealed, session.confirmed_edges)) {
    pendingIds.shift();
    return stagedGraphRecoveryStep(project, { ...session, pending_task_ids: pendingIds }, tasks);
  }

  pendingIds.shift();
  revealed.add(nextTaskId);
  const newEdges = edgesBetweenRevealedTasks(
    pool,
    revealed,
    session.confirmed_edges,
    session.skipped,
  );

  let next: GraphRecoverySession = {
    ...session,
    revealed_task_ids: [...revealed],
    pending_task_ids: pendingIds,
    remaining_candidates: dedupeTaskGraphEdges([...newEdges, ...session.remaining_candidates]),
    paused: false,
    pending: undefined,
  };

  next = advanceGraphRecoverySession(next, tasks, revealed);
  if (next.pending) {
    next.paused = true;
    return next;
  }
  if ((next.pending_task_ids ?? []).length === 0 && next.remaining_candidates.length === 0 && !next.pending) {
    return transitionToOrphanPhase(next);
  }
  return next;
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
  validationTaskIds?: Set<string>,
): GraphRecoverySession {
  const taskIds = validationTaskIds ?? new Set(tasks.map((task) => task.task_id));
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
      kind: 'edge',
      edge: candidate,
      issue: issues[0]!,
      alternatives: buildRecoveryAlternatives(candidate, tasks),
    };
    break;
  }

  if (!next.pending && next.remaining_candidates.length === 0) {
    if (next.mode === 'staged') {
      next.active = (next.pending_task_ids ?? []).length > 0;
    } else {
      next.active = false;
    }
  }

  return next;
}

export function beginGraphRecoveryFromStorage(
  project: Project,
  tasks: ProjectTask[],
  options?: { mode?: GraphRecoveryMode; force?: boolean },
): { project: Project; tasks: ProjectTask[]; session: GraphRecoverySession } {
  const stripped = stripOrphanTaskReferences(tasks, new Set(tasks.map((task) => task.task_id)));
  const mode = options?.mode ?? 'staged';

  let session: GraphRecoverySession = options?.force || !project.graph_recovery_session?.active
    ? (mode === 'staged'
      ? initStagedGraphRecoverySession(project, stripped.tasks)
      : {
          active: true,
          mode: 'edge',
          confirmed_edges: [],
          remaining_candidates: collectRecoveryCandidateEdges(project, stripped.tasks),
          skipped: [],
        })
    : { ...project.graph_recovery_session };

  const hintMerge = mergeGraphRecoveryDiskHints(project, stripped.tasks);
  stripped.tasks = hintMerge.tasks;

  if (session.mode === 'staged' && !session.pending && !session.paused) {
    session = stagedGraphRecoveryStep(project, session, hintMerge.tasks);
  } else if (session.mode === 'edge' && !session.pending) {
    session = advanceGraphRecoverySession(session, hintMerge.tasks);
  }

  return finalizeGraphRecoveryProject(project, stripped.tasks, session);
}

export function startInteractiveGraphRecovery(
  project: Project,
  tasks: ProjectTask[],
): { project: Project; tasks: ProjectTask[]; session: GraphRecoverySession } {
  return beginGraphRecoveryFromStorage(project, tasks, { mode: 'staged' });
}

/** Tasks that participate in mindmap graph validation (excludes user “Do Not Add” orphans). */
export function tasksForValidatedTaskGraph(project: Project, tasks: ProjectTask[]): ProjectTask[] {
  const excluded = new Set(project.task_graph_excluded_task_ids ?? []);
  return tasks.filter((task) => !excluded.has(task.task_id));
}

function finalizeCompletedRecoveryGraph(
  project: Project,
  tasks: ProjectTask[],
  session: GraphRecoverySession,
): { project: Project; tasks: ProjectTask[] } {
  const discarded = new Set(session.discarded_task_ids ?? []);
  const activeTasks = tasks.filter((task) => !discarded.has(task.task_id));
  const revealed = new Set(session.revealed_task_ids ?? []);
  const taskIds = new Set(activeTasks.map((task) => task.task_id));

  let edges = dedupeTaskGraphEdges([...session.confirmed_edges]);
  const pool = session.source_edge_pool ?? [];
  for (const edge of pool) {
    if (!revealed.has(edge.from_task_id) || !revealed.has(edge.to_task_id)) continue;
    if (discarded.has(edge.from_task_id) || discarded.has(edge.to_task_id)) continue;
    if (edges.some((item) => item.edge_id === edge.edge_id)) continue;
    const trial = [...edges, edge];
    if (taskGraphValidationIssues(trial, taskIds).length === 0) {
      edges.push(edge);
    }
  }

  const provisional: Project = { ...project, task_graph_edges: edges };
  return repairProjectTaskGraph(provisional, activeTasks, {
    validate: false,
    inferCritiqueCycles: true,
  });
}

export function finalizeGraphRecoveryProject(
  project: Project,
  tasks: ProjectTask[],
  session: GraphRecoverySession,
): { project: Project; tasks: ProjectTask[]; session: GraphRecoverySession } {
  const complete = !session.active && !session.pending;

  let synced = tasks;
  let projectNext: Project = {
    ...project,
    task_graph_edges: session.confirmed_edges,
    ...(complete
      ? {}
      : {
          task_graph_validation_issue: session.pending?.issue
            ?? (session.mode === 'staged'
              ? 'Graph recovery in progress — tasks appear in execution order.'
              : 'Resolving task graph connections step by step…'),
          graph_recovery_session: session,
        }),
  };

  if (complete) {
    const repaired = finalizeCompletedRecoveryGraph(project, tasks, session);
    synced = repaired.tasks;
    projectNext = repaired.project;
    const excluded = [
      ...new Set([
        ...(project.task_graph_excluded_task_ids ?? []),
        ...(session.discarded_task_ids ?? []),
      ]),
    ];
    if (excluded.length > 0) {
      projectNext.task_graph_excluded_task_ids = excluded;
    }
    delete projectNext.graph_recovery_session;
    delete projectNext.task_graph_validation_issue;
  }

  return { project: projectNext, tasks: synced, session };
}

export type GraphRecoveryResolution =
  | { action: 'apply' | 'skip'; edge?: TaskGraphEdge }
  | { action: 'attach'; task_id: string; parent_task_id: string }
  | { action: 'discard'; task_id: string };

export function resolveGraphRecoverySession(
  session: GraphRecoverySession,
  tasks: ProjectTask[],
  resolution: GraphRecoveryResolution,
): { session: GraphRecoverySession; tasks: ProjectTask[] } {
  if (!session.pending && (resolution.action === 'skip' || resolution.action === 'attach' || resolution.action === 'discard')) {
    return { session, tasks };
  }

  let next: GraphRecoverySession = { ...session, pending: undefined, paused: false };
  const pendingEdge = session.pending?.kind === 'edge' ? session.pending.edge : undefined;

  if (resolution.action === 'discard') {
    const review = session.pending?.kind === 'orphan_review' ? session.pending : null;
    if (!review || review.task_id !== resolution.task_id) {
      return { session, tasks };
    }
    const revealed = (next.revealed_task_ids ?? []).filter((id) => id !== review.task_id);
    const discarded = [...(next.discarded_task_ids ?? []), review.task_id];
    next = {
      ...next,
      revealed_task_ids: revealed,
      discarded_task_ids: discarded,
      paused: false,
    };
    return { session: next, tasks };
  }

  if (resolution.action === 'attach') {
    const orphan = session.pending?.kind === 'orphan' || session.pending?.kind === 'orphan_review'
      ? session.pending
      : null;
  if (!orphan || orphan.task_id !== resolution.task_id) {
      return { session, tasks };
    }
    const revealed = new Set(next.revealed_task_ids ?? []);
    revealed.add(orphan.task_id);
    let pendingIds = [...(next.pending_task_ids ?? [])];
    pendingIds = pendingIds.filter((id) => id !== orphan.task_id);
    let updatedTasks = tasks;
    if (resolution.parent_task_id === 'project') {
      updatedTasks = tasks.map((task) => (
        task.task_id === orphan.task_id
          ? { ...task, dependencies: [], sibling_dependencies: [] }
          : task
      ));
    } else {
      const attachEdge: TaskGraphEdge = {
        edge_id: edgeKey(resolution.parent_task_id, orphan.task_id, 'tree'),
        from_task_id: resolution.parent_task_id,
        to_task_id: orphan.task_id,
        kind: 'tree',
      };
      next.confirmed_edges = [...next.confirmed_edges, attachEdge];
    }
    const connected = [...new Set([...(next.connected_task_ids ?? []), orphan.task_id])];
    const orphaned = (next.orphaned_task_ids ?? []).filter((id) => id !== orphan.task_id);
    next = {
      ...next,
      revealed_task_ids: [...revealed],
      pending_task_ids: pendingIds,
      connected_task_ids: connected,
      orphaned_task_ids: orphaned,
      remaining_candidates: dedupeTaskGraphEdges([
        ...edgesBetweenRevealedTasks(
          next.source_edge_pool ?? [],
          revealed,
          next.confirmed_edges,
          next.skipped,
        ),
        ...next.remaining_candidates,
      ]),
    };
    next.active = true;
    next = advanceGraphRecoverySession(next, updatedTasks, revealed);
    if (next.pending) next.paused = true;
  if ((next.pending_task_ids ?? []).length === 0
      && next.remaining_candidates.length === 0
      && !next.pending
      && next.phase === 'orphaned') {
      next = { ...next, active: false, paused: false };
    }
    return { session: next, tasks: updatedTasks };
  }

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
  next.paused = false;
  next = advanceGraphRecoverySession(next, tasks);
  if (next.pending) next.paused = true;

  const complete = !next.active && !next.pending;
  const synced = complete
    ? applyGraphEdgesToLegacyFields(tasks, next.confirmed_edges)
    : tasks;

  return { session: next, tasks: synced };
}