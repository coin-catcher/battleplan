import { defaultConnectorForTask } from './connector-defaults';
import { resolveCodeAgentId, resolveResearchAgentId, findProjectAgent } from './agent-bindings';
import type { Project, ProjectAgent, ProjectTask, TaskStatus } from './models';
import { TASK_STATUSES } from './models';

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

export function buildKanbanBoard(
  tasks: ProjectTask[],
  project: Project,
  agents: ProjectAgent[],
): KanbanColumn[] {
  const cards = tasks.map((task) => kanbanCardForTask(task, project, agents));
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
