import { agentCredentialFieldLabel, agentUsesServiceAccountJson } from './gemini-service-account';
import type { AgentType, ProjectAgent } from './models';

export { agentCredentialFieldLabel, agentUsesServiceAccountJson };

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

export function agentCredentialRequiredMessage(type: AgentType): string {
  if (agentUsesServiceAccountJson(type)) {
    return 'Paste and save a Google Cloud service account JSON key before testing or chatting.';
  }
  if (type === 'Cursor Agent') {
    return 'Save a Cursor API key in the Cursor API key panel or on this agent.';
  }
  return 'Enter an API key before testing the connection.';
}
