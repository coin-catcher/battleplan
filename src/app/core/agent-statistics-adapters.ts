import { getAgentTypeDefinition } from './agent-types';
import type { AgentStatisticsLiveData, AgentStatisticsSnapshot, StatisticValue } from './agent-statistics-model';
import {
  estimatedMetric,
  liveMetric,
  pickCardBadge,
  recordedMetric,
  statisticAmount,
  unavailableMetric,
} from './agent-statistics-model';
import type { AgentType, AgentUsageLedger, ProjectAgent } from './models';
import { effectiveLedgerMetrics } from './agent-usage-ledger';

const OPENAI_ADMIN_DOCS = 'https://platform.openai.com/docs/guides/usage';

function mergeMetric(
  live: number | null | undefined,
  ledgerValue: number,
  liveSource: StatisticValue['source'] | undefined,
  fallbackSource: StatisticValue['source'],
): StatisticValue {
  if (live !== null && live !== undefined && Number.isFinite(live)) {
    return { source: liveSource ?? 'Live', amount: live };
  }
  if (fallbackSource === 'Unavailable') {
    return unavailableMetric();
  }
  if (fallbackSource === 'Estimated') {
    return estimatedMetric(ledgerValue);
  }
  return recordedMetric(ledgerValue);
}

function grokEstimatedCostUsd(tokens: number, inputPerMtok: number, outputPerMtok: number): number {
  if (tokens <= 0) return 0;
  const blendedPerToken = (inputPerMtok + outputPerMtok) / 2 / 1_000_000;
  return tokens * blendedPerToken;
}

function buildChart(snapshot: Pick<AgentStatisticsSnapshot, 'tokensToday' | 'tokensPeriod' | 'costTodayUsd' | 'costPeriodUsd'>, showCost: boolean) {
  return {
    tokensToday: statisticAmount(snapshot.tokensToday),
    tokensPeriod: statisticAmount(snapshot.tokensPeriod),
    costTodayUsd: statisticAmount(snapshot.costTodayUsd),
    costPeriodUsd: statisticAmount(snapshot.costPeriodUsd),
    showCost,
  };
}

function openAiSnapshot(
  agent: ProjectAgent,
  ledger: AgentUsageLedger | undefined,
  live: AgentStatisticsLiveData | null,
  now: string,
): AgentStatisticsSnapshot {
  const stats = getAgentTypeDefinition('OpenAI').statistics;
  const local = effectiveLedgerMetrics(ledger, now);
  const hasAdminKey = Boolean(agent.admin_api_key?.trim());

  if (!hasAdminKey) {
    const tokensRemaining = unavailableMetric('Unavailable—requires org Admin key');
    const unavailable = unavailableMetric();
    const snapshot: AgentStatisticsSnapshot = {
      badge: 'Unavailable',
      tokensToday: unavailable,
      tokensPeriod: unavailable,
      tokensRemaining,
      requestsToday: unavailable,
      requestsPeriod: unavailable,
      costTodayUsd: unavailable,
      costPeriodUsd: unavailable,
      chart: { tokensToday: 0, tokensPeriod: 0, costTodayUsd: 0, costPeriodUsd: 0, showCost: true },
      note: 'Usage and cost require an Organization Admin API key (optional). Chat uses the standard project API key above.',
      adminKeyHint: stats.adminKeyHint,
    };
    return snapshot;
  }

  const ledgerFallback: StatisticValue['source'] = live?.error || !live?.liveSources ? 'Recorded locally' : 'Live';
  const tokensToday = mergeMetric(live?.tokensToday, local.tokensToday, live?.liveSources?.tokensToday, ledgerFallback);
  const tokensPeriod = mergeMetric(live?.tokensPeriod, local.tokensPeriod, live?.liveSources?.tokensPeriod, ledgerFallback);
  const requestsToday = mergeMetric(live?.requestsToday, local.requestsToday, live?.liveSources?.requestsToday, ledgerFallback);
  const requestsPeriod = mergeMetric(live?.requestsPeriod, local.requestsPeriod, live?.liveSources?.requestsPeriod, ledgerFallback);
  const costTodayUsd = mergeMetric(live?.costTodayUsd, 0, live?.liveSources?.costTodayUsd, ledgerFallback);
  const costPeriodUsd = mergeMetric(live?.costPeriodUsd, 0, live?.liveSources?.costPeriodUsd, ledgerFallback);
  const tokensRemaining = live?.tokensRemainingDisplay
    ? unavailableMetric(live.tokensRemainingDisplay)
    : live?.tokensRemaining != null
      ? liveMetric(live.tokensRemaining)
      : unavailableMetric('—');

  const snapshot: AgentStatisticsSnapshot = {
    badge: pickCardBadge([tokensToday, tokensPeriod, requestsToday, requestsPeriod, costTodayUsd, costPeriodUsd]),
    tokensToday,
    tokensPeriod,
    tokensRemaining,
    requestsToday,
    requestsPeriod,
    costTodayUsd,
    costPeriodUsd,
    chart: buildChart({ tokensToday, tokensPeriod, costTodayUsd, costPeriodUsd }, true),
    note: live?.error
      ? `Live OpenAI org usage unavailable (${live.error}). Showing recorded local totals where present.`
      : 'Token balance is not exposed for standard API keys; see OpenAI billing.',
    adminKeyHint: `${stats.adminKeyHint} Docs: ${OPENAI_ADMIN_DOCS}`,
  };
  return snapshot;
}

function localLlmSnapshot(ledger: AgentUsageLedger | undefined, live: AgentStatisticsLiveData | null, now: string): AgentStatisticsSnapshot {
  const local = effectiveLedgerMetrics(ledger, now);
  const tokensToday = mergeMetric(live?.tokensToday, local.tokensToday, 'Live', 'Recorded locally');
  const tokensPeriod = mergeMetric(live?.tokensPeriod, local.tokensPeriod, 'Live', 'Recorded locally');
  const requestsToday = mergeMetric(live?.requestsToday, local.requestsToday, 'Live', 'Recorded locally');
  const requestsPeriod = mergeMetric(live?.requestsPeriod, local.requestsPeriod, 'Live', 'Recorded locally');
  const zero = recordedMetric(0);
  const tokensRemaining: StatisticValue = { source: 'Live', amount: null, display: '∞' };

  const snapshot: AgentStatisticsSnapshot = {
    badge: 'Recorded locally',
    tokensToday,
    tokensPeriod,
    tokensRemaining,
    requestsToday,
    requestsPeriod,
    costTodayUsd: zero,
    costPeriodUsd: zero,
    chart: buildChart(
      { tokensToday, tokensPeriod, costTodayUsd: zero, costPeriodUsd: zero },
      false,
    ),
    note: 'Local inference has no provider billing; remaining tokens are unlimited.',
  };
  return snapshot;
}

function ledgerEstimatedSnapshot(
  agent: ProjectAgent,
  ledger: AgentUsageLedger | undefined,
  live: AgentStatisticsLiveData | null,
  now: string,
  options: { showCost: boolean; costFromLedger?: boolean; remainingDisplay?: string; note?: string; adminKeyHint?: string },
): AgentStatisticsSnapshot {
  const local = effectiveLedgerMetrics(ledger, now);
  const stats = getAgentTypeDefinition(agent.type).statistics;
  let costToday = 0;
  let costPeriod = 0;
  if (options.costFromLedger && stats.priceHintUsdPerMtok) {
    const { input, output } = stats.priceHintUsdPerMtok;
    costToday = grokEstimatedCostUsd(local.tokensToday, input, output);
    costPeriod = grokEstimatedCostUsd(local.tokensPeriod, input, output);
  }

  const tokensToday = mergeMetric(live?.tokensToday, local.tokensToday, 'Live', 'Estimated');
  const tokensPeriod = mergeMetric(live?.tokensPeriod, local.tokensPeriod, 'Live', 'Estimated');
  const requestsToday = mergeMetric(live?.requestsToday, local.requestsToday, 'Live', 'Estimated');
  const requestsPeriod = mergeMetric(live?.requestsPeriod, local.requestsPeriod, 'Live', 'Estimated');
  const costTodayUsd = options.showCost
    ? mergeMetric(live?.costTodayUsd, costToday, 'Live', options.costFromLedger ? 'Estimated' : 'Unavailable')
    : unavailableMetric();
  const costPeriodUsd = options.showCost
    ? mergeMetric(live?.costPeriodUsd, costPeriod, 'Live', options.costFromLedger ? 'Estimated' : 'Unavailable')
    : unavailableMetric();

  const tokensRemaining = options.remainingDisplay
    ? unavailableMetric(options.remainingDisplay)
    : live?.tokensRemainingDisplay
      ? unavailableMetric(live.tokensRemainingDisplay)
      : live?.tokensRemaining != null
        ? liveMetric(live.tokensRemaining)
        : unavailableMetric('—');

  const snapshot: AgentStatisticsSnapshot = {
    badge: pickCardBadge([tokensToday, tokensPeriod, requestsToday, requestsPeriod, costTodayUsd, costPeriodUsd]),
    tokensToday,
    tokensPeriod,
    tokensRemaining,
    requestsToday,
    requestsPeriod,
    costTodayUsd,
    costPeriodUsd,
    chart: buildChart({ tokensToday, tokensPeriod, costTodayUsd, costPeriodUsd }, options.showCost),
    note: options.note ?? live?.error,
    adminKeyHint: options.adminKeyHint,
  };
  return snapshot;
}

function anthropicSnapshot(agent: ProjectAgent, ledger: AgentUsageLedger | undefined, live: AgentStatisticsLiveData | null, now: string): AgentStatisticsSnapshot {
  const stats = getAgentTypeDefinition('Anthropic').statistics;
  const hasAdmin = Boolean(agent.admin_api_key?.trim());
  if (!hasAdmin) {
    return ledgerEstimatedSnapshot(agent, ledger, live, now, {
      showCost: true,
      costFromLedger: false,
      remainingDisplay: 'Unavailable—requires org Admin key',
      note: 'Usage and cost require an Anthropic Admin API key (optional). Chat uses the Messages API key above.',
      adminKeyHint: stats.adminKeyHint,
    });
  }
  return ledgerEstimatedSnapshot(agent, ledger, live, now, {
    showCost: true,
    note: live?.error ? `Live Anthropic admin reports unavailable (${live.error}).` : undefined,
    adminKeyHint: stats.adminKeyHint,
  });
}

function geminiSnapshot(agent: ProjectAgent, ledger: AgentUsageLedger | undefined, live: AgentStatisticsLiveData | null, now: string): AgentStatisticsSnapshot {
  const stats = getAgentTypeDefinition('Gemini').statistics;
  return ledgerEstimatedSnapshot(agent, ledger, live, now, {
    showCost: true,
    costFromLedger: false,
    remainingDisplay: stats.quotaHint ? 'See AI Studio quota' : '—',
    note: stats.quotaHint,
  });
}

function grokSnapshot(agent: ProjectAgent, ledger: AgentUsageLedger | undefined, live: AgentStatisticsLiveData | null, now: string): AgentStatisticsSnapshot {
  return ledgerEstimatedSnapshot(agent, ledger, live, now, {
    showCost: true,
    costFromLedger: true,
    note: 'Costs estimated from recorded token totals and public list prices.',
  });
}

function cursorSnapshot(agent: ProjectAgent, ledger: AgentUsageLedger | undefined, live: AgentStatisticsLiveData | null, now: string): AgentStatisticsSnapshot {
  const stats = getAgentTypeDefinition('Cursor Agent').statistics;
  const hasAdmin = Boolean(agent.admin_api_key?.trim());
  const note = hasAdmin
    ? live?.error
      ? `Enterprise Admin API poll failed (${live.error}); showing BattlePlan ledger.`
      : 'Team usage polled at most once per hour when an Enterprise Admin API key is configured.'
    : agent.cursor_agent_id
      ? 'Configure an Enterprise Admin API key for live team usage; otherwise BattlePlan runs for this cursor_agent_id.'
      : 'Configure an Enterprise Admin API key for live team usage; otherwise local run ledger after first cloud agent launch.';

  return ledgerEstimatedSnapshot(agent, ledger, hasAdmin ? live : null, now, {
    showCost: true,
    note,
    adminKeyHint: stats.requiresEnterpriseAdminKey
      ? 'Optional Enterprise Admin API key on this agent for team usage endpoints.'
      : undefined,
  });
}

export function buildAgentStatisticsSnapshot(
  agent: ProjectAgent,
  ledgerEntry: AgentUsageLedger | undefined,
  live: AgentStatisticsLiveData | null,
  now: string = new Date().toISOString(),
): AgentStatisticsSnapshot {
  switch (agent.type as AgentType) {
    case 'OpenAI':
      return openAiSnapshot(agent, ledgerEntry, live, now);
    case 'LocalLLM':
      return localLlmSnapshot(ledgerEntry, live, now);
    case 'Anthropic':
      return anthropicSnapshot(agent, ledgerEntry, live, now);
    case 'Gemini':
      return geminiSnapshot(agent, ledgerEntry, live, now);
    case 'Grok':
      return grokSnapshot(agent, ledgerEntry, live, now);
    case 'Cursor Agent':
      return cursorSnapshot(agent, ledgerEntry, live, now);
    default:
      return ledgerEstimatedSnapshot(agent, ledgerEntry, live, now, { showCost: false });
  }
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
