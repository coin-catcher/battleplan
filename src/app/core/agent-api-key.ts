import type { AgentType, ProjectAgent } from './models';

/** Cursor Agent configs may omit api_key and use the global Cursor key from AppPreferences. */
export function resolveAgentApiKey(
  agent: Pick<ProjectAgent, 'type' | 'api_key'>,
  globalCursorApiKey: string,
): string {
  const perAgent = agent.api_key?.trim() ?? '';
  if (perAgent) return perAgent;
  if (agent.type === 'Cursor Agent') return globalCursorApiKey.trim();
  return '';
}

export function agentApiKeyRequired(type: AgentType): boolean {
  return type !== 'Cursor Agent';
}
