import type { AgentOptionValue, Project, ProjectAgent, ProjectTask } from './models';

export function resolveResearchAgentId(task: ProjectTask, project: Project): string | undefined {
  return task.research_agent_id?.trim() || project.default_research_agent_id?.trim() || undefined;
}

export function resolveCodeAgentId(task: ProjectTask, project: Project): string | undefined {
  return task.code_agent_id?.trim() || project.default_code_agent_id?.trim() || undefined;
}

export function findProjectAgent(agents: ProjectAgent[], agentId: string | undefined): ProjectAgent | null {
  if (!agentId) return null;
  return agents.find((agent) => agent.agent_id === agentId) ?? null;
}

export function usesResearchChatAdapter(agent: ProjectAgent | null): boolean {
  return Boolean(agent && agent.type !== 'Cursor Agent');
}

export function cursorApiKeyForAgent(agent: ProjectAgent | null, globalCursorApiKey: string): string {
  const fromAgent = agent?.api_key?.trim();
  if (fromAgent) return fromAgent;
  return globalCursorApiKey.trim();
}

export function optionString(options: Record<string, AgentOptionValue> | undefined, key: string): string {
  const value = options?.[key];
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

export function parseEnvVarsJson(options: Record<string, AgentOptionValue> | undefined): Record<string, string> {
  const raw = optionString(options, 'env_vars_json');
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value;
      else if (typeof value === 'number' || typeof value === 'boolean') out[key] = String(value);
    }
    return out;
  } catch {
    return {};
  }
}

export interface CursorLaunchFromLibrary {
  repoUrl?: string;
  startingRef?: string;
  envVars?: Record<string, string>;
  mode: 'agent' | 'plan';
  apiKey: string;
}

export function cursorLaunchFromLibrary(
  agent: ProjectAgent | null,
  project: Project,
  globalCursorApiKey: string,
): CursorLaunchFromLibrary {
  const repoFromAgent = optionString(agent?.options, 'default_repo_url');
  const refFromAgent = optionString(agent?.options, 'default_starting_ref');
  const modeRaw = optionString(agent?.options, 'default_mode');
  const mode = modeRaw === 'plan' ? 'plan' : 'agent';
  return {
    repoUrl: repoFromAgent || project.repo_url?.trim() || undefined,
    startingRef: refFromAgent || project.starting_ref?.trim() || undefined,
    envVars: parseEnvVarsJson(agent?.options),
    mode,
    apiKey: cursorApiKeyForAgent(agent, globalCursorApiKey),
  };
}

export function taskResearchChatStarted(
  task: ProjectTask,
  project: Project,
  agents: ProjectAgent[],
): boolean {
  if (task.cursor_agent_id) return true;
  const agent = findProjectAgent(agents, resolveResearchAgentId(task, project));
  if (!usesResearchChatAdapter(agent)) return false;
  return task.status !== 'TODO';
}
