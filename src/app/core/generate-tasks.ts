import type { ProjectTask } from './models';
import { JSON_TASK_LIST_RULES } from './generate-tasks-shared';

export function generateTasksInstructionForProject(): string {
  return [
    'Generate an ordered task graph for this battleplan from the agreed decisions in the conversation.',
    'Use task_kind and brief on every node. Add edges when the plan needs fan-in, fan-out, or critique loops.',
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
    '- Emit a simple one-dimensional list of code tasks (task_kind "code") as siblings under this research task.',
    '- Set depends_on to [] on every code task. Battleplan will attach them as children of this research task.',
    '- Include a complete brief object on every task.',
    '- Use sequential_with (or ordering edges) only when two code tasks would conflict if run in parallel.',
    '',
    'When prerequisites are genuinely needed, add only the extra tasks the plan requires:',
    '- Child research or brainstorming task for open-ended discovery.',
    '- Foundation code or architect task for shared interfaces; dependents list it in depends_on.',
    '- Critiquing task with a cycle edge back to code work; the cycle edge must include break_condition.',
    '',
    JSON_TASK_LIST_RULES,
  ].join('\n');
}

/** Prompt when Generate Tasks is run from a non-research task. */
export function generateTasksInstructionForParentTask(parentTitle: string): string {
  const title = parentTitle.trim() || 'this task';
  return [
    `Generate child tasks that break down "${title}".`,
    'Prefer a short flat list with depends_on: [] and complete briefs unless ordering, fan-in/out, or loops are required.',
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
