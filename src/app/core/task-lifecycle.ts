import type { LifecyclePhase, OutputType } from './models';
import { LIFECYCLE_PHASES } from './models';
import type { TaskBriefBuildInput } from './task-brief';
import { buildDefaultTaskBrief } from './task-brief';

export { LIFECYCLE_PHASES };
export type { LifecyclePhase };

export function normalizeLifecyclePhase(value: unknown): LifecyclePhase | undefined {
  if (typeof value !== 'string') return undefined;
  const token = value.trim().toLowerCase();
  return (LIFECYCLE_PHASES as readonly string[]).includes(token) ? (token as LifecyclePhase) : undefined;
}

/** Discover/grill phases propose graph deltas; they do not require running later phases in order. */
export function lifecycleAllowsGraphDesign(phase: LifecyclePhase | undefined): boolean {
  return phase === 'discover';
}

export function applyLifecycleBriefDefaults(
  input: TaskBriefBuildInput,
  phase: LifecyclePhase | undefined,
): ReturnType<typeof buildDefaultTaskBrief> {
  const brief = buildDefaultTaskBrief(input);
  if (!phase) return brief;

  switch (phase) {
    case 'discover':
      brief.goal = brief.goal || `Discover and agree scope for "${input.title}".`;
      brief.scope = 'Interactive grilling; emit graph-delta proposals (fan-in, fan-out, parallel paths). No fixed phase order required.';
      brief.verify = 'Human accepts or rejects proposed graph changes in Battleplan; no code merge.';
      brief.forbidden = 'Do not treat lifecycle phases as a mandatory serial pipeline; shape the graph to fit the feature.';
      break;
    case 'architect':
      brief.scope = `Architecture and interfaces for "${input.title}" before implementation tasks run.`;
      brief.verify = 'ADRs, diagrams, or interface specs linked in repo or research output.';
      break;
    case 'build':
      brief.scope = `Implement "${input.title}" on the agent branch with tests where applicable.`;
      break;
    case 'verify':
      brief.verify = 'Tests, metrics, and spec review recorded; verdict keyed to commit SHA when applicable.';
      brief.report = 'Verification ledger entry: pass/fail, evidence links, SHA.';
      break;
    case 'ship':
      brief.scope = 'Release, docs, and handoff to operations or humans.';
      brief.verify = 'Develop/main policy satisfied via Battleplan approve flow.';
      break;
    default:
      break;
  }
  return brief;
}

export function defaultOutputTypeForPhase(phase: LifecyclePhase | undefined): OutputType | undefined {
  if (phase === 'discover' || phase === 'architect') return 'research';
  if (phase === 'build' || phase === 'verify') return 'code';
  if (phase === 'ship') return 'code';
  return undefined;
}
