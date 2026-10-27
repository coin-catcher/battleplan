import type { ChatArtifact, Project } from './models';
import type { ProjectTask } from './models';
import { battleplanTaskRepoPath } from './battleplan-storage';
import { formatGraphIndexForPrompt } from './graph-discovery';
import { parseGeneratedTasksFromSources, type ParsedGeneratedTasks } from './parse-tasks';
import { JSON_TASK_LIST_RULES } from './generate-tasks-shared';

export interface GenerateTasksSessionState {
  sourceTaskId: string;
  layer: number;
  activeGraphId: string;
  activeGraphGoal: string;
}

export function isGenerateTasksEndCommand(message: string): boolean {
  const token = message.trim().toUpperCase();
  return token === 'END' || token === 'END.' || token.startsWith('END ');
}

export function isGraphCompleteCommand(message: string): boolean {
  const token = message.trim().toUpperCase();
  return token === 'GRAPH DONE' || token.startsWith('GRAPH DONE ');
}

const DEPTH_FIRST_RULES = [
  'Discovery mode: **depth-first** — complete one task graph fully before starting another.',
  'While working on the active graph, do not propose tasks for other graphs.',
  'When the graph is complete, user may send GRAPH DONE; Battleplan adds an index entry and starts the next graph with the index as context.',
  'Graph B may edit tasks from graph A; set cross_graph_edit and cross_graph_edit_rationale on changed tasks and highlight edits in chat.',
  'Approved research tasks in a graph are **leaves** until executed interactively; they may spawn their own child graph later.',
  'Task graph patterns: Critique–Retry Loop, Leaf Fan-In Refactor, Template–Instance Cycle (serial instances), Task Templates, Spike–Gate (research→code→critique), Parallel Fan-Out/In, Subproject→Brainstorm, Dynamic→Deterministic Converter (critique→code→critique→add_workflow, n8n catalog).',
].join('\n');

const LAYER_REVIEW_RULES = [
  'Generate Tasks — layered workflow (active).',
  'For this layer, respond with a numbered list of suggested task **titles only** (no JSON yet).',
  'The user will reply with approve, disapprove, or change per number (e.g. "approve 1,2", "disapprove 3", "change 2: new intent").',
  'If any item was disapproved or changed, recompute and show the **full** revised numbered list for this layer.',
  `When every remaining item is approved, write each task brief under \`${'battleplan/projects/{project_id}/tasks/{task_id}/outputs/'}\` in the git repo, then reply with **only** valid JSON: { "tasks": [ ... ], "edges": [] } using the approved titles.`,
  'Do not emit task JSON until the user has approved every title in the current layer.',
  'Complete the **current graph** depth-first before switching to another graph.',
  'User may send END to finish the whole Generate Tasks session.',
].join('\n');

export function buildLayeredGenerateTasksProposalMessage(
  task: ProjectTask,
  layer: number,
  project: Project | null,
  session: Pick<GenerateTasksSessionState, 'activeGraphId' | 'activeGraphGoal'>,
): string {
  const dar = task.dar ?? task.prompt ?? '';
  const layerLabel = layer === 1
    ? 'Layer 1 — tasks connected directly to this discovery root'
    : `Layer ${layer} — tasks connected to approved tasks from layer ${layer - 1}`;
  const indexBlock = formatGraphIndexForPrompt(project?.graph_discovery_index);
  return [
    `Generate Tasks for "${task.title}".`,
    `Active graph: \`${session.activeGraphId}\` — ${session.activeGraphGoal}`,
    dar.trim() ? `Task data and rules:\n${dar.trim()}` : '',
    DEPTH_FIRST_RULES,
    LAYER_REVIEW_RULES,
    '',
    '## Completed task graph index',
    indexBlock,
    '',
    `Now propose **${layerLabel}** for the active graph only. Titles only.`,
  ].filter(Boolean).join('\n\n');
}

export function buildLayeredGenerateTasksNextLayerMessage(
  layer: number,
  project: Project | null,
  session: Pick<GenerateTasksSessionState, 'activeGraphId' | 'activeGraphGoal'>,
): string {
  return [
    `Layer ${layer - 1} tasks were created on the mindmap for graph \`${session.activeGraphId}\`.`,
    DEPTH_FIRST_RULES,
    LAYER_REVIEW_RULES,
    '',
    '## Completed task graph index',
    formatGraphIndexForPrompt(project?.graph_discovery_index),
    '',
    `Propose **Layer ${layer}** titles for graph \`${session.activeGraphId}\` where meaningful child work exists. Titles only.`,
  ].join('\n\n');
}

export function buildLeafFanInRefactorPassMessage(project: Project | null): string {
  return [
    'Final pass for the active graph: **Leaf Fan-In Refactor**.',
    'Group 3–6 related leaf code tasks and propose architecture fan-in nodes (pattern: leaf_fan_in_refactor).',
    'Then emit JSON for any new architecture tasks only.',
    formatGraphIndexForPrompt(project?.graph_discovery_index),
    JSON_TASK_LIST_RULES,
  ].join('\n\n');
}

export function buildLayeredGenerateTasksCommitReminder(layer: number, projectId: string, taskId: string): string {
  const example = battleplanTaskRepoPath(projectId, taskId);
  return [
    `All Layer ${layer} titles are approved.`,
    `Write brief specs under git paths like \`${example}\` for each new task, then return JSON.`,
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
