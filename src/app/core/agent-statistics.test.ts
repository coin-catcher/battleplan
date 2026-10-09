import { describe, expect, it } from 'vitest';
import { agentStatisticsSnapshot, openAiStatisticsSnapshot } from './agent-statistics';

describe('OpenAI statistics adapter', () => {
  it('reports unavailable metrics without org admin key', () => {
    const snapshot = openAiStatisticsSnapshot({
      agent_id: 'a1',
      kind: 'research',
      type: 'OpenAI',
      name: 'OpenAI Research',
      url: 'https://api.openai.com/v1',
      api_key: 'sk-test',
      created_at: '2026-10-09T00:00:00.000Z',
      updated_at: '2026-10-09T00:00:00.000Z',
    });
    expect(snapshot.badge).toBe('Unavailable');
    expect(snapshot.note).toMatch(/Organization Admin API key/i);
    expect(snapshot.tokensRemaining.display).toMatch(/Unavailable—requires org Admin key/i);
    expect(snapshot.tokensRemaining.amount).toBeNull();
  });
});

describe('LocalLLM statistics', () => {
  it('shows unlimited tokens and zero cost', () => {
    const snapshot = agentStatisticsSnapshot({
      agent_id: 'local-1',
      kind: 'research',
      type: 'LocalLLM',
      name: 'Local vLLM',
      url: 'http://127.0.0.1:8000/v1',
      created_at: '2026-10-09T00:00:00.000Z',
      updated_at: '2026-10-09T00:00:00.000Z',
    });
    expect(snapshot.tokensRemaining.display).toBe('∞');
    expect(snapshot.costTodayUsd.amount).toBe(0);
    expect(snapshot.costPeriodUsd.amount).toBe(0);
    expect(snapshot.badge).toBe('Recorded locally');
  });

  it('merges ledger counters for the active day and month', () => {
    const snapshot = agentStatisticsSnapshot(
      {
        agent_id: 'local-1',
        kind: 'research',
        type: 'LocalLLM',
        name: 'Local vLLM',
        url: 'http://127.0.0.1:8000/v1',
        created_at: '2026-10-09T00:00:00.000Z',
        updated_at: '2026-10-09T00:00:00.000Z',
      },
      {
        calendar_month: '2026-10',
        tokens_today: 42,
        tokens_period: 900,
        requests_today: 2,
        requests_period: 11,
        last_request_at: '2026-10-09T12:00:00.000Z',
      },
      null,
      '2026-10-09T15:00:00.000Z',
    );
    expect(snapshot.tokensToday.amount).toBe(42);
    expect(snapshot.tokensPeriod.amount).toBe(900);
    expect(snapshot.requestsToday.amount).toBe(2);
  });
});
