import type { AgentOptionValue, OutputType, Project, ProjectAgent, ProjectTask } from './models';
import { type AgentEditorForm } from './agent-form';
import { defaultOptionValues } from './agent-types';
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

function optionMapsEqual(
  a: Record<string, AgentOptionValue>,
  b: Record<string, AgentOptionValue>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

export function agentEditorDirty(form: AgentEditorForm, saved: ProjectAgent | null): boolean {
  if (!saved) return true;
  const savedOptions = { ...defaultOptionValues(saved.type), ...(saved.options ?? {}) };
  const apiDirty = form.apiKeyTouched && form.api_key.trim() !== (saved.api_key ?? '').trim();
  const adminDirty = form.adminApiKeyTouched && form.admin_api_key.trim() !== (saved.admin_api_key ?? '').trim();
  return form.type !== saved.type
    || form.name.trim() !== saved.name
    || form.url.trim() !== saved.url
    || apiDirty
    || adminDirty
    || !optionMapsEqual(form.options, savedOptions);
}

export function editorPanelDirty(
  kind: 'project' | 'subproject' | 'task' | 'agent' | 'agent-create' | string,
  projectForm: ProjectEditorForm,
  taskForm: TaskEditorForm,
  project: Project | null,
  task: ProjectTask | null,
  agentForm?: AgentEditorForm | null,
  savedAgent?: ProjectAgent | null,
): boolean {
  if (kind === 'project' || kind === 'subproject') {
    return projectEditorDirty(projectForm, project);
  }
  if (kind === 'task') {
    return taskEditorDirty(taskForm, task);
  }
  if ((kind === 'agent' || kind === 'agent-create') && agentForm) {
    return agentEditorDirty(agentForm, savedAgent ?? null);
  }
  return false;
}
