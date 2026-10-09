import type { AgentStatisticsLiveData } from '../src/app/core/agent-statistics-model';
import type { AgentType } from '../src/app/core/models';

export interface AgentStatisticsFetchInput {
  type: AgentType;
  url: string;
  adminApiKey?: string;
  apiKey?: string;
  cursorAgentId?: string;
}

const REQUEST_TIMEOUT_MS = 30_000;

function utcDayStartSeconds(now: Date): number {
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000);
}

function utcMonthStartSeconds(now: Date): number {
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000);
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`${response.status}${text ? `: ${text.slice(0, 120)}` : ''}`);
    }
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

function sumOpenAiCompletionUsage(payload: unknown): { tokens: number; requests: number } {
  let tokens = 0;
  let requests = 0;
  const data = (payload as { data?: unknown[] })?.data;
  if (!Array.isArray(data)) return { tokens, requests };
  for (const bucket of data) {
    const results = (bucket as { results?: unknown[] })?.results;
    if (!Array.isArray(results)) continue;
    for (const row of results) {
      const input = Number((row as { input_tokens?: number }).input_tokens ?? 0);
      const output = Number((row as { output_tokens?: number }).output_tokens ?? 0);
      tokens += input + output;
      requests += Number((row as { num_model_requests?: number }).num_model_requests ?? 0);
    }
  }
  return { tokens, requests };
}

function sumOpenAiCostsUsd(payload: unknown): number {
  let cents = 0;
  const data = (payload as { data?: unknown[] })?.data;
  if (!Array.isArray(data)) return 0;
  for (const bucket of data) {
    const results = (bucket as { results?: unknown[] })?.results;
    if (!Array.isArray(results)) continue;
    for (const row of results) {
      cents += Number((row as { amount?: { value?: number } }).amount?.value ?? (row as { amount?: number }).amount ?? 0);
    }
  }
  return cents / 100;
}

async function fetchOpenAiOrgLive(adminKey: string): Promise<AgentStatisticsLiveData> {
  const now = new Date();
  const end = nowSeconds();
  const dayStart = utcDayStartSeconds(now);
  const monthStart = utcMonthStartSeconds(now);
  const headers = { Authorization: `Bearer ${adminKey}`, 'Content-Type': 'application/json' };

  const [dayUsage, periodUsage, dayCost, periodCost] = await Promise.all([
    fetchJson(`https://api.openai.com/v1/organization/usage/completions?start_time=${dayStart}&end_time=${end}&bucket_width=1d`, { headers }),
    fetchJson(`https://api.openai.com/v1/organization/usage/completions?start_time=${monthStart}&end_time=${end}&bucket_width=1d`, { headers }),
    fetchJson(`https://api.openai.com/v1/organization/costs?start_time=${dayStart}&end_time=${end}&bucket_width=1d`, { headers }),
    fetchJson(`https://api.openai.com/v1/organization/costs?start_time=${monthStart}&end_time=${end}&bucket_width=1d`, { headers }),
  ]);

  const day = sumOpenAiCompletionUsage(dayUsage);
  const period = sumOpenAiCompletionUsage(periodUsage);
  return {
    tokensToday: day.tokens,
    tokensPeriod: period.tokens,
    requestsToday: day.requests,
    requestsPeriod: period.requests,
    costTodayUsd: sumOpenAiCostsUsd(dayCost),
    costPeriodUsd: sumOpenAiCostsUsd(periodCost),
    liveSources: {
      tokensToday: 'Live',
      tokensPeriod: 'Live',
      requestsToday: 'Live',
      requestsPeriod: 'Live',
      costTodayUsd: 'Live',
      costPeriodUsd: 'Live',
    },
  };
}

async function fetchAnthropicAdminLive(adminKey: string): Promise<AgentStatisticsLiveData> {
  const now = new Date();
  const end = now.toISOString();
  const dayStart = new Date(utcDayStartSeconds(now) * 1000).toISOString();
  const monthStart = new Date(utcMonthStartSeconds(now) * 1000).toISOString();
  const headers = {
    'x-api-key': adminKey,
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json',
  };

  const usageBody = (starting: string, ending: string) => ({
    starting_at: starting,
    ending_at: ending,
    bucket_width: '1d',
  });

  const [dayUsage, periodUsage, dayCost, periodCost] = await Promise.all([
    fetchJson('https://api.anthropic.com/v1/organizations/usage_report/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify(usageBody(dayStart, end)),
    }),
    fetchJson('https://api.anthropic.com/v1/organizations/usage_report/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify(usageBody(monthStart, end)),
    }),
    fetchJson('https://api.anthropic.com/v1/organizations/cost_report', {
      method: 'POST',
      headers,
      body: JSON.stringify(usageBody(dayStart, end)),
    }),
    fetchJson('https://api.anthropic.com/v1/organizations/cost_report', {
      method: 'POST',
      headers,
      body: JSON.stringify(usageBody(monthStart, end)),
    }),
  ]);

  const sumUsageTokens = (payload: unknown): number => {
    let total = 0;
    const buckets = (payload as { data?: unknown[] })?.data;
    if (!Array.isArray(buckets)) return 0;
    for (const bucket of buckets) {
      total += Number((bucket as { input_tokens?: number }).input_tokens ?? 0);
      total += Number((bucket as { output_tokens?: number }).output_tokens ?? 0);
    }
    return total;
  };

  const sumCostUsd = (payload: unknown): number => {
    let cents = 0;
    const buckets = (payload as { data?: unknown[] })?.data;
    if (!Array.isArray(buckets)) return 0;
    for (const bucket of buckets) {
      const amount = (bucket as { amount?: string | number }).amount;
      cents += typeof amount === 'string' ? Number.parseFloat(amount) : Number(amount ?? 0);
    }
    return cents / 100;
  };

  return {
    tokensToday: sumUsageTokens(dayUsage),
    tokensPeriod: sumUsageTokens(periodUsage),
    costTodayUsd: sumCostUsd(dayCost),
    costPeriodUsd: sumCostUsd(periodCost),
    liveSources: {
      tokensToday: 'Live',
      tokensPeriod: 'Live',
      costTodayUsd: 'Live',
      costPeriodUsd: 'Live',
    },
  };
}

async function fetchCursorAdminLive(adminKey: string, baseUrl: string): Promise<AgentStatisticsLiveData> {
  const root = baseUrl.replace(/\/v1\/?$/, '');
  const headers = {
    Authorization: `Bearer ${adminKey}`,
    'Content-Type': 'application/json',
  };
  const now = new Date();
  const dayStart = utcDayStartSeconds(now);
  const monthStart = utcMonthStartSeconds(now);
  const end = nowSeconds();

  const usagePayload = {
    startTime: dayStart,
    endTime: end,
  };

  const spendPayload = {
    startTime: monthStart,
    endTime: end,
  };

  const [usage, spend] = await Promise.all([
    fetchJson(`${root}/teams/filtered-usage-events`, {
      method: 'POST',
      headers,
      body: JSON.stringify(usagePayload),
    }).catch(() => null),
    fetchJson(`${root}/teams/spend`, {
      method: 'POST',
      headers,
      body: JSON.stringify(spendPayload),
    }).catch(() => null),
  ]);

  let tokensToday = 0;
  let costTodayUsd = 0;
  let costPeriodUsd = 0;
  let tokensRemaining: number | null = null;

  const events = (usage as { events?: unknown[] })?.events;
  if (Array.isArray(events)) {
    for (const event of events) {
      tokensToday += Number((event as { tokenUsage?: number }).tokenUsage ?? 0);
      costTodayUsd += Number((event as { chargedCents?: number }).chargedCents ?? 0) / 100;
    }
  }

  const spendData = spend as { totalChargedCents?: number; remainingCents?: number; limitCents?: number };
  if (spendData?.totalChargedCents != null) {
    costPeriodUsd = Number(spendData.totalChargedCents) / 100;
  }
  if (spendData?.limitCents != null && spendData.remainingCents != null) {
    tokensRemaining = null;
  }

  return {
    tokensToday,
    tokensPeriod: tokensToday,
    costTodayUsd,
    costPeriodUsd,
    tokensRemaining,
    liveSources: {
      tokensToday: 'Live',
      costTodayUsd: 'Live',
      costPeriodUsd: 'Live',
    },
  };
}

function parsePrometheusCounter(text: string, metricName: string): number | null {
  const line = text.split('\n').find((row) => row.startsWith(metricName) && !row.startsWith('#'));
  if (!line) return null;
  const parts = line.trim().split(/\s+/);
  const value = Number(parts[parts.length - 1]);
  return Number.isFinite(value) ? value : null;
}

async function fetchVllmMetricsLive(baseUrl: string): Promise<AgentStatisticsLiveData> {
  const origin = baseUrl.replace(/\/v1\/?$/, '');
  const metricsUrl = `${origin}/metrics`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(metricsUrl, { signal: controller.signal });
    if (!response.ok) throw new Error(String(response.status));
    const text = await response.text();
    const totalTokens = parsePrometheusCounter(text, 'vllm:iteration_tokens_total_sum')
      ?? parsePrometheusCounter(text, 'vllm:prompt_tokens_total');
    if (totalTokens == null) {
      return { error: 'No token counters in /metrics' };
    }
    return {
      tokensPeriod: totalTokens,
      liveSources: { tokensPeriod: 'Live' },
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchAgentStatisticsLive(input: AgentStatisticsFetchInput): Promise<AgentStatisticsLiveData> {
  try {
    switch (input.type) {
      case 'OpenAI': {
        const key = input.adminApiKey?.trim();
        if (!key) return { error: 'missing_admin_key' };
        return await fetchOpenAiOrgLive(key);
      }
      case 'Anthropic': {
        const key = input.adminApiKey?.trim();
        if (!key) return { error: 'missing_admin_key' };
        return await fetchAnthropicAdminLive(key);
      }
      case 'Cursor Agent': {
        const key = input.adminApiKey?.trim();
        if (!key) return { error: 'missing_admin_key' };
        return await fetchCursorAdminLive(key, input.url);
      }
      case 'LocalLLM':
        return await fetchVllmMetricsLive(input.url);
      default:
        return { error: 'unsupported_live_adapter' };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'fetch_failed';
    return { error: message };
  }
}
