import { describe, expect, it } from 'vitest';
import { recordAgentUsageEntry } from './agent-usage-ledger';

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
