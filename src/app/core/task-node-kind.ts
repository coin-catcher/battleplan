/** Logical node kinds on the Battleplan plan graph (beyond output_type shapes). */
export const TASK_NODE_KINDS = ['work', 'decision', 'gate', 'fog'] as const;
export type TaskNodeKind = (typeof TASK_NODE_KINDS)[number];

export const LOOP_MODES = ['HITL', 'AFK'] as const;
export type LoopMode = (typeof LOOP_MODES)[number];

export function normalizeTaskNodeKind(value: unknown): TaskNodeKind {
  if (typeof value !== 'string') return 'work';
  const token = value.trim().toLowerCase();
  if (token === 'decision' || token === 'hitl') return 'decision';
  if (token === 'gate') return 'gate';
  if (token === 'fog') return 'fog';
  return 'work';
}

export function normalizeLoopMode(value: unknown): LoopMode | undefined {
  if (typeof value !== 'string') return undefined;
  const token = value.trim().toUpperCase();
  if (token === 'HITL' || token === 'AFK') return token;
  return undefined;
}

/** Decision and fog nodes stay in Battleplan; they are not dispatched to execution backends. */
export function isDispatchableNodeKind(kind: TaskNodeKind | undefined): boolean {
  return kind !== 'decision' && kind !== 'fog';
}
