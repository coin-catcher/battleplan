import type { TaskBrief } from './task-brief';

/** Mandatory definition-of-done checklist for every code task (output_type: code). */
export const CODE_TASK_BUILD_COMMAND = 'npm run build:electron';

export const CODE_TASK_DEFINITION_OF_DONE = [
  'Unit tests created or updated for all code created or changed by this task',
  'Code linting verification succeeds',
  `Code builds successfully (\`${CODE_TASK_BUILD_COMMAND}\`)`,
  'Unit tests are executed and succeed, with code coverage greater than 80%',
] as const;

const DOD_HEADING = 'Definition of done (mandatory for every code task)';

export function codeTaskDefinitionOfDoneMarkdown(): string {
  return [
    DOD_HEADING,
    ...CODE_TASK_DEFINITION_OF_DONE.map((item) => `- ${item}`),
  ].join('\n');
}

function fieldReferencesCodeTaskDod(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized.includes('code coverage') && normalized.includes('linting');
}

/** Ensures brief acceptance, verify, and report include the mandatory code-task DoD. */
export function applyCodeTaskDefinitionOfDone(brief: TaskBrief): TaskBrief {
  const dod = codeTaskDefinitionOfDoneMarkdown();
  const next = { ...brief };
  if (!fieldReferencesCodeTaskDod(next.acceptance)) {
    next.acceptance = [next.acceptance.trim(), dod].filter(Boolean).join('\n\n');
  }
  if (!fieldReferencesCodeTaskDod(next.verify)) {
    next.verify = [
      next.verify.trim(),
      `After any code change, run lint, \`${CODE_TASK_BUILD_COMMAND}\`, and unit tests with coverage; every definition-of-done item must pass before completion.`,
    ].filter(Boolean).join(' ');
  }
  if (!next.report.toLowerCase().includes('definition of done')) {
    next.report = [
      next.report.trim(),
      `Report definition-of-done checklist pass/fail with command output or CI links (lint, \`${CODE_TASK_BUILD_COMMAND}\`, tests, coverage > 80%).`,
    ].filter(Boolean).join(' ');
  }
  return next;
}

/** Injected into Cursor execute / feedback prompts for code tasks. */
export function codeTaskAgentCompletionPolicy(): string {
  return [
    'Code task completion policy:',
    'After any code is created or changed, satisfy every mandatory definition-of-done item before you finish.',
    ...CODE_TASK_DEFINITION_OF_DONE.map((item) => `- ${item}`),
    'Do not claim the task is complete until all items pass; include evidence in your summary.',
  ].join('\n');
}

export function codeTaskFeedbackFollowUpPolicy(): string {
  return [
    'Incorporate the user feedback on the existing agent branch, commit, and push.',
    `Then re-run lint, \`${CODE_TASK_BUILD_COMMAND}\`, unit tests, and confirm coverage > 80% for all code touched.`,
    'Report definition-of-done pass/fail before claiming completion.',
  ].join(' ');
}