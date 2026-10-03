import type { Project, ProjectTask } from './models';
import { buildTaskParentMap } from './task-tree';

export function formatDarSection(title: string, body: string): string | null {
  const text = body.trim();
  if (!text) return null;
  return `### Data and Rules: ${title}\n\n${text}`;
}

export function joinDarSections(sections: string[]): string {
  return sections.filter(Boolean).join('\n\n');
}

export interface DarLookup {
  getProject(projectId: string): Promise<Project | null>;
  getTask(taskId: string): Promise<ProjectTask | null>;
  listTasks(projectId: string): Promise<ProjectTask[]>;
}

/** DAR blocks from the top ancestor down to the current task (excluding the chat message). */
export async function collectTaskDarSections(task: ProjectTask, lookup: DarLookup): Promise<string[]> {
  const project = await lookup.getProject(task.project_id);
  if (!project) return sectionForTask(task);

  const tasks = await lookup.listTasks(task.project_id);
  const parentOf = buildTaskParentMap(tasks);
  const byId = new Map(tasks.map((item) => [item.task_id, item]));

  const ancestorTasks: ProjectTask[] = [];
  let subprojectBoundary: ProjectTask | null = null;
  let walk = parentOf.get(task.task_id) ?? null;
  while (walk) {
    const node = byId.get(walk);
    if (!node) break;
    ancestorTasks.push(node);
    if (node.output_type === 'subproject') {
      subprojectBoundary = node;
      break;
    }
    walk = parentOf.get(walk) ?? null;
  }

  const blocks: string[] = [];

  if (subprojectBoundary) {
    blocks.push(...await subprojectBoundarySections(subprojectBoundary, lookup));
  } else if (project.parent_task_id) {
    blocks.push(...await nestedProjectBoundarySections(project, lookup));
  } else {
    pushSection(blocks, project.title, project.dar ?? '');
  }

  for (const ancestor of [...ancestorTasks].reverse()) {
    if (subprojectBoundary && ancestor.task_id === subprojectBoundary.task_id) continue;
    pushSection(blocks, ancestor.title, ancestor.prompt);
  }

  pushSection(blocks, task.title, task.prompt);
  return blocks;
}

export async function collectProjectDarSections(project: Project, lookup: DarLookup): Promise<string[]> {
  if (project.parent_task_id) {
    return nestedProjectBoundarySections(project, lookup);
  }
  const section = formatDarSection(project.title, project.dar ?? '');
  return section ? [section] : [];
}

async function nestedProjectBoundarySections(project: Project, lookup: DarLookup): Promise<string[]> {
  const blocks: string[] = [];
  const parentTask = project.parent_task_id ? await lookup.getTask(project.parent_task_id) : null;
  if (parentTask) {
    pushSection(blocks, parentTask.title, parentTask.prompt);
  }
  pushSection(blocks, project.title, project.dar ?? '');
  return blocks;
}

async function subprojectBoundarySections(task: ProjectTask, lookup: DarLookup): Promise<string[]> {
  const blocks: string[] = [];
  pushSection(blocks, task.title, task.prompt);
  if (task.subproject_id) {
    const nested = await lookup.getProject(task.subproject_id);
    if (nested) pushSection(blocks, nested.title, nested.dar ?? '');
  }
  return blocks;
}

function sectionForTask(task: ProjectTask): string[] {
  const section = formatDarSection(task.title, task.prompt);
  return section ? [section] : [];
}

function pushSection(blocks: string[], title: string, body: string): void {
  const section = formatDarSection(title, body);
  if (section) blocks.push(section);
}
