import type { LifecyclePhase, OutputType, ProjectTask } from './models';
import type { TaskNodeKind } from './task-node-kind';
import {
  type WorkflowTaskKind,
  WORKFLOW_TASK_KINDS,
  workflowKindToTaskFields,
} from './workflow-task-kind';

export type TaskEditorKind = WorkflowTaskKind | 'subproject' | 'execute' | 'add_workflow';

export function taskEditorKindFromTask(task: Pick<ProjectTask, 'output_type' | 'node_kind'>): TaskEditorKind {
  if (task.output_type === 'subproject') return 'subproject';
  if (task.output_type === 'execute') return 'execute';
  if (task.output_type === 'add_workflow') return 'add_workflow';
  if (task.output_type === 'code') return 'code';
  if (task.node_kind === 'brainstorm') return 'brainstorming';
  if (task.node_kind === 'critique') return 'critiquing';
  if (task.node_kind === 'architect') return 'architect';
  return 'research';
}

export function fieldsFromTaskEditorKind(kind: TaskEditorKind): {
  output_type: OutputType;
  node_kind?: TaskNodeKind;
  lifecycle_phase?: LifecyclePhase;
} {
  if (kind === 'subproject') {
    return { output_type: 'subproject' };
  }
  if (kind === 'execute') {
    return { output_type: 'execute', node_kind: 'work', lifecycle_phase: 'build' };
  }
  if (kind === 'add_workflow') {
    return { output_type: 'add_workflow', node_kind: 'work', lifecycle_phase: 'verify' };
  }
  if ((WORKFLOW_TASK_KINDS as readonly string[]).includes(kind)) {
    return workflowKindToTaskFields(kind as WorkflowTaskKind);
  }
  return { output_type: 'research' };
}

export function isResearchFamilyOutputType(outputType: OutputType): boolean {
  return outputType === 'research';
}
