import type { AgentType, ProjectAgent } from './models';
import { getAgentTypeDefinition } from './agent-types';

export type AgentStatisticsBadge = 'Live' | 'Estimated' | 'Recorded locally' | 'Unavailable';

export interface AgentStatisticsSnapshot {
  badge: AgentStatisticsBadge;
  tokensToday: number | null;
  tokensPeriod: number | null;
  tokensRemaining: number | null;
  /** When set (e.g. LocalLLM ∞), shown instead of formatting tokensRemaining. */
  tokensRemainingDisplay?: string;
  requestsToday: number | null;
  requestsPeriod: number | null;
  costTodayUsd: number | null;
  costPeriodUsd: number | null;
  note?: string;
  adminKeyHint?: string;
}

export function openAiStatisticsSnapshot(agent: ProjectAgent): AgentStatisticsSnapshot {
  const stats = getAgentTypeDefinition('OpenAI').statistics;
  const hasAdminKey = Boolean(agent.admin_api_key?.trim());
  if (!hasAdminKey) {
    return {
      badge: 'Unavailable',
      tokensToday: null,
      tokensPeriod: null,
      tokensRemaining: null,
      requestsToday: null,
      requestsPeriod: null,
      costTodayUsd: null,
      costPeriodUsd: null,
      note: 'Usage and cost require an Organization Admin API key (optional). Chat uses the standard project API key above.',
      adminKeyHint: stats.adminKeyHint,
    };
  }
  return {
    badge: 'Live',
    tokensToday: null,
    tokensPeriod: null,
    tokensRemaining: null,
    requestsToday: null,
    requestsPeriod: null,
    costTodayUsd: null,
    costPeriodUsd: null,
    note: 'OpenAI org Admin usage/cost endpoints will populate these metrics when wired (adapter: openai_org_admin).',
    adminKeyHint: stats.adminKeyHint,
  };
}

function cursorAgentStatisticsSnapshot(agent: ProjectAgent): AgentStatisticsSnapshot {
  const stats = getAgentTypeDefinition('Cursor Agent').statistics;
  return {
    badge: 'Recorded locally',
    tokensToday: null,
    tokensPeriod: null,
    tokensRemaining: null,
    requestsToday: null,
    requestsPeriod: null,
    costTodayUsd: null,
    costPeriodUsd: null,
    note: agent.cursor_agent_id
      ? 'Enterprise Admin API when configured; otherwise BattlePlan runs for this cursor_agent_id.'
      : 'Enterprise Admin API when configured; otherwise local run ledger after first cloud agent launch.',
    adminKeyHint: stats.requiresEnterpriseAdminKey
      ? 'Optional Enterprise Admin API key on this agent for team usage endpoints.'
      : undefined,
  };
}

function localLlmStatisticsSnapshot(): AgentStatisticsSnapshot {
  return {
    badge: 'Recorded locally',
    tokensToday: 0,
    tokensPeriod: 0,
    tokensRemaining: null,
    tokensRemainingDisplay: '∞',
    requestsToday: 0,
    requestsPeriod: 0,
    costTodayUsd: 0,
    costPeriodUsd: 0,
    note: 'Local inference has no provider billing; remaining tokens are unlimited.',
  };
}

export function agentStatisticsSnapshot(agent: ProjectAgent): AgentStatisticsSnapshot {
  if (agent.type === 'OpenAI') return openAiStatisticsSnapshot(agent);
  if (agent.type === 'Cursor Agent') return cursorAgentStatisticsSnapshot(agent);
  if (agent.type === 'LocalLLM') return localLlmStatisticsSnapshot();
  const stats = getAgentTypeDefinition(agent.type).statistics;
  return {
    badge: 'Unavailable',
    tokensToday: null,
    tokensPeriod: null,
    tokensRemaining: null,
    requestsToday: null,
    requestsPeriod: null,
    costTodayUsd: null,
    costPeriodUsd: null,
    note: `Statistics adapter "${stats.adapter}" is not configured for ${agent.type} yet.`,
  };
}

export function statisticsLabelForType(type: AgentType): string {
  if (type === 'OpenAI') {
    return 'Tokens remaining are not exposed for standard sk- project keys; add an optional Organization Admin API key for live usage and cost.';
  }
  if (type === 'Cursor Agent') {
    return 'Poll team usage at most once per hour when an Enterprise Admin API key is configured.';
  }
  if (type === 'LocalLLM') {
    return 'Throughput may also be read from vLLM Prometheus /metrics when wired; costs are always zero.';
  }
  return '';
}
