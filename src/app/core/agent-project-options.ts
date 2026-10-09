import { agentOptionRows } from './agent-types';
import type { AgentOptionValue, Project, ProjectAgent } from './models';

function projectField(project: Project, path: string): string | undefined {
  if (path === 'project.repo_url') return project.repo_url?.trim() || undefined;
  if (path === 'project.starting_ref') return project.starting_ref?.trim() || undefined;
  return undefined;
}

/** Apply inherit_from defaults for empty option values (Cursor repo/ref, etc.). */
export function applyProjectInheritedAgentOptions(
  agent: ProjectAgent,
  project: Project | undefined,
): Record<string, AgentOptionValue> {
  const merged = { ...(agent.options ?? {}) };
  if (!project) return merged;

  for (const row of agentOptionRows(agent.type)) {
    if (!row.inheritFrom) continue;
    const current = merged[row.key];
    const empty = current === undefined || current === '' || current === null;
    if (!empty) continue;
    const inherited = projectField(project, row.inheritFrom);
    if (inherited !== undefined) merged[row.key] = inherited;
  }
  return merged;
}

export function parseCursorEnvVarsJson(options: Record<string, AgentOptionValue> | undefined): Record<string, string> {
  const raw = options?.['env_vars_json'];
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('env_vars_json must be a JSON object.');
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') result[key] = value;
      else if (typeof value === 'number' || typeof value === 'boolean') result[key] = String(value);
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON.';
    throw new Error(`Environment variables: ${message}`);
  }
}
