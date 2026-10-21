import { describe, expect, it } from 'vitest';
import { libraryAgentsForKind } from './agent-bindings';
import type { ProjectAgent } from './models';

const agent = (patch: Partial<ProjectAgent> & Pick<ProjectAgent, 'agent_id' | 'kind' | 'type'>): ProjectAgent => ({
  name: patch.name ?? 'Agent',
  url: patch.url ?? 'https://example.com',
  created_at: '2026-10-21T00:00:00.000Z',
  updated_at: '2026-10-21T00:00:00.000Z',
  ...patch,
});

describe('libraryAgentsForKind', () => {
  const agents: ProjectAgent[] = [
    agent({ agent_id: 'openai', kind: 'research', type: 'OpenAI' }),
    agent({ agent_id: 'cursor-code', kind: 'code', type: 'Cursor Agent' }),
    agent({ agent_id: 'cursor-research', kind: 'research', type: 'Cursor Agent' }),
  ];

  it('lists Cursor Agent configs in both research and code task pickers', () => {
    const researchIds = libraryAgentsForKind(agents, 'research').map((item) => item.agent_id);
    const codeIds = libraryAgentsForKind(agents, 'code').map((item) => item.agent_id);
    expect(researchIds).toEqual(['openai', 'cursor-code', 'cursor-research']);
    expect(codeIds).toEqual(['cursor-code', 'cursor-research']);
    expect(researchIds).toContain('cursor-code');
  });

  it('keeps non-Cursor agents scoped to their library kind', () => {
    expect(libraryAgentsForKind(agents, 'code').some((item) => item.type === 'OpenAI')).toBe(false);
  });
});
