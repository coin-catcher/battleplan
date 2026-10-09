import type { AgentType, AgentUsageLedger } from './models';
import { getAgentTypeDefinition } from './agent-types';

export type AgentStatisticsSourceBadge = 'live' | 'estimated' | 'recorded_locally' | 'unavailable';

export interface AgentStatisticsSnapshot {
  tokensToday: number | null;
  tokensPeriod: number | null;
  tokensRemaining: number | 'infinity' | null;
  requestsToday: number | null;
  requestsPeriod: number | null;
  costTodayUsd: number | null;
  costPeriodUsd: number | null;
  sourceBadge: AgentStatisticsSourceBadge;
  note?: string;
}

function calendarMonthUtc(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function normalizeUsageLedgerMonth(ledger: AgentUsageLedger | undefined): AgentUsageLedger {
  const month = calendarMonthUtc();
  if (!ledger || ledger.calendar_month !== month) {
    return {
      calendar_month: month,
      tokens_today: 0,
      tokens_period: 0,
      requests_today: 0,
      requests_period: 0,
    };
  }
  return ledger;
}

export function buildLocalLlmStatistics(ledger?: AgentUsageLedger): AgentStatisticsSnapshot {
  const normalized = normalizeUsageLedgerMonth(ledger);
  return {
    tokensToday: normalized.tokens_today ?? 0,
    tokensPeriod: normalized.tokens_period ?? 0,
    tokensRemaining: 'infinity',
    requestsToday: normalized.requests_today ?? 0,
    requestsPeriod: normalized.requests_period ?? 0,
    costTodayUsd: 0,
    costPeriodUsd: 0,
    sourceBadge: 'recorded_locally',
    note: 'Local inference has no provider billing; remaining tokens are unlimited.',
  };
}

export function buildAgentStatisticsSnapshot(
  type: AgentType,
  ledger?: AgentUsageLedger,
): AgentStatisticsSnapshot {
  const adapter = getAgentTypeDefinition(type).statistics.adapter;
  if (adapter === 'vllm_metrics_plus_ledger') return buildLocalLlmStatistics(ledger);
  return {
    tokensToday: null,
    tokensPeriod: null,
    tokensRemaining: null,
    requestsToday: null,
    requestsPeriod: null,
    costTodayUsd: null,
    costPeriodUsd: null,
    sourceBadge: 'unavailable',
    note: 'Statistics for this provider are not configured yet.',
  };
}

export function formatTokensRemaining(value: number | 'infinity' | null): string {
  if (value === 'infinity') return '∞';
  if (value === null) return '—';
  return String(value);
}

export function formatUsd(value: number | null): string {
  if (value === null) return '—';
  return `$${value.toFixed(2)}`;
}
