import { defaultOptionValues, getAgentTypeDefinition, mergeAgentOptions } from './agent-types';
import type { AgentKind, AgentOptionValue, AgentType, OutputType, Project, ProjectAgent, ProjectTask } from './models';
import { TASK_BRIEF_FIELDS, type TaskBrief } from './task-brief';
import { taskInitialPrompt } from './task-fields';
import { taskEditorKindFromTask, type TaskEditorKind } from './task-editor-kind';

export interface ProjectEditorForm {
  title: string;
  repo_url: string;
  starting_ref: string;
  github_pat: string;
  dar: string;
  initial_prompt?: string;
  mindmap_theme?: string;
}

export interface TaskEditorForm {
  title: string;
  brief: TaskBrief;
  initial_prompt: string;
  /** @deprecated Prefer editor_kind; kept for legacy callers. */
  output_type: OutputType;
  editor_kind: TaskEditorKind;
  dependencies: string[];
  sibling_dependencies: string[];
  research_agent_id?: string;
  code_agent_id?: string;
  repo_path?: string;
}

function taskBriefDirty(form: TaskBrief, task: ProjectTask | null): boolean {
  if (!task) return false;
  for (const field of TASK_BRIEF_FIELDS) {
    const saved = task.brief?.[field]?.trim() ?? '';
    if (form[field].trim() !== saved) return true;
  }
  return false;
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
  const savedTheme = project.mindmap_theme ?? 'dark';
  const formTheme = form.mindmap_theme ?? savedTheme;
  return form.title.trim() !== project.title
    || form.repo_url.trim() !== (project.repo_url ?? '').trim()
    || branch !== savedBranch
    || form.github_pat.trim() !== (project.github_pat ?? '').trim()
    || form.dar.trim() !== savedDar
    || formTheme !== savedTheme
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
  const savedKind = taskEditorKindFromTask(task);
  return form.title !== task.title
    || taskBriefDirty(form.brief, task)
    || form.editor_kind !== savedKind
    || form.output_type !== task.output_type
    || initialDirty
    || (form.research_agent_id ?? '') !== (task.research_agent_id ?? '')
    || (form.code_agent_id ?? '') !== (task.code_agent_id ?? '')
    || (form.repo_path ?? '').trim() !== (task.repo_path ?? '').trim()
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
  if (kind === 'task' && task) {
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
