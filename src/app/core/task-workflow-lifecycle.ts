import type { Project, ProjectTask } from './models';
import type { TaskBrief } from './task-brief';
import type { WorkflowTaskKind } from './workflow-task-kind';

export function inferWorkflowKindFromTask(
  task: Pick<ProjectTask, 'node_kind' | 'output_type' | 'lifecycle_phase'>,
): WorkflowTaskKind | undefined {
  if (task.node_kind === 'brainstorm') return 'brainstorming';
  if (task.node_kind === 'critique') return 'critiquing';
  if (task.node_kind === 'architect') return 'architect';
  if (task.output_type === 'code' && (task.node_kind === 'work' || !task.node_kind)) return 'code';
  if (task.output_type === 'research') {
    if (task.lifecycle_phase === 'architect') return 'architect';
    if (task.node_kind === 'work' || !task.node_kind) return 'research';
  }
  return undefined;
}

/** Default HITL grilling for interactive workflow tasks. */
export function defaultLoopModeForNodeKind(kind: TaskNodeKind | undefined): 'HITL' | 'AFK' | undefined {
  if (kind === 'brainstorm' || kind === 'critique' || kind === 'fog' || kind === 'decision') return 'HITL';
  return undefined;
}

export function applyWorkflowKindBriefDefaults(brief: TaskBrief, kind: WorkflowTaskKind, title: string): TaskBrief {
  const next = { ...brief };
  switch (kind) {
    case 'brainstorming':
      next.scope = [
        'Interactive brainstorming (Matt-style grilling): multi-round dialogue with the human.',
        'Each round: absorb user feedback and questions, add new ideas and facts (web search, repo data, prior context),',
        'distill an updated shared understanding, then ask focused follow-up questions.',
        'Stop when the human declares the brainstorm ready to hand off (typically Generate Tasks → task graph).',
      ].join(' ');
      next.acceptance = 'Human agrees the distilled plan is ready; optional task graph generated from this task.';
      next.verify = 'Human marks REVIEW/DONE when satisfied; no code merge from this task.';
      next.forbidden = 'Do not implement product code or open PRs; do not skip human confirmation rounds.';
      next.report = 'End each round with: distilled understanding, open questions, suggested next step (often Generate Tasks).';
      break;
    case 'research':
      next.scope = [
        'Research grilling: (1) confirm with the human what will be researched and the definition of done (goal outputs),',
        '(2) execute research, (3) validate deliverables against that definition of done before claiming completion.',
      ].join(' ');
      next.acceptance = `Research artifacts under research/{project_id}/{task_id}/ that meet the agreed definition of done for "${title}".`;
      next.verify = 'Self-check outputs against definition of done; if blocked, list blockers for the human.';
      next.forbidden = 'Do not change application source code; do not mark complete while DoD is unmet.';
      next.report = 'Cite sources; state DoD checklist pass/fail; list blockers if any.';
      break;
    case 'critiquing':
      next.scope = [
        'Critique grilling: confirm with the human the goal, scoring rubric, and pass threshold for upstream work,',
        'then review preceding tasks (commits, artifacts, summaries), score against the rubric, and decide pass vs rework.',
      ].join(' ');
      next.acceptance = 'Clear pass/fail verdict with evidence; on fail, actionable rework guidance for upstream tasks.';
      next.verify = 'Quantified comparison to threshold; human agrees rubric and threshold before final verdict.';
      next.forbidden = 'Do not approve work that fails the agreed threshold; do not rewrite upstream code in this task.';
      next.report = 'Verdict, scores, gaps, and rework instructions keyed to upstream task ids/commits.';
      break;
    case 'architect':
      next.scope = `Review commits and patterns across related tasks; consolidate design for "${title}".`;
      break;
    case 'code':
      break;
    default:
      break;
  }
  return next;
}

const GRILL_ROUND_RULES = [
  'Grilling rules (every round):',
  '- Treat the human as the source of truth for scope and readiness.',
  '- Reflect their feedback explicitly before adding new material.',
  '- Ask concise questions when requirements, DoD, or rubric are ambiguous.',
  '- Do not claim the task is complete until the human confirms handoff criteria in chat.',
].join('\n');

export function workflowExecutionPreamble(
  kind: WorkflowTaskKind,
  task: ProjectTask,
  project: Project,
): string {
  const common = [
    `Battleplan workflow: ${kind} (task "${task.title}").`,
    GRILL_ROUND_RULES,
    `Project: ${project.title}.`,
  ];
  switch (kind) {
    case 'brainstorming':
      return [
        ...common,
        'You are the first step in idea → task graph → execute tasks → committed PR.',
        'Use the user initial prompt as the seed idea. Expand with web search, repository context, and reasoning.',
        'Each assistant turn must include: (1) distilled understanding, (2) new questions for the user.',
        'When the user says the brainstorm is ready, summarize handoff context for Generate Tasks (goals, constraints, suggested task breakdown).',
        'Do not run downstream code tasks yourself; the human uses Generate Tasks on this node.',
      ].join('\n\n');
    case 'research':
      return [
        ...common,
        'Before heavy research, grill the user: restate the research question, proposed methods, and definition of done (output shape and quality bar).',
        'Only after alignment, perform research and write outputs under research/{project_id}/{task_id}/ in the repo.',
        'Before finishing, test/check outputs against the definition of done; report blockers instead of silently stopping.',
      ].join('\n\n');
    case 'critiquing':
      return [
        ...common,
        'Upstream tasks must be complete enough to review (commits, artifacts, handoffs).',
        'Grill the user first: confirm the goal, metrics/rubric, and pass threshold for upstream outputs.',
        'Then evaluate upstream work against that rubric with evidence (links, SHAs, file paths).',
        'If below threshold: FAIL with structured rework guidance so upstream tasks can pass the next critique round.',
        'If at/above threshold: PASS and state what may proceed downstream.',
      ].join('\n\n');
    case 'architect':
      return [
        ...common,
        'Review related commits and task outputs; propose consolidations, ADRs, or interface changes before further code tasks.',
      ].join('\n\n');
    case 'code':
      return [
        ...common,
        'Implement on the agent branch; commit and push; summarize changes for critique/upstream handoff.',
      ].join('\n\n');
    default:
      return common.join('\n\n');
  }
}

export function workflowFeedbackPreamble(task: ProjectTask): string | undefined {
  const kind = inferWorkflowKindFromTask(task);
  if (!kind || kind === 'code') return undefined;
  return [
    `Continue the ${kind} workflow (grilling round).`,
    'Incorporate the user message, update distilled understanding, and ask any new clarifying questions.',
    kind === 'brainstorming'
      ? 'If the user signals readiness, produce a handoff summary suitable for Generate Tasks.'
      : kind === 'research'
        ? 'Re-check definition of done; state blockers if deliverables are not yet sufficient.'
        : kind === 'critiquing'
          ? 'Revisit rubric/threshold if the user changed expectations; update pass/fail and rework guidance.'
          : '',
  ].filter(Boolean).join('\n');
}

export function workflowHintForTask(
  task: Pick<ProjectTask, 'node_kind' | 'output_type' | 'lifecycle_phase'>,
): string | undefined {
  switch (inferWorkflowKindFromTask(task)) {
    case 'brainstorming':
      return 'Brainstorming: multi-round chat until you are ready, then use Generate Tasks to create the task graph.';
    case 'research':
      return 'Research: confirm definition of done in chat before deep research; the agent validates outputs before completion.';
    case 'critiquing':
      return 'Critiquing: agree on rubric and pass threshold in chat, then review upstream outputs; failed work returns for rework.';
    case 'architect':
      return 'Architect: review cross-task commits and align design before more code tasks run.';
    case 'code':
      return undefined;
    default:
      return undefined;
  }
}
