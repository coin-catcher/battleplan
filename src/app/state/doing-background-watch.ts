import type { ProjectTask } from '../core/models';
export { taskNeedsDoingBackgroundPoll } from '../core/task-state-machine';

import { taskNeedsDoingBackgroundPoll } from '../core/task-state-machine';

export function doingBackgroundWatchTaskIds(
  tasks: ProjectTask[],
  subprojectAgentId: (subprojectId: string) => string | undefined,
): string[] {
  return tasks
    .filter((task) => taskNeedsDoingBackgroundPoll(
      task,
      task.subproject_id ? subprojectAgentId(task.subproject_id) : undefined,
    ))
    .map((task) => task.task_id);
}
