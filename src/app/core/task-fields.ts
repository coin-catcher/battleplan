import type { ProjectTask } from './models';

export const RESEARCH_TASK_DAR_DEFAULT =
  'Create the output as a list of tasks and the details for how these tasks should be accomplished.';

/** Data and Rules text for a task (supports legacy `prompt` field). */
export function taskDar(task: ProjectTask): string {
  return (task.dar ?? task.prompt ?? '').trim();
}

export function taskInitialPrompt(task: ProjectTask): string {
  return (task.initial_prompt ?? '').trim();
}

export function defaultDarForOutputType(outputType: ProjectTask['output_type']): string {
  return outputType === 'research' ? RESEARCH_TASK_DAR_DEFAULT : '';
}
