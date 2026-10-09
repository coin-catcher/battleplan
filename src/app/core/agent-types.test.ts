import { describe, expect, it } from 'vitest';
import {
  AGENT_COMMON_OPTIONS,
  agentLogoPublicPath,
  agentOptionRows,
  agentTypesForKind,
  defaultOptionValues,
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

  it('defines LocalLLM defaults and dynamic model option', () => {
    expect(agentLogoPublicPath('LocalLLM')).toBe('/assets/agents/vllm.svg');
    const model = agentOptionRows('LocalLLM').find((row) => row.key === 'model');
    expect(model?.dynamic).toBe(true);
    expect(defaultOptionValues('LocalLLM').temperature).toBe(0.7);
    const toolToggle = agentOptionRows('LocalLLM').find((row) => row.key === 'enable_auto_tool_choice');
    expect(isAgentOptionVisible(toolToggle!, { use_tool_calls: false })).toBe(false);
    expect(isAgentOptionVisible(toolToggle!, { use_tool_calls: true })).toBe(true);
  });
});
