import type { ChatArtifact, Project } from './models';
import type { ProjectTask } from './models';
import { battleplanTaskRepoPath } from './battleplan-storage';
import { formatGraphIndexForPrompt } from './graph-discovery';
import { parseGeneratedTasksFromSources, type ParsedGeneratedTasks } from './parse-tasks';
import { JSON_TASK_LIST_RULES } from './generate-tasks-shared';

export type DiscoveryPhase = 'partition' | 'depth_first';

export interface GenerateTasksSessionState {
  sourceTaskId: string;
  /** partition = Layer-1 problem-space split only; depth_first = complete one partition branch at a time */
  phase: DiscoveryPhase;
  layer: number;
  activeGraphId: string;
  activeGraphGoal: string;
  /** Layer-1 partition titles after first JSON import */
  partitionTitles: string[];
  partitionIndex: number;
  focusPartitionTitle?: string;
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
  'After Layer 1 (partition), switch to **depth-first**: pick one Layer-1 partition and expand its task graph completely before moving to the next partition.',
  'While expanding a partition, do not propose tasks for other Layer-1 partitions.',
  'When a partition graph is complete, the user may send GRAPH DONE; Battleplan indexes it and moves to the next partition.',
  'Graph B may edit tasks from graph A; set cross_graph_edit and cross_graph_edit_rationale on changed tasks and highlight edits in chat.',
  'Approved research tasks in a graph are **leaves** until executed interactively; they may spawn their own child graph later.',
  'Task graph patterns: Critique–Retry Loop, Leaf Fan-In Refactor, Template–Instance Cycle (serial instances), Task Templates, Spike–Gate, Parallel Fan-Out/In, Subproject→Brainstorm, Dynamic→Deterministic Converter.',
].join('\n');

const TITLE_REVIEW_RULES = [
  'Discovery session (active).',
  'Respond with a numbered list of suggested task **titles only** (no JSON yet).',
  'The user will reply with approve, disapprove, or change per number.',
  'When every item is approved, write briefs under battleplan/projects/{project_id}/tasks/{task_id}/outputs/ in git, then reply with **only** valid JSON: { "tasks": [ ... ], "edges": [] }.',
  'Do not emit task JSON until titles are approved.',
  'User may send END to finish discovery.',
].join('\n');

export function buildPartitionProposalMessage(
  task: ProjectTask,
  project: Project | null,
  session: Pick<GenerateTasksSessionState, 'activeGraphId' | 'activeGraphGoal'>,
): string {
  const dar = task.dar ?? task.prompt ?? '';
  const approximateGoal = task.initial_prompt?.trim() || dar.trim();
  return [
    `Start Discovery for "${task.title}".`,
    approximateGoal ? `Approximate goal:\n${approximateGoal}` : '',
    `Active graph: \`${session.activeGraphId}\` — ${session.activeGraphGoal}`,
    DEPTH_FIRST_RULES,
    TITLE_REVIEW_RULES,
    '',
    '## Completed task graph index',
    formatGraphIndexForPrompt(project?.graph_discovery_index),
    '',
    '**Phase: partition** — propose **Layer 1** titles only: top-level partitions of the problem space (direct children of this discovery root).',
    'After Layer 1 JSON is imported, Battleplan will depth-first expand **one partition at a time**.',
  ].filter(Boolean).join('\n\n');
}

export function buildDepthFirstDescentProposalMessage(
  project: Project | null,
  session: GenerateTasksSessionState,
): string {
  const focus = session.focusPartitionTitle ?? session.activeGraphGoal;
  const layerLabel = session.layer === 1
    ? `Layer 1 under partition "${focus}"`
    : `Layer ${session.layer} under partition "${focus}"`;
  return [
    `Partition ${session.partitionIndex + 1}/${Math.max(session.partitionTitles.length, 1)}: **${focus}**`,
    `Active graph: \`${session.activeGraphId}\` — ${session.activeGraphGoal}`,
    DEPTH_FIRST_RULES,
    TITLE_REVIEW_RULES,
    '',
    '## Completed task graph index',
    formatGraphIndexForPrompt(project?.graph_discovery_index),
    '',
    `**Phase: depth_first** — propose **${layerLabel}** titles only. Complete this partition before the next.`,
  ].join('\n\n');
}

/** @deprecated use buildPartitionProposalMessage or buildDepthFirstDescentProposalMessage */
export function buildLayeredGenerateTasksProposalMessage(
  task: ProjectTask,
  layer: number,
  project: Project | null,
  session: Pick<GenerateTasksSessionState, 'activeGraphId' | 'activeGraphGoal' | 'phase'>,
): string {
  if (session.phase === 'partition' || layer <= 1) {
    return buildPartitionProposalMessage(task, project, session);
  }
  return buildDepthFirstDescentProposalMessage(project, {
    sourceTaskId: task.task_id,
    phase: 'depth_first',
    layer,
    activeGraphId: session.activeGraphId,
    activeGraphGoal: session.activeGraphGoal,
    partitionTitles: [],
    partitionIndex: 0,
    focusPartitionTitle: session.activeGraphGoal,
  });
}

export function buildLayeredGenerateTasksNextLayerMessage(
  layer: number,
  project: Project | null,
  session: GenerateTasksSessionState,
): string {
  return buildDepthFirstDescentProposalMessage(project, { ...session, layer });
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
