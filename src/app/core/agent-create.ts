import {
  agentTypesForCreateRole,
  agentTypesForKind,
  defaultOptionValues,
  getAgentTypeDefinition,
} from './agent-types';
import type { AgentKind, AgentType, ProjectAgent } from './models';

export type AgentCreateRole = 'research' | 'code';

export { agentTypesForCreateRole };

export function isAgentTypeAllowedForKind(kind: AgentKind, type: AgentType): boolean {
  return agentTypesForKind(kind).includes(type);
}

export function assertAgentTypeMatchesKind(kind: AgentKind, type: AgentType): void {
  if (!isAgentTypeAllowedForKind(kind, type)) {
    throw new Error(`Agent type "${type}" is not allowed for ${kind} agents.`);
  }
}

export function defaultAgentTypeForRole(role: AgentCreateRole): AgentType {
  const types = agentTypesForCreateRole(role);
  return types[0]!;
}

export function createAgentDraft(input: {
  agentId: string;
  role: AgentCreateRole;
  type?: AgentType;
  now?: string;
}): ProjectAgent {
  const type = input.type ?? defaultAgentTypeForRole(input.role);
  const kind: AgentKind = input.role;
  assertAgentTypeMatchesKind(kind, type);
  const definition = getAgentTypeDefinition(type);
  const now = input.now ?? new Date().toISOString();
  return {
    agent_id: input.agentId,
    kind,
    type,
    name: definition.defaultName,
    url: definition.defaultUrl,
    options: defaultOptionValues(type),
    icon_asset: definition.logoAsset,
    created_at: now,
    updated_at: now,
  };
}
