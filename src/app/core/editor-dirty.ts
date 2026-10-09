import { defaultOptionValues, getAgentTypeDefinition, mergeAgentOptions } from './agent-types';
import type { AgentKind, AgentOptionValue, AgentType, OutputType, Project, ProjectAgent, ProjectTask } from './models';
import { taskDar, taskInitialPrompt } from './task-fields';

export interface ProjectEditorForm {
  title: string;
  repo_url: string;
  starting_ref: string;
  github_pat: string;
  dar: string;
  initial_prompt?: string;
}

export interface TaskEditorForm {
  title: string;
  dar: string;
  initial_prompt: string;
  output_type: OutputType;
  dependencies: string[];
  sibling_dependencies: string[];
}

export interface AgentEditorForm {
  type: AgentType;
  name: string;
  url: string;
  api_key: string;
  admin_api_key: string;
  options: Record<string, AgentOptionValue>;
  apiKeyEdited: boolean;
  adminApiKeyEdited: boolean;
}

export function projectEditorDirty(form: ProjectEditorForm, project: Project | null): boolean {
  if (!project) return false;
  const branch = form.starting_ref.trim() || 'main';
  const savedBranch = project.starting_ref?.trim() || 'main';
  const savedDar = (project.dar ?? '').trim();
  const initialDirty = form.initial_prompt !== undefined
    && form.initial_prompt.trim() !== (project.initial_prompt ?? '').trim();
  return form.title.trim() !== project.title
    || form.repo_url.trim() !== (project.repo_url ?? '').trim()
    || branch !== savedBranch
    || form.github_pat.trim() !== (project.github_pat ?? '').trim()
    || form.dar.trim() !== savedDar
    || initialDirty;
}

export function taskEditorDirty(form: TaskEditorForm, task: ProjectTask | null): boolean {
  if (!task) return false;
  const deps = [...form.dependencies].sort();
  const saved = [...task.dependencies].sort();
  const siblings = [...form.sibling_dependencies].sort();
  const savedSiblings = [...(task.sibling_dependencies ?? [])].sort();
  const initialDirty = !task.cursor_agent_id
    && form.initial_prompt.trim() !== taskInitialPrompt(task);
  return form.title !== task.title
    || form.dar.trim() !== taskDar(task)
    || form.output_type !== task.output_type
    || initialDirty
    || deps.length !== saved.length
    || deps.some((id, index) => id !== saved[index])
    || siblings.length !== savedSiblings.length
    || siblings.some((id, index) => id !== savedSiblings[index]);
}

function optionsDirty(form: Record<string, AgentOptionValue>, saved: Record<string, AgentOptionValue> | undefined): boolean {
  const merged = { ...form };
  const baseline = saved ?? {};
  const keys = new Set([...Object.keys(merged), ...Object.keys(baseline)]);
  for (const key of keys) {
    if (merged[key] !== baseline[key]) return true;
  }
  return false;
}

export function agentCreateEditorDirty(form: AgentEditorForm, role: 'research' | 'code'): boolean {
  const defaultType: AgentType = role === 'code' ? 'Cursor Agent' : 'OpenAI';
  const def = getAgentTypeDefinition(defaultType);
  const defaults = defaultOptionValues(defaultType);
  if (form.type !== defaultType) return true;
  if (form.name.trim() !== def.defaultName) return true;
  if (form.url.trim() !== def.defaultUrl) return true;
  if (form.api_key.trim()) return true;
  if ((form.admin_api_key ?? '').trim()) return true;
  return optionsDirty(form.options, defaults);
}

export function agentEditorDirty(form: AgentEditorForm, agent: ProjectAgent | null): boolean {
  if (!agent) return false;
  const savedOptions = mergeAgentOptions(agent.type, agent.options);
  const apiDirty = form.apiKeyEdited
    ? form.api_key.trim() !== (agent.api_key ?? '').trim()
    : false;
  const adminDirty = form.adminApiKeyEdited
    ? (form.admin_api_key ?? '').trim() !== (agent.admin_api_key ?? '').trim()
    : false;
  return form.type !== agent.type
    || form.name.trim() !== agent.name.trim()
    || form.url.trim() !== agent.url.trim()
    || apiDirty
    || adminDirty
    || optionsDirty(form.options, savedOptions);
}

export function editorPanelDirty(
  kind: 'project' | 'subproject' | 'task' | string,
  projectForm: ProjectEditorForm,
  taskForm: TaskEditorForm,
  project: Project | null,
  task: ProjectTask | null,
  agentForm?: AgentEditorForm,
  agent?: ProjectAgent | null,
  agentCreateRole?: AgentKind,
): boolean {
  if (kind === 'project' || kind === 'subproject') {
    return projectEditorDirty(projectForm, project);
  }
  if (kind === 'task') {
    return taskEditorDirty(taskForm, task);
  }
  if (kind === 'agent-create' && agentForm && agentCreateRole) {
    return agentCreateEditorDirty(agentForm, agentCreateRole);
  }
  if (kind === 'agent' && agentForm) {
    return agentEditorDirty(agentForm, agent ?? null);
  }
  return false;
}
