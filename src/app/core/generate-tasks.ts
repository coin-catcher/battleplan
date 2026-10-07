import type { ProjectTask, TaskDraft } from './models';

const JSON_TASK_LIST_RULES = [
  'Return only a JSON array, with no markdown and no commentary.',
  'Each item must be an object with:',
  '- "title": string, a short task name',
  '- "prompt": string, the instruction the executing agent should follow (stored as the task initial prompt)',
  '- "output_type": "code" or "research"',
  '- "depends_on": array of task titles listed in this same JSON array',
  'A task must declare exactly one output type. If work needs both research and code, emit two tasks (research first, then code).',
  'Order the array so prerequisite tasks appear before tasks that depend on them.',
  '',
  'Mindmap linking (important): Battleplan interprets depends_on as parent titles in the tree.',
  'If task B lists "Setup" in depends_on, "Setup" becomes the parent node and B is drawn as its child.',
  'An empty depends_on array means the task attaches directly to the project unless Battleplan anchors it under the task that invoked Generate Tasks.',
].join('\n');

export function generateTasksInstructionForProject(): string {
  return [
    'Generate an ordered list of project tasks based on the agreed decisions in this battleplan.',
    'Prefer a shallow plan: top-level research or code tasks with limited nesting.',
    'Use depends_on only when a task truly cannot start until another task in this list exists.',
    JSON_TASK_LIST_RULES,
  ].join('\n');
}

/** Prompt when Generate Tasks is run from a research task (default: flat code siblings). */
export function generateTasksInstructionForResearchTask(researchTitle: string): string {
  const title = researchTitle.trim() || 'this research task';
  return [
    `Generate child tasks to carry out the plan described for the research task "${title}".`,
    '',
    'Default shape (use this unless prerequisites are clearly required):',
    '- Emit a simple one-dimensional list of code tasks only (sibling nodes under this research task).',
    '- Set output_type to "code" for every item in that list.',
    '- Set depends_on to [] on every code task. Battleplan will attach them as children of this research task.',
    '- Do not link generated code tasks to each other with depends_on unless one must finish before another can start.',
    '',
    'When prerequisites are genuinely needed, add only the extra tasks the plan requires:',
    '- Child research task: for open-ended data gathering. It may own a small child code task that systematizes data retrieval.',
    '- Foundation code task: for shared interfaces, base classes, or process templates that other code tasks reuse (similar to a process template).',
    '  List dependent code tasks with depends_on containing that foundation task title (not each other in a deep chain).',
    '',
    JSON_TASK_LIST_RULES,
  ].join('\n');
}

/** Prompt when Generate Tasks is run from a non-research task. */
export function generateTasksInstructionForParentTask(parentTitle: string): string {
  const title = parentTitle.trim() || 'this task';
  return [
    `Generate child tasks that break down "${title}".`,
    'Prefer a short flat list of code tasks with depends_on: [] unless ordering or prerequisites are required.',
    JSON_TASK_LIST_RULES,
  ].join('\n');
}

export function buildGenerateTaskTasksUserMessage(task: ProjectTask): string {
  const instruction = task.output_type === 'research'
    ? generateTasksInstructionForResearchTask(task.title)
    : generateTasksInstructionForParentTask(task.title);
  const dar = task.dar ?? task.prompt ?? '';
  return [
    `Generate tasks from the conversation for "${task.title}".`,
    dar.trim() ? `Task data and rules:\n${dar.trim()}` : '',
    instruction,
  ].filter(Boolean).join('\n\n');
}

/** Empty depends_on → attach under the task that invoked Generate Tasks. */
export function anchorDraftsUnderParentTask(drafts: TaskDraft[], parentTitle: string): TaskDraft[] {
  const parent = parentTitle.trim();
  if (!parent) return drafts;
  return drafts.map((draft) => ({
    ...draft,
    depends_on: (draft.depends_on ?? []).filter(Boolean).length > 0 ? draft.depends_on : [parent],
  }));
}
