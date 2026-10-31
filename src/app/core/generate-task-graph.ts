import type { ProjectTask } from './models';
import { edgeKey, type TaskEdgeKind, type TaskGraphEdge } from './task-graph';

export interface GeneratedTaskEdgeDraft {
  from: string;
  to: string;
  kind: TaskEdgeKind;
  break_condition?: string;
}

const EDGE_KIND_ALIASES: Record<string, TaskEdgeKind> = {
  tree: 'tree',
  parent: 'tree',
  child: 'tree',
  ordering: 'ordering',
  order: 'ordering',
  sequential: 'ordering',
  fork: 'fork',
  'fan-out': 'fork',
  fan_out: 'fork',
  fanout: 'fork',
  join: 'join',
  'fan-in': 'join',
  fan_in: 'join',
  fanin: 'join',
  cycle: 'cycle',
  loop: 'cycle',
  rework: 'cycle',
  hard: 'ordering',
  soft: 'fork',
  dependency: 'ordering',
  prerequisite: 'ordering',
};

const DEFAULT_CYCLE_BREAK = 'human:REVIEW';

export function normalizeGeneratedEdgeKind(value: unknown): TaskEdgeKind {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Graph edge kind is required.');
  }
  const token = value.trim().toLowerCase();
  const mapped = EDGE_KIND_ALIASES[token];
  if (!mapped) {
    throw new Error(`Unknown graph edge kind "${value}".`);
  }
  return mapped;
}

export function resolveGeneratedGraphEndpoint(
  value: unknown,
  idToTitle: Map<string, string>,
  label: string,
): string {
  const raw = requiredTitle(value, label);
  return idToTitle.get(raw) ?? raw;
}

export function parseGeneratedEdgeDraft(
  record: Record<string, unknown>,
  index: number,
  idToTitle: Map<string, string> = new Map(),
): GeneratedTaskEdgeDraft {
  const from = resolveGeneratedGraphEndpoint(
    record['from'] ?? record['from_title'] ?? record['source'],
    idToTitle,
    `Edge ${index + 1} from`,
  );
  const to = resolveGeneratedGraphEndpoint(
    record['to'] ?? record['to_title'] ?? record['target'],
    idToTitle,
    `Edge ${index + 1} to`,
  );
  const kind = normalizeGeneratedEdgeKind(record['kind'] ?? record['edge_kind'] ?? record['type']);
  const breakRaw = record['break_condition'] ?? record['break'];
  const break_condition = typeof breakRaw === 'string' ? breakRaw.trim() : undefined;
  if (kind === 'cycle' && !break_condition) {
    return { from, to, kind, break_condition: DEFAULT_CYCLE_BREAK };
  }
  return { from, to, kind, break_condition: break_condition || undefined };
}

export function parseGeneratedEdgeList(raw: unknown, idToTitle: Map<string, string> = new Map()): GeneratedTaskEdgeDraft[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error('Graph edges must be a JSON array when present.');
  }
  return raw.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`Edge ${index + 1} must be an object.`);
    }
    return parseGeneratedEdgeDraft(item as Record<string, unknown>, index, idToTitle);
  });
}

function buildTitleToIdForGeneratedEdges(existing: ProjectTask[], created: ProjectTask[]): Map<string, string> {
  const seenInBatch = new Set<string>();
  for (const task of created) {
    const title = task.title.trim();
    if (!title) continue;
    if (seenInBatch.has(title)) {
      throw new Error(`Duplicate task title "${title}" in generated batch.`);
    }
    seenInBatch.add(title);
  }
  const titleToId = new Map<string, string>();
  for (const task of created) {
    const title = task.title.trim();
    if (title) titleToId.set(title, task.task_id);
  }
  for (const task of existing) {
    const title = task.title.trim();
    if (!title || titleToId.has(title)) continue;
    titleToId.set(title, task.task_id);
  }
  return titleToId;
}

/** Resolve title-based edge drafts to task ids and merge into the project graph. */
export function buildGraphEdgesFromDrafts(
  existing: ProjectTask[],
  created: ProjectTask[],
  drafts: GeneratedTaskEdgeDraft[],
): TaskGraphEdge[] {
  if (!drafts.length) return [];
  const titleToId = buildTitleToIdForGeneratedEdges(existing, created);
  const edges: TaskGraphEdge[] = [];
  const seen = new Set<string>();
  drafts.forEach((draft, index) => {
    const fromId = titleToId.get(draft.from);
    const toId = titleToId.get(draft.to);
    if (!fromId) throw new Error(`Graph edge ${index + 1} from unknown task "${draft.from}".`);
    if (!toId) throw new Error(`Graph edge ${index + 1} to unknown task "${draft.to}".`);
    const kind = draft.kind;
    const break_condition = kind === 'cycle'
      ? (draft.break_condition?.trim() || DEFAULT_CYCLE_BREAK)
      : draft.break_condition?.trim();
    const edge_id = edgeKey(fromId, toId, kind);
    if (seen.has(edge_id)) return;
    seen.add(edge_id);
    edges.push({
      edge_id,
      from_task_id: fromId,
      to_task_id: toId,
      kind,
      break_condition,
    });
  });
  return edges;
}

export function mergeAdvancedEdgesIntoProject(
  current: TaskGraphEdge[] | undefined,
  legacySynced: TaskGraphEdge[],
  advanced: TaskGraphEdge[],
): TaskGraphEdge[] {
  const legacyKeys = new Set(legacySynced.map((edge) => edge.edge_id));
  const preserved = (current ?? []).filter((edge) => !legacyKeys.has(edge.edge_id));
  return dedupeGraphEdges([...legacySynced, ...preserved, ...advanced]);
}

/** Import Generate Tasks graph: tree/ordering from tasks plus JSON fork/join/cycle (drops stale advanced edges). */
export function mergeGraphAfterGenerateTasksImport(
  legacyTreeOrdering: TaskGraphEdge[],
  advancedFromJson: TaskGraphEdge[],
): TaskGraphEdge[] {
  return dedupeGraphEdges([...legacyTreeOrdering, ...advancedFromJson]);
}

export function dedupeGraphEdges(edges: TaskGraphEdge[]): TaskGraphEdge[] {
  const mergedKeys = new Set<string>();
  const out: TaskGraphEdge[] = [];
  for (const edge of edges) {
    if (mergedKeys.has(edge.edge_id)) continue;
    mergedKeys.add(edge.edge_id);
    out.push(edge);
  }
  return out;
}

export function filterGraphEdgesToTaskIds(edges: TaskGraphEdge[], taskIds: Set<string>): TaskGraphEdge[] {
  return edges.filter(
    (edge) => taskIds.has(edge.from_task_id) && taskIds.has(edge.to_task_id),
  );
}

function requiredTitle(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}
