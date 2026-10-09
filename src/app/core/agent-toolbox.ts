import { getAgentTypeDefinition } from './agent-types';
import type { Project, ProjectAgent } from './models';

/** Virtual toolbox entry for legacy project.cursor_agent_id until migrated into agents[]. */
export const LEGACY_PRIMARY_CURSOR_AGENT_ID = '__legacy_primary_cursor__';

export function isLegacyPrimaryCursorAgent(agentId: string): boolean {
  return agentId === LEGACY_PRIMARY_CURSOR_AGENT_ID;
}

export function legacyPrimaryCursorAgent(project: Project): ProjectAgent | null {
  const cursorId = project.cursor_agent_id?.trim();
  if (!cursorId) return null;

  const definition = getAgentTypeDefinition('Cursor Agent');
  return {
    agent_id: LEGACY_PRIMARY_CURSOR_AGENT_ID,
    kind: 'code',
    type: 'Cursor Agent',
    name: 'Primary Cursor Agent (legacy)',
    url: definition.defaultUrl,
    cursor_agent_id: cursorId,
    icon_asset: definition.logoAsset,
    created_at: project.created_at,
    updated_at: project.updated_at,
  };
}

export function listAgentToolboxEntries(project: Project | undefined, saved: ProjectAgent[]): ProjectAgent[] {
  const entries: ProjectAgent[] = [...saved];
  const legacy = project ? legacyPrimaryCursorAgent(project) : null;
  if (legacy && !saved.some((agent) => agent.cursor_agent_id === legacy.cursor_agent_id)) {
    entries.unshift(legacy);
  }
  entries.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'research' ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });
  return entries;
}
