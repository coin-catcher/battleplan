import type { OutputType, Project, ProjectTask } from './models';

export interface ProjectEditorForm {
  title: string;
  repo_url: string;
  starting_ref: string;
}

export interface TaskEditorForm {
  title: string;
  prompt: string;
  output_type: OutputType;
  dependencies: string[];
}

export function projectEditorDirty(form: ProjectEditorForm, project: Project | null): boolean {
  if (!project) return false;
  const branch = form.starting_ref.trim() || 'main';
  const savedBranch = project.starting_ref?.trim() || 'main';
  return form.title.trim() !== project.title
    || form.repo_url.trim() !== (project.repo_url ?? '').trim()
    || branch !== savedBranch;
}

export function taskEditorDirty(form: TaskEditorForm, task: ProjectTask | null): boolean {
  if (!task) return false;
  const deps = [...form.dependencies].sort();
  const saved = [...task.dependencies].sort();
  return form.title !== task.title
    || form.prompt !== task.prompt
    || form.output_type !== task.output_type
    || deps.length !== saved.length
    || deps.some((id, index) => id !== saved[index]);
}

export function editorPanelDirty(
  kind: 'project' | 'subproject' | 'task' | string,
  projectForm: ProjectEditorForm,
  taskForm: TaskEditorForm,
  project: Project | null,
  task: ProjectTask | null,
): boolean {
  if (kind === 'project' || kind === 'subproject') {
    return projectEditorDirty(projectForm, project);
  }
  if (kind === 'task') {
    return taskEditorDirty(taskForm, task);
  }
  return false;
}
