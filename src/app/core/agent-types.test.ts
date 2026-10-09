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
    const updated = applyAgentTypeChange(
      {
        type: 'OpenAI',
        name: 'OpenAI Research',
        url: 'https://api.openai.com/v1',
        options: { use_reasoning: true, use_tool_calls: true, model: 'gpt-4.1-mini' },
      },
      'Gemini',
      { nameTouched: false, urlTouched: false },
    );
    expect(updated.name).toBe('Gemini Research');
    expect(updated.url).toBe('https://generativelanguage.googleapis.com/v1beta');
    expect(updated.options.model).toBe('gemini-2.5-flash');
    expect(updated.options.use_reasoning).toBe(true);
    expect(updated.options.use_tool_calls).toBe(true);
    expect(updated.options).not.toHaveProperty('reasoning_effort');
  });

  it('keeps custom name and url when the user has edited them', () => {
    const updated = applyAgentTypeChange(
      {
        type: 'Anthropic',
        name: 'My Custom Agent',
        url: 'https://example.test/v1beta',
        options: {},
      },
      'Gemini',
      { nameTouched: true, urlTouched: true },
    );
    expect(updated.name).toBe('My Custom Agent');
    expect(updated.url).toBe('https://example.test/v1beta');
  });
});
