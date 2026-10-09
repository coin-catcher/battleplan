import type { AgentKind, AgentOptionValue, AgentType, ProjectAgent } from './models';
import {
  AGENT_COMMON_OPTIONS,
  agentTypesForKind,
  defaultOptionValues,
  getAgentTypeDefinition,
} from './agent-types';

export interface AgentEditorForm {
  type: AgentType;
  name: string;
  url: string;
  api_key: string;
  admin_api_key: string;
  options: Record<string, AgentOptionValue>;
  nameTouched: boolean;
  urlTouched: boolean;
  apiKeyTouched: boolean;
  adminApiKeyTouched: boolean;
}

export function isAgentDraftId(agentId: string): boolean {
  return agentId.startsWith('draft-');
}

export function createAgentDraft(role: AgentKind, draftId: string): ProjectAgent {
  const type = agentTypesForKind(role)[0] ?? 'OpenAI';
  const def = getAgentTypeDefinition(type);
  const now = new Date().toISOString();
  return {
    agent_id: draftId,
    kind: role,
    type,
    name: def.defaultName,
    url: def.defaultUrl,
    options: defaultOptionValues(type),
    created_at: now,
    updated_at: now,
  };
}

/** Rebuild option rows for a new type; preserve shared toggles/prompt only. */
export function optionsAfterTypeChange(
  nextType: AgentType,
  currentOptions: Record<string, AgentOptionValue>,
): Record<string, AgentOptionValue> {
  const nextDefaults = defaultOptionValues(nextType);
  const preserved: Record<string, AgentOptionValue> = {};
  for (const row of AGENT_COMMON_OPTIONS) {
    if (currentOptions[row.key] !== undefined) preserved[row.key] = currentOptions[row.key];
  }
  return { ...nextDefaults, ...preserved };
}

export function agentFormFromSaved(agent: ProjectAgent): AgentEditorForm {
  return {
    type: agent.type,
    name: agent.name,
    url: agent.url,
    api_key: agent.api_key ?? '',
    admin_api_key: agent.admin_api_key ?? '',
    options: { ...defaultOptionValues(agent.type), ...(agent.options ?? {}) },
    nameTouched: false,
    urlTouched: false,
    apiKeyTouched: false,
    adminApiKeyTouched: false,
  };
}

export function applyAgentTypeChange(form: AgentEditorForm, nextType: AgentType): void {
  const def = getAgentTypeDefinition(nextType);
  form.type = nextType;
  if (!form.nameTouched) form.name = def.defaultName;
  if (!form.urlTouched) form.url = def.defaultUrl;
  form.options = optionsAfterTypeChange(nextType, form.options);
}

export function projectAgentFromForm(form: AgentEditorForm, existing: ProjectAgent): ProjectAgent {
  const now = new Date().toISOString();
  const agent: ProjectAgent = {
    ...existing,
    type: form.type,
    name: form.name.trim() || getAgentTypeDefinition(form.type).defaultName,
    url: form.url.trim() || getAgentTypeDefinition(form.type).defaultUrl,
    options: { ...form.options },
    updated_at: now,
  };
  if (form.apiKeyTouched) {
    const trimmed = form.api_key.trim();
    if (trimmed) agent.api_key = trimmed;
    else delete agent.api_key;
  }
  if (form.adminApiKeyTouched) {
    const trimmed = form.admin_api_key.trim();
    if (trimmed) agent.admin_api_key = trimmed;
    else delete agent.admin_api_key;
  }
  return agent;
}
