import type { ProjectTask, TaskStatus } from './models';

/** How a status change was initiated (automatic workflow vs user override in the mindmap). */
export type TaskTransitionTrigger =
  | 'manual'
  | 'execute_or_send'
  | 'agent_finished'
  | 'approve_merge';

const AUTOMATIC_TRANSITIONS: Partial<Record<TaskStatus, Partial<Record<TaskStatus, TaskTransitionTrigger[]>>>> = {
  TODO: { DOING: ['execute_or_send'] },
  DOING: { REVIEW: ['agent_finished'] },
  REVIEW: {
    DOING: ['execute_or_send'],
    DONE: ['approve_merge'],
  },
};

export function assertTaskTransition(from: TaskStatus, to: TaskStatus, trigger: TaskTransitionTrigger): void {
  if (from === to) return;
  if (trigger === 'manual') return;
  const allowed = AUTOMATIC_TRANSITIONS[from]?.[to];
  if (!allowed?.includes(trigger)) {
    throw new Error(`Cannot move a task from ${from} to ${to} via ${trigger}.`);
  }
}

/** Applies a validated transition and clears merge pending state when leaving DOING. */
export function applyTaskStatusTransition(
  task: ProjectTask,
  to: TaskStatus,
  trigger: TaskTransitionTrigger,
): void {
  assertTaskTransition(task.status, to, trigger);
  if (task.status === to) return;
  task.status = to;
  if (to !== 'DOING') task.pending_action = undefined;
}

/** True while the UI should poll Cursor for an in-flight agent run on this task. */
export function taskNeedsDoingBackgroundPoll(
  task: ProjectTask,
  subprojectCursorAgentId: string | undefined,
): boolean {
  if (task.status !== 'DOING') return false;
  if (task.output_type === 'subproject') {
    return Boolean(subprojectCursorAgentId);
  }
  return Boolean(task.cursor_agent_id);
}
