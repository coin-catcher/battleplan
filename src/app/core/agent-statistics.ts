import type { AgentStatisticsLiveData, AgentStatisticsSnapshot } from './agent-statistics-model';
export type {
  AgentStatisticsChart,
  AgentStatisticsLiveData,
  AgentStatisticsSnapshot,
  StatisticValue,
  StatisticsSource,
} from './agent-statistics-model';
export {
  formatStatisticValue,
  pickCardBadge,
  statisticAmount,
} from './agent-statistics-model';
export { buildAgentStatisticsSnapshot, statisticsLabelForType } from './agent-statistics-adapters';
import { buildAgentStatisticsSnapshot } from './agent-statistics-adapters';
import type { AgentUsageLedger, ProjectAgent } from './models';

/** Synchronous snapshot without live provider polls (ledger + static rules only). */
export function agentStatisticsSnapshot(
  agent: ProjectAgent,
  ledgerEntry?: AgentUsageLedger,
  live?: AgentStatisticsLiveData | null,
  now?: string,
): AgentStatisticsSnapshot {
  return buildAgentStatisticsSnapshot(agent, ledgerEntry, live ?? null, now);
}

/** @deprecated Use buildAgentStatisticsSnapshot / AgentStatisticsService */
export function openAiStatisticsSnapshot(agent: ProjectAgent): AgentStatisticsSnapshot {
  return buildAgentStatisticsSnapshot(agent, undefined, null);
}
