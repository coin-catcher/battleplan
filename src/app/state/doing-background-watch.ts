import type { ProjectTask } from '../core/models';

/** Whether a mindmap task node should keep polling Cursor chat while the user views another node. */
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

export function doingBackgroundWatchTaskIds(
  tasks: ProjectTask[],
  subprojectAgentId: (subprojectId: string) => string | undefined,
): string[] {
  return tasks
    .filter((task) => taskNeedsDoingBackgroundPoll(task, task.subproject_id ? subprojectAgentId(task.subproject_id) : undefined))
    .map((task) => task.task_id);
}
