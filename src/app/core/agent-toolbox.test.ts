import { describe, expect, it } from 'vitest';
import {
  LEGACY_PRIMARY_CURSOR_AGENT_ID,
  isLegacyPrimaryCursorAgent,
  legacyPrimaryCursorAgent,
  listAgentToolboxEntries,
} from './agent-toolbox';
import type { Project, ProjectAgent } from './models';

const project = (patch: Partial<Project> = {}): Project => ({
  project_id: 'p1',
  title: 'Demo',
  initial_prompt: 'Plan',
  cursor_chat_link: 'https://cursor.com/agents/legacy',
  cursor_agent_id: 'legacy-cloud-id',
  created_at: '2026-10-09T00:00:00.000Z',
  updated_at: '2026-10-09T00:00:00.000Z',
  ...patch,
});

describe('legacy primary Cursor agent toolbox entry', () => {
  it('surfaces project.cursor_agent_id as read-only legacy entry', () => {
    const legacy = legacyPrimaryCursorAgent(project());
    expect(legacy?.agent_id).toBe(LEGACY_PRIMARY_CURSOR_AGENT_ID);
    expect(legacy?.cursor_agent_id).toBe('legacy-cloud-id');
    expect(isLegacyPrimaryCursorAgent(LEGACY_PRIMARY_CURSOR_AGENT_ID)).toBe(true);
  });

  it('lists legacy entry when not duplicated in saved agents', () => {
    const saved: ProjectAgent[] = [{
      agent_id: 'saved-1',
      kind: 'research',
      type: 'OpenAI',
      name: 'Research',
      url: 'https://api.openai.com/v1',
      created_at: '2026-10-09T00:00:00.000Z',
      updated_at: '2026-10-09T00:00:00.000Z',
    }];
    const entries = listAgentToolboxEntries(project(), saved);
    expect(entries.some((item) => item.agent_id === LEGACY_PRIMARY_CURSOR_AGENT_ID)).toBe(true);
  });

  it('skips legacy when saved agent already references the same cursor_agent_id', () => {
    const saved: ProjectAgent[] = [{
      agent_id: 'saved-cursor',
      kind: 'code',
      type: 'Cursor Agent',
      name: 'Migrated',
      url: 'https://api.cursor.com/v1',
      cursor_agent_id: 'legacy-cloud-id',
      created_at: '2026-10-09T00:00:00.000Z',
      updated_at: '2026-10-09T00:00:00.000Z',
    }];
    const entries = listAgentToolboxEntries(project(), saved);
    expect(entries.filter((item) => item.agent_id === LEGACY_PRIMARY_CURSOR_AGENT_ID)).toHaveLength(0);
  });
});
