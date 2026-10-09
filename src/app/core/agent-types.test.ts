import { describe, expect, it } from 'vitest';
import {
  AGENT_COMMON_OPTIONS,
  agentLogoPublicPath,
  agentModelOptionDefinition,
  agentOptionRows,
  agentStatisticsBadge,
  agentStatisticsQuotaHint,
  agentTypesForCreateRole,
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

  it('filters create-flow types by role', () => {
    expect(agentTypesForCreateRole('code')).toEqual(['Cursor Agent']);
    expect(agentTypesForCreateRole('research')).not.toContain('Cursor Agent');
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
    expect(agentLogoPublicPath('Anthropic')).toBe('assets/agents/anthropic.svg');
    expect(defaultOptionValues('Cursor Agent').default_mode).toBe('agent');
  });

  it('defines OpenAI model option as dynamic with static fallback choices', () => {
    const model = agentOptionRows('OpenAI').find((row) => row.key === 'model');
    expect(model?.dynamic).toBe(true);
    expect(model?.choices?.length).toBeGreaterThan(1);
  });

  it('defines LocalLLM defaults and dynamic model option', () => {
    expect(agentLogoPublicPath('LocalLLM')).toBe('assets/agents/vllm.svg');
    const model = agentOptionRows('LocalLLM').find((row) => row.key === 'model');
    expect(model?.dynamic).toBe(true);
    expect(defaultOptionValues('LocalLLM').temperature).toBe(0.7);
    const toolToggle = agentOptionRows('LocalLLM').find((row) => row.key === 'enable_auto_tool_choice');
    expect(isAgentOptionVisible(toolToggle!, { use_tool_calls: false })).toBe(false);
    expect(isAgentOptionVisible(toolToggle!, { use_tool_calls: true })).toBe(true);
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

    expect(changed.logoPath).toBe('assets/agents/anthropic.svg');
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
    expect(agentLogoPublicPath('Gemini')).toBe('assets/agents/googlegemini.svg');
    const model = agentModelOptionDefinition('Gemini');
    expect(model?.default).toBe('gemini-2.5-flash');
    expect(model?.choices).toEqual(['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash']);
  });

  it('documents estimated statistics and AI Studio quota requirements', () => {
    expect(agentStatisticsBadge('Gemini')).toBe('Estimated');
    expect(agentStatisticsQuotaHint('Gemini')).toMatch(/Cloud Console/i);
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
    expect(updated.logoPath).toBe('assets/agents/googlegemini.svg');
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

describe('Grok (xAI) provider configuration', () => {
  it('uses xAI defaults, logo, and local ledger statistics', () => {
    const def = getAgentTypeDefinition('Grok');
    expect(def.kind).toBe('research');
    expect(def.defaultName).toBe('Grok Research');
    expect(def.defaultUrl).toBe('https://api.x.ai/v1');
    expect(def.logoAsset).toBe('xai.svg');
    expect(agentLogoPublicPath('Grok')).toBe('assets/agents/xai.svg');
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
