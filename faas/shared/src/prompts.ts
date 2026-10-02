import type { Project, ProjectTask } from './domain.js';
import { researchPath } from './domain.js';

export const GENERATE_TASKS_INSTRUCTION = [
  'Generate an ordered list of project tasks based on the agreed decisions in this battleplan.',
  'Return only a JSON array, with no markdown and no commentary.',
  'Each item must be an object with:',
  '- "title": string, a short task name',
  '- "prompt": string, the instruction the executing agent should follow',
  '- "output_type": "code" or "research"',
  '- "depends_on": array of task titles this task depends on',
  'A task must declare exactly one output type. If work needs both research and code, emit two tasks.',
  'Order the array so each task appears after the tasks it depends on.',
].join('\n');

export function taskExecutionPrompt(task: ProjectTask, project: Project): string {
  const base = project.starting_ref?.trim() || 'main';
  const lines = [
    `You are executing a battleplan ${task.output_type} task.`,
    `Create the working branch from \`${base}\` in ${project.repo_url ?? 'the project repository'}.`,
    `Open the pull request against \`${base}\`, which is the branch this project merges into.`,
  ];
  if (task.output_type === 'research') {
    lines.push(
      `Write the research into the git repository under \`${researchPath(project.project_id, task.task_id)}\`.`,
      'Use markdown, JSON, CSV, or YAML, whichever fits the findings.',
      'Do not change application source code.',
      'Open a pull request that contains those research files.',
    );
  } else {
    lines.push('Implement the task in code and open a pull request.');
  }
  lines.push(`Task title: ${task.title}`, `Task prompt:\n${task.prompt}`);
  if (task.dependencies.length > 0) {
    lines.push(`This task depends on these completed task ids: ${task.dependencies.join(', ')}.`);
  }
  return lines.join('\n\n');
}

export function feedbackPrompt(task: ProjectTask, feedback: string): string {
  return [
    `The user reviewed the pull request for "${task.title}" and sent feedback.`,
    'Incorporate the feedback into the existing branch and update the pull request.',
    '',
    feedback,
  ].join('\n');
}

export function mergeApprovalPrompt(task: ProjectTask, prLink: string, baseBranch = 'main'): string {
  return [
    `The user approved the battleplan task "${task.title}".`,
    `Merge the pull request ${prLink} into \`${baseBranch}\` and confirm when the merge is complete.`,
    'Do not open a new pull request.',
  ].join('\n');
}
