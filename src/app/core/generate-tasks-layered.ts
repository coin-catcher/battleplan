import type { ChatArtifact } from './models';
import type { ProjectTask } from './models';
import { parseGeneratedTasksFromSources, type ParsedGeneratedTasks } from './parse-tasks';
import { JSON_TASK_LIST_RULES } from './generate-tasks-shared';

export interface GenerateTasksSessionState {
  sourceTaskId: string;
  layer: number;
}

export function isGenerateTasksEndCommand(message: string): boolean {
  const token = message.trim().toUpperCase();
  return token === 'END' || token === 'END.' || token.startsWith('END ');
}

const LAYER_REVIEW_RULES = [
  'Generate Tasks — layered workflow (active).',
  'For this layer, respond with a numbered list of suggested task **titles only** (no JSON yet).',
  'The user will reply with approve, disapprove, or change per number (e.g. "approve 1,2", "disapprove 3", "change 2: new intent").',
  'If any item was disapproved or changed, recompute and show the **full** revised numbered list for this layer.',
  'When every remaining item is approved, write each task brief under research/{project_id}/{task_id}/ in the git repo, then reply with **only** valid JSON: { "tasks": [ ... ], "edges": [] } using the approved titles.',
  'Do not emit task JSON until the user has approved every title in the current layer.',
  'Suggest the next layer only after Battleplan imports the JSON; not every parent task needs children.',
  'User may send END to finish the whole Generate Tasks session.',
].join('\n');

export function buildLayeredGenerateTasksProposalMessage(task: ProjectTask, layer: number): string {
  const dar = task.dar ?? task.prompt ?? '';
  const layerLabel = layer === 1
    ? 'Layer 1 — tasks connected directly to this research task'
    : `Layer ${layer} — tasks connected to approved tasks from layer ${layer - 1}`;
  return [
    `Generate Tasks for "${task.title}".`,
    dar.trim() ? `Task data and rules:\n${dar.trim()}` : '',
    LAYER_REVIEW_RULES,
    '',
    `Now propose **${layerLabel}**. Titles only.`,
  ].filter(Boolean).join('\n\n');
}

export function buildLayeredGenerateTasksNextLayerMessage(layer: number): string {
  return [
    `Layer ${layer - 1} tasks were created on the mindmap.`,
    LAYER_REVIEW_RULES,
    '',
    `Propose **Layer ${layer}** titles where meaningful child work exists. Titles only.`,
  ].join('\n\n');
}

export function buildLayeredGenerateTasksCommitReminder(layer: number): string {
  return [
    `All Layer ${layer} titles are approved.`,
    'Write brief specs under research/{project_id}/{task_id}/ for each new task, then return JSON.',
    JSON_TASK_LIST_RULES,
  ].join('\n\n');
}

export function tryParseGeneratedTasksFromSources(
  text: string,
  artifacts: ChatArtifact[],
): ParsedGeneratedTasks | null {
  try {
    return parseGeneratedTasksFromSources(text, artifacts);
  } catch {
    return null;
  }
}
