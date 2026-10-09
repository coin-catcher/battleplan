import type { ProjectTask, TaskDraft } from './models';

const JSON_TASK_LIST_RULES = [
  'Return only a JSON array, with no markdown and no commentary.',
  'Each item must be an object with:',
  '- "title": string, a short task name',
  '- "prompt": string, the instruction the executing agent should follow (stored as the task initial prompt)',
  '- "output_type": "code" or "research"',
  '- "depends_on": array of task titles listed in this same JSON array (tree parent links)',
  '- "sequential_with": optional array of task titles in this batch that touch the same code and must not run in parallel',
  'A task must declare exactly one output type. If work needs both research and code, emit two tasks (research first, then code).',
  'Order the array so prerequisite tasks appear before tasks that depend on them.',
  '',
  'Mindmap linking (important): Battleplan interprets depends_on as parent titles in the tree.',
  'If task B lists "Setup" in depends_on, "Setup" becomes the parent node and B is drawn as its child.',
  'When Generate Tasks is run from a task, leave depends_on empty on sibling code tasks; Battleplan attaches them under that task.',
  '',
  'Sequential execution: if two or more code tasks would edit the same files, modules, or tightly coupled behavior and could merge-conflict, list each other in sequential_with (both directions when mutual). They stay sibling nodes but Execute Children will not run them in parallel.',
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
    '- Do not link generated code tasks with depends_on unless one is a true prerequisite (foundation/data task).',
    '- For code tasks that would conflict if run in parallel, use sequential_with with the other task titles instead of depends_on.',
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

export { prepareGeneratedDrafts as anchorDraftsUnderParentTask } from './generate-task-links';
