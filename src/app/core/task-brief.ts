import type { OutputType } from './models';
import type { TaskNodeKind } from './task-node-kind';

/** pstack-style task brief fields (Graph of Agents canonical task schema). */
export const TASK_BRIEF_FIELDS = [
  'goal',
  'scope',
  'context',
  'acceptance',
  'verify',
  'timebox',
  'forbidden',
  'report',
  'standing',
] as const;

export type TaskBriefField = (typeof TASK_BRIEF_FIELDS)[number];

export interface TaskBrief {
  goal: string;
  scope: string;
  context: string;
  acceptance: string;
  verify: string;
  timebox: string;
  forbidden: string;
  report: string;
  standing: string;
}

export interface TaskBriefValidationIssue {
  field: TaskBriefField;
  message: string;
}

export function emptyTaskBrief(): TaskBrief {
  return {
    goal: '',
    scope: '',
    context: '',
    acceptance: '',
    verify: '',
    timebox: '',
    forbidden: '',
    report: '',
    standing: '',
  };
}

export function normalizeTaskBrief(raw: unknown): TaskBrief | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const brief = emptyTaskBrief();
  let any = false;
  for (const field of TASK_BRIEF_FIELDS) {
    const value = record[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') {
      throw new Error(`brief.${field} must be a string.`);
    }
    brief[field] = value.trim();
    if (brief[field]) any = true;
  }
  return any ? brief : undefined;
}

export function validateTaskBrief(brief: TaskBrief): TaskBriefValidationIssue[] {
  const issues: TaskBriefValidationIssue[] = [];
  for (const field of TASK_BRIEF_FIELDS) {
    if (!brief[field]?.trim()) {
      issues.push({ field, message: `${field} is required before release.` });
    }
  }
  return issues;
}

export function assertTaskBriefReadyForRelease(brief: TaskBrief | undefined): void {
  if (!brief) {
    throw new Error('Task brief is required. Regenerate defaults from the task editor.');
  }
  const issues = validateTaskBrief(brief);
  if (issues.length === 0) return;
  const fields = issues.map((item) => item.field).join(', ');
  throw new Error(`Task brief is incomplete (${fields}). Fill all brief fields or regenerate defaults.`);
}

export interface TaskBriefBuildInput {
  title: string;
  initialPrompt: string;
  dar: string;
  outputType: OutputType;
  nodeKind?: TaskNodeKind;
  projectDar?: string;
  repoUrl?: string;
}

const DEFAULT_STANDING = [
  'Follow project Data and Rules and Battleplan agent branch policy.',
  'Push work to the agent branch; do not create or merge pull requests unless the human approves in Battleplan.',
].join(' ');

/** Generates a complete brief from task metadata (Graph of Agents default). */
export function buildDefaultTaskBrief(input: TaskBriefBuildInput): TaskBrief {
  const title = input.title.trim() || 'Untitled task';
  const prompt = input.initialPrompt.trim();
  const dar = input.dar.trim();
  const projectDar = input.projectDar?.trim() ?? '';
  const kind = input.nodeKind ?? 'work';
  const output = input.outputType;

  const goal = prompt
    ? prompt.split('\n').find((line) => line.trim())?.trim() ?? title
    : title;

  let scope = `Deliver a ${output} outcome for "${title}".`;
  if (kind === 'decision') scope = `Resolve the design decision "${title}" with the human (HITL).`;
  if (kind === 'gate') scope = `Human gate: confirm prerequisites before downstream tasks proceed.`;
  if (kind === 'fog') scope = `Clarify unknowns for "${title}" before ticketing work.`;

  const contextParts = [
    prompt ? `Initial prompt:\n${prompt}` : '',
    dar ? `Task Data and Rules:\n${dar}` : '',
    projectDar ? `Project standing context:\n${projectDar.slice(0, 1200)}` : '',
    input.repoUrl ? `Repository: ${input.repoUrl}` : '',
  ].filter(Boolean);
  const context = contextParts.join('\n\n') || `Task "${title}" in Battleplan project.`;

  let acceptance = 'Meets the goal above; artifacts and status updated in Battleplan.';
  let verify = 'Human review in Battleplan; automated checks as applicable to the repo.';
  let forbidden = 'Do not abandon sibling-dependent work; do not merge to develop/main without approval.';
  let report = 'Post summary, links, and branch name in the task thread when finished.';

  if (output === 'code') {
    acceptance = 'Code implemented on the agent branch, committed, and pushed; summary provided.';
    verify = 'Unit/integration tests pass locally where applicable; no unrelated scope.';
    forbidden = 'Do not create or update pull requests; do not push to develop/main directly.';
    report = 'Summarize code changes, tests run, and branch pushed.';
  } else if (output === 'research') {
    acceptance = 'Research artifacts written under research/{project_id}/{task_id}/ in the repo.';
    verify = 'Findings cite sources; TASKS.md or equivalent lists follow-on work if needed.';
    forbidden = 'Do not modify application source code.';
    report = 'List files created and key conclusions.';
  } else if (output === 'subproject') {
    acceptance = 'Nested battleplan opened; child tasks defined as agreed.';
    verify = 'Subproject mindmap reflects agreed scope.';
  }

  return {
    goal,
    scope,
    context,
    acceptance,
    verify,
    timebox: 'Complete when acceptance criteria are met (no separate calendar timebox).',
    forbidden,
    report,
    standing: projectDar ? `${DEFAULT_STANDING}\n\n${projectDar.slice(0, 800)}` : DEFAULT_STANDING,
  };
}

/** Fills missing brief fields from defaults; preserves user-edited non-empty values. */
export function mergeTaskBriefWithDefaults(existing: TaskBrief | undefined, defaults: TaskBrief): TaskBrief {
  const base = emptyTaskBrief();
  for (const field of TASK_BRIEF_FIELDS) {
    const saved = existing?.[field]?.trim();
    base[field] = saved || defaults[field];
  }
  return base;
}

export function completeTaskBrief(
  existing: TaskBrief | undefined,
  input: TaskBriefBuildInput,
): TaskBrief {
  return mergeTaskBriefWithDefaults(existing, buildDefaultTaskBrief(input));
}

export function taskBriefFromDraftRecord(record: Record<string, unknown>): TaskBrief | undefined {
  if (record['brief'] !== undefined) {
    return normalizeTaskBrief(record['brief']);
  }
  const nested: Record<string, unknown> = {};
  let any = false;
  for (const field of TASK_BRIEF_FIELDS) {
    const key = `brief_${field}`;
    if (record[key] !== undefined) {
      nested[field] = record[key];
      any = true;
    }
  }
  return any ? normalizeTaskBrief(nested) : undefined;
}

export function formatTaskBriefMarkdown(brief: TaskBrief): string {
  return [
    '## GOAL',
    brief.goal,
    '',
    '## SCOPE',
    brief.scope,
    '',
    '## CONTEXT',
    brief.context,
    '',
    '## ACCEPTANCE',
    brief.acceptance,
    '',
    '## VERIFY',
    brief.verify,
    '',
    '## TIMEBOX',
    brief.timebox,
    '',
    '## FORBIDDEN',
    brief.forbidden,
    '',
    '## REPORT',
    brief.report,
    '',
    '## STANDING',
    brief.standing,
  ].join('\n');
}
