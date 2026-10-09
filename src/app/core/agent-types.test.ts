import { describe, expect, it } from 'vitest';
import {
  AGENT_COMMON_OPTIONS,
  agentLogoPublicPath,
  agentOptionRows,
  agentTypesForKind,
  defaultOptionValues,
  getAgentTypeDefinition,
  isAgentOptionVisible,
} from './agent-types';

describe('agent-types registry', () => {
  it('lists research and code types by kind', () => {
    expect(agentTypesForKind('research')).toContain('OpenAI');
    expect(agentTypesForKind('code')).toEqual(['Cursor Agent']);
  });

  it('prepends common options before type-specific rows', () => {
    const keys = agentOptionRows('OpenAI').map((row) => row.key);
    expect(keys.slice(0, 3)).toEqual(AGENT_COMMON_OPTIONS.map((row) => row.key));
    expect(keys).toContain('model');
  });

  it('hides reasoning options when use_reasoning is false', () => {
    const effort = agentOptionRows('OpenAI').find((row) => row.key === 'reasoning_effort');
    expect(effort).toBeDefined();
    expect(isAgentOptionVisible(effort!, { use_reasoning: false })).toBe(false);
    expect(isAgentOptionVisible(effort!, { use_reasoning: true })).toBe(true);
  });

  it('maps logo assets under public/assets/agents', () => {
    expect(agentLogoPublicPath('Anthropic')).toBe('/assets/agents/anthropic.svg');
    expect(defaultOptionValues('Cursor Agent').default_mode).toBe('agent');
  });
});

describe('Grok (xAI) provider configuration', () => {
  it('uses xAI defaults, logo, and local ledger statistics', () => {
    const def = getAgentTypeDefinition('Grok');
    expect(def.kind).toBe('research');
    expect(def.defaultName).toBe('Grok Research');
    expect(def.defaultUrl).toBe('https://api.x.ai/v1');
    expect(def.logoAsset).toBe('xai.svg');
    expect(agentLogoPublicPath('Grok')).toBe('/assets/agents/xai.svg');
    expect(def.statistics.adapter).toBe('local_ledger');
    expect(def.statistics.priceHintUsdPerMtok).toEqual({ input: 2.0, output: 6.0, model: 'grok-4.7' });
    expect(def.testConnection.path).toBe('/models');
    expect(def.testConnection.fallbackPath).toBe('/responses');
    expect(def.testConnection.fallbackMethod).toBe('POST');
  });

  it('includes model, cache key, and common options before Grok-specific rows', () => {
    const keys = agentOptionRows('Grok').map((row) => row.key);
    expect(keys.slice(0, 3)).toEqual(AGENT_COMMON_OPTIONS.map((row) => row.key));
    expect(keys).toContain('model');
    expect(keys).toContain('prompt_cache_key');
    expect(defaultOptionValues('Grok').model).toBe('grok-4.7');
  });

  it('hides reasoning effort when use_reasoning is false', () => {
    const effort = agentOptionRows('Grok').find((row) => row.key === 'reasoning_effort');
    expect(effort?.choices).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(isAgentOptionVisible(effort!, { use_reasoning: false })).toBe(false);
    expect(isAgentOptionVisible(effort!, { use_reasoning: true })).toBe(true);
  });

  it('shows built-in tools and custom functions only when use_tool_calls is enabled', () => {
    const gatedKeys = ['builtin_web_search', 'builtin_x_search', 'builtin_code_interpreter', 'custom_functions_json'];
    for (const key of gatedKeys) {
      const row = agentOptionRows('Grok').find((r) => r.key === key);
      expect(row, key).toBeDefined();
      expect(isAgentOptionVisible(row!, { use_tool_calls: false })).toBe(false);
      expect(isAgentOptionVisible(row!, { use_tool_calls: true })).toBe(true);
    }
  });

  it('always shows prompt cache key regardless of reasoning or tool toggles', () => {
    const row = agentOptionRows('Grok').find((r) => r.key === 'prompt_cache_key')!;
    expect(isAgentOptionVisible(row, { use_reasoning: false, use_tool_calls: false })).toBe(true);
  });
});
