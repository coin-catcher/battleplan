import { describe, expect, it } from 'vitest';
import {
  LOCAL_LLM_BROWSER_LIMITATION,
  localLlmHealthUrl,
  localLlmModelsUrl,
  localLlmServerOrigin,
  normalizeLocalLlmApiBase,
} from './local-llm';

describe('local-llm URL helpers', () => {
  it('normalizes API base and derives origin paths', () => {
    expect(normalizeLocalLlmApiBase('http://127.0.0.1:8000')).toBe('http://127.0.0.1:8000/v1');
    expect(localLlmServerOrigin('http://127.0.0.1:8000/v1')).toBe('http://127.0.0.1:8000');
    expect(localLlmHealthUrl('http://127.0.0.1:8000/v1')).toBe('http://127.0.0.1:8000/health');
    expect(localLlmModelsUrl('http://127.0.0.1:8000/v1')).toBe('http://127.0.0.1:8000/v1/models');
  });

  it('documents browser limitation copy', () => {
    expect(LOCAL_LLM_BROWSER_LIMITATION).toMatch(/desktop app/i);
    expect(LOCAL_LLM_BROWSER_LIMITATION).toMatch(/127\.0\.0\.1/);
  });
});
