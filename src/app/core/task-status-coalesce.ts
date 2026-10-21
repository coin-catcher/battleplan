import type { ProjectTask, TaskStatus } from './models';
import { taskNeedsDoingBackgroundPoll } from './task-state-machine';

const TERMINAL_WHILE_POLLING: TaskStatus[] = ['TODO', 'REVIEW', 'DONE', 'BLOCKED', 'ABANDONED'];

/** Shallow clone so task rows in the store and chat cache do not share one object. */
export function cloneProjectTask(task: ProjectTask): ProjectTask {
  return {
    ...task,
    dependencies: [...task.dependencies],
    sibling_dependencies: [...(task.sibling_dependencies ?? [])],
    subproject_ids: task.subproject_ids ? [...task.subproject_ids] : undefined,
  };
}

/**
 * When opening a cached task panel, do not let an older snapshot clobber a live DOING task
 * that is still polling for the backend agent.
 */
export function coalesceCachedTaskStatus(
  live: ProjectTask | undefined,
  cached: ProjectTask,
  backgroundPollActive: boolean,
): ProjectTask {
  const next = cloneProjectTask(cached);
  if (!live || !backgroundPollActive) return next;
  if (live.status !== 'DOING') return next;
  if (!TERMINAL_WHILE_POLLING.includes(next.status)) return next;
  return {
    ...next,
    status: 'DOING',
    latest_run_id: live.latest_run_id ?? next.latest_run_id,
    pending_action: live.pending_action ?? next.pending_action,
  };
}

export function taskBackgroundPollActive(
  task: ProjectTask,
  subprojectCursorAgentId: string | undefined,
  doingBackgroundGenerationHasTask: boolean,
): boolean {
  return doingBackgroundGenerationHasTask
    || taskNeedsDoingBackgroundPoll(task, subprojectCursorAgentId);
}
