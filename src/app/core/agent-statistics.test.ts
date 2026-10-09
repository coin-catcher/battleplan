import { describe, expect, it } from 'vitest';
import {
  buildAgentStatisticsSnapshot,
  buildLocalLlmStatistics,
  formatTokensRemaining,
  formatUsd,
} from './agent-statistics';

describe('LocalLLM statistics', () => {
  it('shows unlimited tokens and zero cost', () => {
    const snapshot = buildLocalLlmStatistics({
      calendar_month: '2099-01',
      tokens_today: 1200,
      tokens_period: 5000,
      requests_today: 3,
      requests_period: 10,
    });
    expect(snapshot.tokensRemaining).toBe('infinity');
    expect(snapshot.costTodayUsd).toBe(0);
    expect(snapshot.costPeriodUsd).toBe(0);
    expect(formatTokensRemaining(snapshot.tokensRemaining)).toBe('∞');
    expect(formatUsd(snapshot.costTodayUsd)).toBe('$0.00');
  });

  it('routes LocalLLM through vllm adapter', () => {
    const snapshot = buildAgentStatisticsSnapshot('LocalLLM');
    expect(snapshot.tokensRemaining).toBe('infinity');
    expect(snapshot.sourceBadge).toBe('recorded_locally');
  });
});
