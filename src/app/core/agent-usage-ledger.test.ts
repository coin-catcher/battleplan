import { describe, expect, it } from 'vitest';
import { effectiveLedgerMetrics, recordAgentUsageEntry } from './agent-usage-ledger';

describe('effectiveLedgerMetrics', () => {
  it('zeroes daily totals when last request was on a prior day', () => {
    const metrics = effectiveLedgerMetrics(
      {
        calendar_month: '2026-10',
        tokens_today: 500,
        tokens_period: 900,
        requests_today: 3,
        requests_period: 10,
        last_request_at: '2026-10-08T10:00:00.000Z',
      },
      '2026-10-09T10:00:00.000Z',
    );
    expect(metrics.tokensToday).toBe(0);
    expect(metrics.tokensPeriod).toBe(900);
    expect(metrics.requestsToday).toBe(0);
  });
});

describe('recordAgentUsageEntry', () => {
  it('increments request counters and rolls daily totals', () => {
    const first = recordAgentUsageEntry({}, 'a1', { tokens: 100, now: '2026-10-09T10:00:00.000Z' });
    expect(first.a1?.requests_today).toBe(1);
    expect(first.a1?.tokens_period).toBe(100);

    const second = recordAgentUsageEntry(first, 'a1', { tokens: 50, now: '2026-10-10T10:00:00.000Z' });
    expect(second.a1?.requests_today).toBe(1);
    expect(second.a1?.tokens_today).toBe(50);
    expect(second.a1?.requests_period).toBe(2);
  });
});
