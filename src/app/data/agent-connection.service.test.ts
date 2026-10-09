import { describe, expect, it } from 'vitest';
import { AgentConnectionService } from './agent-connection.service';

describe('AgentConnectionService browser guard', () => {
  it('blocks LocalLLM test in non-Electron environments', async () => {
    const service = new AgentConnectionService();
    expect(service.requiresDesktopApp('LocalLLM')).toBe(true);
    expect(service.browserLimitationMessage('LocalLLM')).toMatch(/desktop app/i);

    const result = await service.testConnection({
      type: 'LocalLLM',
      url: 'http://127.0.0.1:8000/v1',
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/desktop app/i);
  });
});
