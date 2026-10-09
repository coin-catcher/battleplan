import type { AgentUsageLedger } from './models';

function calendarMonth(iso: string): string {
  return iso.slice(0, 7);
}

function calendarDay(iso: string): string {
  return iso.slice(0, 10);
}

export function effectiveLedgerMetrics(
  ledger: AgentUsageLedger | undefined,
  now: string,
): { tokensToday: number; tokensPeriod: number; requestsToday: number; requestsPeriod: number } {
  const month = calendarMonth(now);
  const day = calendarDay(now);
  if (!ledger) {
    return { tokensToday: 0, tokensPeriod: 0, requestsToday: 0, requestsPeriod: 0 };
  }
  const sameMonth = ledger.calendar_month === month;
  const sameDay = ledger.last_request_at?.slice(0, 10) === day;
  return {
    tokensToday: sameDay ? (ledger.tokens_today ?? 0) : 0,
    tokensPeriod: sameMonth ? (ledger.tokens_period ?? 0) : 0,
    requestsToday: sameDay ? (ledger.requests_today ?? 0) : 0,
    requestsPeriod: sameMonth ? (ledger.requests_period ?? 0) : 0,
  };
}

export function recordAgentUsageEntry(
  ledger: Record<string, AgentUsageLedger>,
  agentId: string,
  input: { tokens?: number; now: string },
): Record<string, AgentUsageLedger> {
  const month = calendarMonth(input.now);
  const day = calendarDay(input.now);
  const previous = ledger[agentId] ?? {};
  const sameMonth = previous.calendar_month === month;
  const sameDay = previous.last_request_at?.slice(0, 10) === day;

  const tokens = Math.max(0, Math.floor(input.tokens ?? 0));
  const next: AgentUsageLedger = {
    calendar_month: month,
    tokens_today: (sameDay ? (previous.tokens_today ?? 0) : 0) + tokens,
    tokens_period: (sameMonth ? (previous.tokens_period ?? 0) : 0) + tokens,
    requests_today: (sameDay ? (previous.requests_today ?? 0) : 0) + 1,
    requests_period: (sameMonth ? (previous.requests_period ?? 0) : 0) + 1,
    last_request_at: input.now,
  };

  return { ...ledger, [agentId]: next };
}
