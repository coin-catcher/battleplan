import type { ChatArtifact, Project } from './models';
import type { ProjectTask } from './models';
import { formatGraphIndexForPrompt } from './graph-discovery';
import { parseGeneratedTasksFromSources, type ParsedGeneratedTasks } from './parse-tasks';
import { JSON_TASK_LIST_RULES } from './generate-tasks-shared';

export type DiscoveryPhase = 'partition' | 'depth_first' | 'cluster_review' | 'architecture_pass';

export interface GenerateTasksSessionState {
  sourceTaskId: string;
  phase: DiscoveryPhase;
  layer: number;
  activeGraphId: string;
  activeGraphGoal: string;
  partitionTitles: string[];
  partitionIndex: number;
  focusPartitionTitle?: string;
  /** User sent GRAPH DONE; next JSON import finalizes this partition graph. */
  awaitingGraphJson?: boolean;
  /** Process-end orchestration after all partition graphs are indexed. */
  closingStep?: 'cluster_review' | 'architecture';
  architecturePromptSent?: boolean;
}

export function isGenerateTasksEndCommand(message: string): boolean {
  const token = message.trim().toUpperCase();
  return token === 'END' || token === 'END.' || token.startsWith('END ');
}

export function isGraphCompleteCommand(message: string): boolean {
  const token = message.trim().toUpperCase();
  return token === 'GRAPH DONE' || token.startsWith('GRAPH DONE ');
}

const PATTERN_CATALOG = [
  'Critique–Retry Loop',
  'Leaf Fan-In Refactor',
  'Template–Instance Cycle',
  'Task Templates',
  'Spike–Gate',
  'Parallel Fan-Out/In',
  'Subproject→Brainstorm',
  'Dynamic→Deterministic Converter',
].join(', ');

const TITLE_REVIEW_RULES = [
  'Discovery session (active).',
  'Respond with a numbered list of suggested task **titles only** (no JSON yet).',
  'The user will reply with approve, disapprove, or change per number.',
  'Repeat until every item is approved.',
  'When approved, write briefs under battleplan/projects/{project_id}/tasks/{task_id}/outputs/ in git, then reply with **only** valid JSON: { "tasks": [ ... ], "edges": [] }.',
  'Do not emit task JSON until titles are approved.',
].join('\n');

const DEPTH_FIRST_INTERVIEW_RULES = [
  '**Depth-first interview** for the active partition only.',
  'Propose the **next layer** of task titles (numbered). In each round, call out where a **task graph pattern** applies and **highlight** those subgraphs in your reply (pattern name + which titles participate).',
  'You may suggest **multiple layers in one response** when a pattern spans them; still use titles only until the user sends **GRAPH DONE**.',
  'When the user sends **GRAPH DONE**, summarize the partition graph, index it in your reply, then emit **only** valid JSON for the **full** task graph for this partition (all layers, edges, pattern_id fields).',
  'If this is not the first partition graph, **highlight** any tasks from prior graphs that must change, merge, or be removed (set cross_graph_edit and cross_graph_edit_rationale on those tasks in the final JSON).',
  `Task graph patterns: ${PATTERN_CATALOG}.`,
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
    '',
    '## Completed task graph index',
    formatGraphIndexForPrompt(project?.graph_discovery_index),
    '',
    '**Phase: partition (Layer 1)** — propose top-level **problem-space partition** titles only (direct children of this discovery root).',
    'Iterate with the user (approve / disapprove / change) until Layer 1 is agreed, then emit JSON for the partition tasks only.',
    TITLE_REVIEW_RULES,
  ].filter(Boolean).join('\n\n');
}

export function buildDepthFirstDescentProposalMessage(
  project: Project | null,
  session: GenerateTasksSessionState,
): string {
  const focus = session.focusPartitionTitle ?? session.activeGraphGoal;
  const treeLayer = session.layer + 1;
  const partitionNum = session.partitionIndex + 1;
  const crossGraphNote = partitionNum > 1
    ? 'Prior completed graphs are listed below — avoid duplicate work; call out cross-graph edits explicitly.'
    : '';
  return [
    `Start depth-first discovery for partition ${partitionNum}/${Math.max(session.partitionTitles.length, 1)}: **${focus}**.`,
    `Active graph: \`${session.activeGraphId}\` — ${focus}`,
    crossGraphNote,
    DEPTH_FIRST_INTERVIEW_RULES,
    '',
    '## Completed task graph index',
    formatGraphIndexForPrompt(project?.graph_discovery_index),
    '',
    `Propose **Layer ${treeLayer}** task titles under partition "${focus}" (first tranche of this graph).`,
    TITLE_REVIEW_RULES,
  ].filter(Boolean).join('\n\n');
}

export function buildDiscoveryClusterReviewMessage(
  project: Project | null,
  sourceTask: ProjectTask,
): string {
  return [
    '**Start Discovery — process end (cluster review)**',
    `Review all partitions and completed task graphs for "${sourceTask.title}".`,
    'Identify clusters of task graphs that are related by **function** (similar problems), **form** (similar solution shape), or **blast radius** (same system components).',
    'Prefer groups of **3–6** graphs when possible.',
    'Respond with numbered cluster descriptions (graph_id + rationale). If no clusters apply, say so explicitly.',
    '',
    '## Completed task graph index',
    formatGraphIndexForPrompt(project?.graph_discovery_index),
  ].join('\n\n');
}

export function buildDiscoveryArchitectureFanInMessage(project: Project | null): string {
  return [
    '**Start Discovery — architecture fan-in (Refactor pattern)**',
    'For each cluster you identified, propose **Architecture** tasks that fan in to the **final leaf code tasks** of those graphs.',
    'Goal: review, standardize, and improve code produced across the clustered graphs (Leaf Fan-In Refactor / architect nodes).',
    'Reply with **only** valid JSON for **new** Architecture tasks (and any edges); use pattern_id `leaf_fan_in_refactor` where appropriate.',
    '',
    '## Completed task graph index',
    formatGraphIndexForPrompt(project?.graph_discovery_index),
    JSON_TASK_LIST_RULES,
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
  return buildDiscoveryArchitectureFanInMessage(project);
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
