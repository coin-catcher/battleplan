import type { ProjectTask } from './models';
import { TASK_BRIEF_FIELDS } from './task-brief';

const BRIEF_FIELD_LIST = TASK_BRIEF_FIELDS.map((field) => `"${field}"`).join(', ');

const JSON_TASK_LIST_RULES = [
  'Return only valid JSON, with no markdown and no commentary.',
  'Preferred shape: an object { "tasks": [ ... ], "edges": [ ... ] }.',
  'A bare JSON array of tasks is still accepted; omit edges or use an empty edges array when tree/ordering links are enough.',
  '',
  'Each task object must include:',
  '- "title": string, a short task name',
  '- "prompt": string, the instruction the executing agent should follow (stored as the task initial prompt)',
  '- "task_kind": one of brainstorming | research | critiquing | code | architect (workflow stencil on the mindmap)',
  '  You may instead set "output_type" ("code" or "research") and optional "node_kind"; task_kind is preferred.',
  `- "brief": object with all required pstack fields (${BRIEF_FIELD_LIST}). Every field must be a non-empty string.`,
  '- "depends_on": array of task titles in this batch used as tree parents (Battleplan parent → child links)',
  '- "sequential_with": optional array of titles that must not run in parallel with this task (ordering edges; later tasks wait for earlier ones in the batch)',
  '- Optional: "loop_mode" (HITL | AFK), "connector_kind", "lifecycle_phase", "break_condition" on the task when it participates in a loop',
  '',
  'Stencil semantics:',
  '- brainstorming (cloud): discover approach via Q&A; usually HITL research',
  '- research (data/cylinder): gather evidence and inputs for downstream work',
  '- critiquing (diamond/decision): review prior outputs, score against acceptance, choose rework vs proceed',
  '- code (rounded rectangle): implement and test on the agent branch',
  '- architect (process): review commits across the graph and consolidate design patterns',
  '',
  'Graph edges (optional "edges" array). Each edge object:',
  '- "from": source task title, "to": target task title',
  '- "kind": tree | ordering | fork | join | cycle',
  '  Aliases: fan-out → fork, fan-in → join, loop → cycle',
  '- "break_condition": required for every cycle (loop) edge, e.g. human:REVIEW or max_iterations:3',
  '  Every edge that participates in a dependency cycle must declare break_condition (critique/rework loops).',
  '',
  'Edge semantics:',
  '- tree: parent → child (same as depends_on; use one or the other, not both for the same link)',
  '- ordering: from must complete before to (sequential_with also creates ordering among siblings)',
  '- fork: fan-out — one upstream task enables parallel downstream tasks',
  '- join: fan-in — downstream waits for all listed upstream tasks',
  '- cycle: rework loop — always include break_condition on the back-edge',
  '',
  'Mindmap linking: depends_on lists parent task titles. When Generate Tasks is run from a task, leave depends_on empty on sibling code tasks unless you need extra structure; Battleplan attaches them under that task.',
  '',
  'Order the tasks array so prerequisites appear before dependents. Split research+code into two tasks when both are needed.',
].join('\n');

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
