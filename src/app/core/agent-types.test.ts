import { describe, expect, it } from 'vitest';
import {
  AGENT_COMMON_OPTIONS,
  agentLogoPublicPath,
  agentModelOptionDefinition,
  agentOptionRows,
  agentStatisticsBadge,
  agentStatisticsQuotaHint,
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

describe('Gemini agent type', () => {
  it('exposes default url, name, logo, and model list', () => {
    const definition = getAgentTypeDefinition('Gemini');
    expect(definition.defaultUrl).toBe('https://generativelanguage.googleapis.com/v1beta');
    expect(definition.defaultName).toBe('Gemini Research');
    expect(agentLogoPublicPath('Gemini')).toBe('/assets/agents/googlegemini.svg');
    const model = agentModelOptionDefinition('Gemini');
    expect(model?.default).toBe('gemini-2.5-flash');
    expect(model?.choices).toEqual(['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash']);
  });

  it('documents estimated statistics and AI Studio quota requirements', () => {
    expect(agentStatisticsBadge('Gemini')).toBe('Estimated');
    expect(agentStatisticsQuotaHint('Gemini')).toMatch(/AI Studio/i);
  });

  it('gates thinking and tool-specific options', () => {
    const rows = agentOptionRows('Gemini');
    const thinking = rows.find((row) => row.key === 'thinking_budget');
    expect(thinking).toBeDefined();
    expect(isAgentOptionVisible(thinking!, { use_reasoning: false })).toBe(false);
    expect(isAgentOptionVisible(thinking!, { use_reasoning: true })).toBe(true);

    for (const key of ['function_calling_mode', 'google_search_grounding', 'code_execution'] as const) {
      const row = rows.find((option) => option.key === key);
      expect(row).toBeDefined();
      expect(isAgentOptionVisible(row!, { use_tool_calls: false })).toBe(false);
      expect(isAgentOptionVisible(row!, { use_tool_calls: true })).toBe(true);
    }
  });

  it('applyAgentTypeChange applies Gemini defaults and model when type is selected', () => {
    const updated = applyAgentTypeChange({
      previousType: 'OpenAI',
      nextType: 'Gemini',
      name: 'OpenAI Research',
      url: 'https://api.openai.com/v1',
      options: { use_reasoning: true, use_tool_calls: true, model: 'gpt-4.1-mini' },
    });
    expect(updated.logoPath).toBe('/assets/agents/googlegemini.svg');
    expect(updated.name).toBe('Gemini Research');
    expect(updated.url).toBe('https://generativelanguage.googleapis.com/v1beta');
    expect(updated.options.model).toBe('gemini-2.5-flash');
    expect(updated.options.use_reasoning).toBe(true);
    expect(updated.options.use_tool_calls).toBe(true);
    expect(updated.options).not.toHaveProperty('reasoning_effort');
  });

  it('keeps custom name and url when the user has edited them', () => {
    const updated = applyAgentTypeChange({
      previousType: 'Anthropic',
      nextType: 'Gemini',
      name: 'My Custom Agent',
      url: 'https://example.test/v1beta',
      options: {},
      nameTouched: true,
      urlTouched: true,
    });
    expect(updated.name).toBe('My Custom Agent');
    expect(updated.url).toBe('https://example.test/v1beta');
  });
});
