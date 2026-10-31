import type { ChatArtifact, Project } from './models';
import type { ProjectTask } from './models';
import { formatGraphIndexForPrompt } from './graph-discovery';
import { parseGeneratedTasksFromSources, type ParsedGeneratedTasks } from './parse-tasks';
import { DISCOVERY_TASK_JSON_CONTRACT } from './discovery-task-schema';
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
  lastImportedMessageKey?: string;
}

export function isGenerateTasksEndCommand(message: string): boolean {
  const token = message.trim().toUpperCase();
  return token === 'END' || token === 'END.' || token.startsWith('END ');
}

export function isGraphCompleteCommand(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  const whole = trimmed.toUpperCase();
  if (whole === 'GRAPH DONE' || whole.startsWith('GRAPH DONE ')) return true;
  for (const line of trimmed.split(/\r?\n/)) {
    const token = line.trim().toUpperCase();
    if (token === 'GRAPH DONE' || token.startsWith('GRAPH DONE ')) return true;
  }
  return false;
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
  'When approved, assign each task a stable `id` slug and write briefs under battleplan/projects/{project_id}/tasks/{id}/outputs/brief.md on your agent branch, then reply with **only** valid JSON: { "tasks": [ ... ], "edges": [] }.',
  DISCOVERY_TASK_JSON_CONTRACT,
  'Battleplan creates local mindmap tasks from JSON, then mirrors those git paths into `{BATTLEPLAN_ROOT}/battleplan/projects/…/tasks/…/` (same layout as GitHub) using the project PAT and your agent branch — no full-repo git pull.',
  'Do not emit task JSON until titles are approved.',
].join('\n');

const DEPTH_FIRST_LINKED_GRAPH_RULES = [
  '## Discovery session: linked task graphs (depth-first)',
  '',
  'You are facilitating discovery for **one active partition**. Propose tasks as a **directed graph**, not a flat checklist or a single “Layer 2” sibling list. Prefer **deep chains** where downstream work consumes upstream **artifacts**.',
  '',
  '### Task definition format (each proposed task)',
  '- **Brief title (3–5 words)** — scannable; parallel naming for siblings (e.g. Create / Reconcile allowlist, Inventory / Standard edge functions).',
  '- **Outcomes** — bullets for what “done” means.',
  '- **Outputs** — named artifacts (docs, specs, files, decisions) other tasks can reference.',
  '- **Inputs** — which upstream **outputs** this task requires or strongly benefits from.',
  '- **Type** — `code` (codebase changes + summary + branch) | `critique` (decision with ≥2 outputs; cycle edge back to upstream for approval gates) | `research` (frontier: `research_mode` **subgraph** to defer a child graph, or **document** for distilled planning data). Most partition subgraph tasks are **code**.',
  'Do not duplicate scope: merge or split so one task owns policy and another owns execution.',
  '',
  '### Prefer series over flat lists',
  'Before proposing a tranche, ask: Does B only make sense after artifact A? Can parallel branches **fan-in** to C? Is there a **gate** (spike/audit) before implementation? If yes, state **parent/child** or **fan-in** edges explicitly. Default to **depth** when uncertainty is high (schema, auth, deploy).',
  '',
  '### Task graph patterns',
  `Catalog: ${PATTERN_CATALOG}.`,
  '- **Spike–Gate** — audit/spike → go/no-go before implementation.',
  '- **Template–Instance Cycle** — standard/template task, then per-entity instances.',
  '- **Critique–Retry Loop** — review → fix (often deeper layers).',
  '- **Leaf Fan-In Refactor** — prerequisites merge into one integration task.',
  '- **Parallel Fan-Out/In** — only when branches are truly independent; **avoid** if the user wants a linear CI/CD pipeline.',
  '- **Subproject→Brainstorm**, **Task Templates**, **Dynamic→Deterministic Converter** — only when the user confirms; do not assume.',
  'Name the pattern and task numbers in your reply. If the user rejects a pattern for specific tasks, drop it from the graph.',
  '',
  '### Multi-pass graph optimization (do this before each reply)',
  '1. **Dependency pass** — every input has a producing task; no cycles unless Critique–Retry is explicit.',
  '2. **Atomicity pass** — one primary deliverable per task; no duplicate outputs.',
  '3. **Now vs Later pass** — align with the partition brief; defer aspirational work to the end of the chain.',
  'Then adjust edges and titles (3–5 words).',
  '',
  '### Interview rounds',
  '- Propose numbered tasks with titles, outcomes, outputs, inputs, **edges** (who feeds whom), and patterns. **No JSON** until the user sends **GRAPH DONE** and every task is approved.',
  '- User: approve / disapprove / change per number.',
  '- On full approval: write briefs under battleplan/projects/{project_id}/tasks/{task_id}/outputs/ on your agent branch, commit, push.',
  DISCOVERY_TASK_JSON_CONTRACT,
  '',
  '### On GRAPH DONE',
  'Summarize the partition graph, index it in your reply, then emit **only** valid JSON: full subgraph (all layers), `edges`, `brief_path`, optional `pattern_id`.',
  'Use cross_graph_edit and cross_graph_edit_rationale when later partitions supersede earlier tasks.',
  'Each task object must include brief_path (and optional git_paths). Battleplan mirrors battleplan/ paths locally from GitHub (project PAT + agent branch).',
  '',
  '### Example spine (illustration — use full task format in interview rounds)',
  '1. Create MVP allowlist → 2. Reconcile MVP allowlist (Spike–Gate); 3. Edge function inventory → 4. Edge function standard (Template–Instance); 5. Local workflow (fan-in 1–4) → 6. CI → 7. CD → 8. Post-MVP.',
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
    `Mindmap tree layer for new nodes under this partition: **${treeLayer}** (structure is a **graph**, not a flat layer-${treeLayer} checklist).`,
    crossGraphNote,
    DEPTH_FIRST_LINKED_GRAPH_RULES,
    '',
    '## Completed task graph index',
    formatGraphIndexForPrompt(project?.graph_discovery_index),
    '',
    `Propose the next **tranche** of the **linked** task graph for partition "${focus}" (edges and artifact flow required).`,
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
