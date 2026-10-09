import { describe, expect, it } from 'vitest';
import {
  AGENT_COMMON_OPTIONS,
  agentLogoPublicPath,
  agentOptionRows,
  agentTypesForKind,
  applyAgentTypeChange,
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

  describe('Anthropic research type', () => {
    it('uses Messages API defaults and test recipe', () => {
      const def = getAgentTypeDefinition('Anthropic');
      expect(def.defaultName).toBe('Anthropic Research');
      expect(def.defaultUrl).toBe('https://api.anthropic.com');
      expect(def.logoAsset).toBe('anthropic.svg');
      expect(def.testConnection).toMatchObject({
        method: 'POST',
        path: '/v1/messages',
        auth: 'x-api-key',
        body: { max_tokens: 1 },
      });
      expect(def.statistics.adapter).toBe('anthropic_admin');
      expect(def.statistics.adminKeyHint).toContain('Admin API key');
    });

    it('gates thinking options on use_reasoning', () => {
      const rows = agentOptionRows('Anthropic');
      const budget = rows.find((row) => row.key === 'thinking_budget_tokens');
      const mode = rows.find((row) => row.key === 'thinking_type');
      expect(budget).toBeDefined();
      expect(mode).toBeDefined();
      expect(isAgentOptionVisible(budget!, { use_reasoning: false })).toBe(false);
      expect(isAgentOptionVisible(budget!, { use_reasoning: true })).toBe(true);
      expect(isAgentOptionVisible(mode!, { use_reasoning: false })).toBe(false);
      expect(isAgentOptionVisible(mode!, { use_reasoning: true })).toBe(true);
    });

    it('gates server tool toggles on use_tool_calls', () => {
      const rows = agentOptionRows('Anthropic');
      for (const key of ['tool_choice', 'disable_parallel_tool_use', 'server_tools_web_search', 'server_tools_code_execution']) {
        const row = rows.find((r) => r.key === key);
        expect(row).toBeDefined();
        expect(isAgentOptionVisible(row!, { use_tool_calls: false })).toBe(false);
        expect(isAgentOptionVisible(row!, { use_tool_calls: true })).toBe(true);
      }
    });

    it('includes core Anthropic option defaults', () => {
      const values = defaultOptionValues('Anthropic');
      expect(values.model).toBe('claude-sonnet-4-20250514');
      expect(values.max_tokens).toBe(8192);
      expect(values.thinking_budget_tokens).toBe(10000);
      expect(values.thinking_type).toBe('enabled');
      expect(values.tool_choice).toBe('auto');
    });
  });

  it('switching OpenAI to Anthropic updates URL, icon, and option rows', () => {
    const openAiOptions = defaultOptionValues('OpenAI');
    openAiOptions.use_reasoning = true;
    openAiOptions.use_tool_calls = false;
    openAiOptions.reasoning_effort = 'high';
    openAiOptions.store = true;

    const changed = applyAgentTypeChange({
      previousType: 'OpenAI',
      nextType: 'Anthropic',
      name: 'OpenAI Research',
      url: 'https://api.openai.com/v1',
      options: openAiOptions,
    });

    expect(changed.logoPath).toBe('/assets/agents/anthropic.svg');
    expect(changed.name).toBe('Anthropic Research');
    expect(changed.url).toBe('https://api.anthropic.com');
    expect(changed.options.use_reasoning).toBe(true);
    expect(changed.options.use_tool_calls).toBe(false);
    expect(changed.options.model).toBe('claude-sonnet-4-20250514');
    expect(changed.options).not.toHaveProperty('reasoning_effort');
    expect(changed.options).not.toHaveProperty('store');
    expect(changed.options).toHaveProperty('thinking_budget_tokens');
  });
});
