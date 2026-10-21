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
  if (!brief) return;
  const issues = validateTaskBrief(brief);
  if (issues.length === 0) return;
  const fields = issues.map((item) => item.field).join(', ');
  throw new Error(`Task brief is incomplete (${fields}). Fill all brief fields or remove the brief.`);
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
