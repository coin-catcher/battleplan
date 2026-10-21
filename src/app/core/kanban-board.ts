import { defaultConnectorForTask } from './connector-defaults';
import { resolveCodeAgentId, resolveResearchAgentId, findProjectAgent } from './agent-bindings';
import { buildTaskParentMap } from './task-tree';
import type { Project, ProjectAgent, ProjectTask, TaskStatus } from './models';
import { TASK_STATUSES } from './models';

/** `main` = tasks not under any subproject node; otherwise a subproject task id. */
export type KanbanScopeId = 'main' | string;

export interface KanbanScopeOption {
  id: KanbanScopeId;
  label: string;
}

export interface KanbanCard {
  task_id: string;
  title: string;
  status: TaskStatus;
  output_type: ProjectTask['output_type'];
  connector_kind: string;
  agent_label: string;
  lifecycle_phase?: string;
}

export interface KanbanColumn {
  status: TaskStatus;
  cards: KanbanCard[];
}

export function listKanbanScopeOptions(tasks: ProjectTask[]): KanbanScopeOption[] {
  const options: KanbanScopeOption[] = [{ id: 'main', label: 'Main project' }];
  for (const task of [...tasks].filter((item) => item.output_type === 'subproject').sort((a, b) => (
    a.order - b.order || a.title.localeCompare(b.title)
  ))) {
    options.push({ id: task.task_id, label: task.title });
  }
  return options;
}

/** Tasks whose primary-parent chain includes `ancestorTaskId`. */
export function descendantTaskIds(ancestorTaskId: string, tasks: ProjectTask[]): Set<string> {
  const parentOf = buildTaskParentMap(tasks);
  const ids = new Set<string>();
  for (const task of tasks) {
    let current: string | null = task.task_id;
    while (current) {
      if (current === ancestorTaskId) {
        ids.add(task.task_id);
        break;
      }
      current = parentOf.get(current) ?? null;
    }
  }
  return ids;
}

/** All tasks that live under any subproject mindmap node (including the subproject nodes). */
export function taskIdsUnderAnySubproject(tasks: ProjectTask[]): Set<string> {
  const covered = new Set<string>();
  for (const subproject of tasks.filter((task) => task.output_type === 'subproject')) {
    for (const id of descendantTaskIds(subproject.task_id, tasks)) covered.add(id);
  }
  return covered;
}

export function filterTasksForKanbanScope(tasks: ProjectTask[], scopeId: KanbanScopeId): ProjectTask[] {
  if (scopeId === 'main') {
    const underSubproject = taskIdsUnderAnySubproject(tasks);
    return tasks.filter((task) => !underSubproject.has(task.task_id));
  }
  const inScope = descendantTaskIds(scopeId, tasks);
  inScope.delete(scopeId);
  return tasks.filter((task) => inScope.has(task.task_id));
}

export function buildKanbanBoard(
  tasks: ProjectTask[],
  project: Project,
  agents: ProjectAgent[],
  scopeId: KanbanScopeId = 'main',
): KanbanColumn[] {
  const scoped = filterTasksForKanbanScope(tasks, scopeId);
  const cards = scoped.map((task) => kanbanCardForTask(task, project, agents));
  return TASK_STATUSES.filter((status) => status !== 'ABANDONED').map((status) => ({
    status,
    cards: cards.filter((card) => card.status === status).sort((a, b) => a.title.localeCompare(b.title)),
  }));
}

function kanbanCardForTask(task: ProjectTask, project: Project, agents: ProjectAgent[]): KanbanCard {
  const connector = defaultConnectorForTask(task, project);
  let agentLabel = 'Unassigned';
  if (task.output_type === 'code') {
    const id = resolveCodeAgentId(task, project);
    agentLabel = findProjectAgent(agents, id)?.name ?? (id ? 'Code agent' : 'Project default code');
  } else if (task.output_type === 'research') {
    const id = resolveResearchAgentId(task, project);
    agentLabel = findProjectAgent(agents, id)?.name ?? (id ? 'Research agent' : 'Project default research');
  } else if (task.output_type === 'subproject') {
    agentLabel = project.default_hermes_connector_id ? 'Hermes (subproject)' : 'Subproject';
  }
  return {
    task_id: task.task_id,
    title: task.title,
    status: task.status,
    output_type: task.output_type,
    connector_kind: connector,
    agent_label: agentLabel,
    lifecycle_phase: task.lifecycle_phase,
  };
}
