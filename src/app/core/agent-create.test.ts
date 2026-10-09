import { describe, expect, it } from 'vitest';
import {
  assertAgentTypeMatchesKind,
  createAgentDraft,
  defaultAgentTypeForRole,
} from './agent-create';
import { agentTypesForCreateRole } from './agent-types';

describe('agent create role filtering', () => {
  it('offers only Cursor Agent for code role', () => {
    expect(agentTypesForCreateRole('code')).toEqual(['Cursor Agent']);
    expect(defaultAgentTypeForRole('code')).toBe('Cursor Agent');
  });

  it('excludes Cursor Agent from research role', () => {
    const researchTypes = agentTypesForCreateRole('research');
    expect(researchTypes).not.toContain('Cursor Agent');
    expect(researchTypes).toContain('OpenAI');
  });

  it('rejects mismatched kind and type on draft create', () => {
    expect(() => createAgentDraft({ agentId: 'x', role: 'research', type: 'Cursor Agent' }))
      .toThrow(/not allowed/);
    expect(() => createAgentDraft({ agentId: 'x', role: 'code', type: 'OpenAI' }))
      .toThrow(/not allowed/);
  });

  it('builds Cursor code draft with registry defaults', () => {
    const draft = createAgentDraft({ agentId: 'new', role: 'code' });
    expect(draft.type).toBe('Cursor Agent');
    expect(draft.url).toBe('https://api.cursor.com/v1');
    expect(draft.options?.['default_mode']).toBe('agent');
    expect(draft.options?.['auto_create_pr']).toBe(false);
  });

  it('assertAgentTypeMatchesKind guards save paths', () => {
    expect(() => assertAgentTypeMatchesKind('research', 'Grok')).not.toThrow();
    expect(() => assertAgentTypeMatchesKind('code', 'Anthropic')).toThrow();
  });
});
