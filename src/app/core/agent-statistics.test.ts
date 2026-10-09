import { describe, expect, it } from 'vitest';
import { openAiStatisticsSnapshot } from './agent-statistics';

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
    expect(snapshot.tokensRemaining).toBeNull();
  });
});
