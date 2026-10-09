import { describe, expect, it } from 'vitest';
import { agentFormFromSaved, applyAgentTypeChange, optionsAfterTypeChange } from './agent-form';
import { agentOptionRows, isAgentOptionVisible } from './agent-types';

describe('agent-form type switching', () => {
  it('drops type-specific keys when switching OpenAI to Grok and back', () => {
    const openAiOptions = optionsAfterTypeChange('OpenAI', {
      system_prompt: 'Stay helpful',
      use_reasoning: true,
      use_tool_calls: false,
      model: 'gpt-4o',
      store: true,
    });
    expect(openAiOptions.model).toBe('gpt-4.1-mini');
    expect(openAiOptions.store).toBe(false);

    const grokOptions = optionsAfterTypeChange('Grok', openAiOptions);
    expect(grokOptions.model).toBe('grok-4.7');
    expect(grokOptions).not.toHaveProperty('store');
    expect(grokOptions.system_prompt).toBe('Stay helpful');
    expect(grokOptions.use_reasoning).toBe(true);

    const backToOpenAi = optionsAfterTypeChange('OpenAI', grokOptions);
    expect(backToOpenAi.model).toBe('gpt-4.1-mini');
    expect(backToOpenAi).not.toHaveProperty('prompt_cache_key');
    expect(backToOpenAi.store).toBe(false);
  });

  it('applyAgentTypeChange updates defaults when fields are untouched', () => {
    const form = agentFormFromSaved({
      agent_id: 'a1',
      kind: 'research',
      type: 'OpenAI',
      name: 'OpenAI Research',
      url: 'https://api.openai.com/v1',
      created_at: '2026-10-09T00:00:00.000Z',
      updated_at: '2026-10-09T00:00:00.000Z',
    });
    applyAgentTypeChange(form, 'Anthropic');
    expect(form.name).toBe('Anthropic Research');
    expect(form.url).toBe('https://api.anthropic.com');
    expect(form.options.model).toBe('claude-sonnet-4-20250514');
  });

  it('hides OpenAI reasoning_effort when use_reasoning is off', () => {
    const effort = agentOptionRows('OpenAI').find((row) => row.key === 'reasoning_effort');
    expect(effort).toBeDefined();
    expect(isAgentOptionVisible(effort!, { use_reasoning: false, use_tool_calls: false })).toBe(false);
  });
});
