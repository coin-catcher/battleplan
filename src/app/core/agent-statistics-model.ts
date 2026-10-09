export type StatisticsSource = 'Live' | 'Estimated' | 'Recorded locally' | 'Unavailable';

export interface StatisticValue {
  source: StatisticsSource;
  amount: number | null;
  /** When set, shown instead of formatting amount (e.g. ∞, Unavailable—requires org Admin key). */
  display?: string;
}

export interface AgentStatisticsChart {
  tokensToday: number;
  tokensPeriod: number;
  costTodayUsd: number;
  costPeriodUsd: number;
  showCost: boolean;
}

export interface AgentStatisticsSnapshot {
  badge: StatisticsSource;
  tokensToday: StatisticValue;
  tokensPeriod: StatisticValue;
  tokensRemaining: StatisticValue;
  requestsToday: StatisticValue;
  requestsPeriod: StatisticValue;
  costTodayUsd: StatisticValue;
  costPeriodUsd: StatisticValue;
  chart: AgentStatisticsChart;
  note?: string;
  adminKeyHint?: string;
}

export interface AgentStatisticsLiveData {
  tokensToday?: number | null;
  tokensPeriod?: number | null;
  requestsToday?: number | null;
  requestsPeriod?: number | null;
  costTodayUsd?: number | null;
  costPeriodUsd?: number | null;
  tokensRemaining?: number | null;
  tokensRemainingDisplay?: string;
  liveSources?: Partial<Record<keyof AgentStatisticsSnapshot, StatisticsSource>>;
  error?: string;
}

export function statisticAmount(value: StatisticValue): number {
  return value.amount ?? 0;
}

export function formatStatisticValue(value: StatisticValue, formatNumber: (n: number) => string, formatCost?: (n: number) => string): string {
  if (value.display !== undefined) return value.display;
  if (value.amount === null) return '—';
  if (formatCost) return formatCost(value.amount);
  return formatNumber(value.amount);
}

export function recordedMetric(amount: number): StatisticValue {
  return { source: 'Recorded locally', amount };
}

export function estimatedMetric(amount: number): StatisticValue {
  return { source: 'Estimated', amount };
}

export function liveMetric(amount: number): StatisticValue {
  return { source: 'Live', amount };
}

export function unavailableMetric(display = '—'): StatisticValue {
  return { source: 'Unavailable', amount: null, display };
}

export function pickCardBadge(values: StatisticValue[]): StatisticsSource {
  const order: StatisticsSource[] = ['Live', 'Estimated', 'Recorded locally', 'Unavailable'];
  for (const level of order) {
    if (values.some((item) => item.source === level)) return level;
  }
  return 'Unavailable';
}
