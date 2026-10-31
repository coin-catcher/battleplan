import type { Project, ProjectTask } from './models';
import { inferDiscoveryGraphType } from './discovery-task-kind';
import {
  type CritiqueDecisionMode,
  type ResearchOutputMode,
  type TaskGraphType,
  taskGraphTypeToMindmapFields,
} from './task-graph-type';

/** Bump when persisted task graph_type schema changes; stored on project.graph_of_agents_version. */
export const TASK_GRAPH_TYPE_SCHEMA_VERSION = 1;

export interface TaskGraphTypeMigrationResult {
  project: Project;
  tasks: ProjectTask[];
  migratedTasks: number;
  changed: boolean;
}

function optionalSlug(task: ProjectTask): string {
  return task.discovery_task_slug?.trim().toLowerCase() ?? '';
}

/** Infer graph type from pre-schema tasks (output_type + node_kind + discovery slugs only). */
export function inferGraphTypeFromLegacyTask(
  task: ProjectTask,
  options?: { discoveryRootTaskId?: string },
): TaskGraphType {
  if (task.graph_type) return task.graph_type;
  if (task.node_kind === 'brainstorm') return 'research';
  if (task.node_kind === 'critique') return 'critique';
  if (task.output_type === 'code') return 'code';
  const slug = optionalSlug(task);
  if (slug.startsWith('partition-')) return 'research';
  if (
    options?.discoveryRootTaskId
    && task.task_id === options.discoveryRootTaskId
    && task.node_kind === 'brainstorm'
  ) {
    return 'research';
  }
  if (task.graph_id && slug && !slug.startsWith('partition-')) {
    return 'code';
  }
  if (task.graph_id && task.pattern_id && task.output_type === 'research' && task.node_kind !== 'critique') {
    return 'code';
  }
  const record = {
    title: task.title,
    layer: 2,
    brief_path: task.repo_path ? `${task.repo_path}brief.md` : undefined,
    id: task.discovery_task_slug,
    pattern_id: task.pattern_id,
  };
  return inferDiscoveryGraphType(record);
}

export function inferResearchModeFromLegacyTask(
  task: ProjectTask,
  graphType: TaskGraphType,
): ResearchOutputMode | undefined {
  if (graphType !== 'research') return undefined;
  if (task.research_mode) return task.research_mode;
  if (task.node_kind === 'brainstorm') return 'subgraph';
  const slug = optionalSlug(task);
  if (slug.startsWith('partition-')) return 'subgraph';
  return 'document';
}

export function inferDecisionModeFromLegacyTask(task: ProjectTask): CritiqueDecisionMode | undefined {
  if (task.decision_mode) return task.decision_mode;
  if (task.graph_type !== 'critique' && task.node_kind !== 'critique') return undefined;
  const pattern = task.pattern_id?.toLowerCase().replace(/_/g, '-');
  if (pattern === 'spike-gate' || pattern === 'critique-retry' || pattern === 'critique-retry-loop') {
    return 'yes_no';
  }
  const title = task.title.toLowerCase();
  if (/\b(pass|fail|yes|no|gate|threshold)\b/.test(title)) return 'yes_no';
  return 'one_of';
}

function applyGraphTypeFields(
  task: ProjectTask,
  project: Project,
  graphType: TaskGraphType,
): ProjectTask {
  const mapped = taskGraphTypeToMindmapFields(graphType);
  const next: ProjectTask = { ...task, graph_type: graphType };
  if (mapped.output_type !== task.output_type) {
    next.output_type = mapped.output_type as ProjectTask['output_type'];
    if (next.output_type === 'code') {
      next.code_agent_id = project.default_code_agent_id;
      next.research_agent_id = undefined;
    } else if (next.output_type === 'research') {
      next.research_agent_id = project.default_research_agent_id;
      next.code_agent_id = undefined;
    }
  }
  if (mapped.node_kind && task.node_kind !== 'critique' && task.node_kind !== 'brainstorm') {
    next.node_kind = mapped.node_kind;
  }
  if (graphType === 'critique') {
    next.node_kind = 'critique';
  }
  if (graphType === 'research' && task.node_kind === 'brainstorm') {
    next.node_kind = 'brainstorm';
  }
  if (mapped.lifecycle_phase && !task.lifecycle_phase) {
    next.lifecycle_phase = mapped.lifecycle_phase;
  }
  const researchMode = inferResearchModeFromLegacyTask(next, graphType);
  if (researchMode) next.research_mode = researchMode;
  const decisionMode = inferDecisionModeFromLegacyTask({ ...next, graph_type: graphType });
  if (decisionMode) next.decision_mode = decisionMode;
  return next;
}

function taskNeedsGraphTypeUpgrade(task: ProjectTask, upgraded: ProjectTask): boolean {
  return upgraded.graph_type !== task.graph_type
    || upgraded.output_type !== task.output_type
    || upgraded.node_kind !== task.node_kind
    || upgraded.research_mode !== task.research_mode
    || upgraded.decision_mode !== task.decision_mode
    || upgraded.code_agent_id !== task.code_agent_id
    || upgraded.research_agent_id !== task.research_agent_id;
}

/** One-time upgrade: legacy mindmap tasks → graph_type + corrected output_type/node_kind. */
export function migrateTaskGraphTypeSchema(
  project: Project,
  tasks: ProjectTask[],
): TaskGraphTypeMigrationResult {
  if ((project.graph_of_agents_version ?? 0) >= TASK_GRAPH_TYPE_SCHEMA_VERSION) {
    return { project, tasks, migratedTasks: 0, changed: false };
  }
  const discoveryRootId = tasks.find((task) => task.node_kind === 'brainstorm')?.task_id;
  let migratedTasks = 0;
  const nextTasks = tasks.map((task) => {
    const graphType = inferGraphTypeFromLegacyTask(task, { discoveryRootTaskId: discoveryRootId });
    const upgraded = applyGraphTypeFields(task, project, graphType);
    if (taskNeedsGraphTypeUpgrade(task, upgraded)) {
      migratedTasks += 1;
      return { ...upgraded, updated_at: new Date().toISOString() };
    }
    if (!task.graph_type && upgraded.graph_type) {
      migratedTasks += 1;
      return { ...upgraded, updated_at: new Date().toISOString() };
    }
    return task;
  });
  const nextProject: Project = {
    ...project,
    graph_of_agents_version: TASK_GRAPH_TYPE_SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
  };
  return {
    project: nextProject,
    tasks: nextTasks,
    migratedTasks,
    changed: migratedTasks > 0 || nextProject.graph_of_agents_version !== project.graph_of_agents_version,
  };
}
