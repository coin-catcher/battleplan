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

/** Task kinds offered when adding a connected node from a mindmap edge arrow. */
export type MindmapConnectTaskKind = Exclude<TaskEditorKind, 'execute'>;

export const MINDMAP_CONNECT_TASK_KINDS: readonly MindmapConnectTaskKind[] = [
  'brainstorming',
  'research',
  'code',
  'critiquing',
  'architect',
  'add_workflow',
  'subproject',
];

const MINDMAP_CONNECT_LABELS: Record<MindmapConnectTaskKind, string> = {
  brainstorming: 'Add brainstorm task',
  research: 'Add research task',
  code: 'Add code task',
  critiquing: 'Add critique task',
  architect: 'Add architecture task',
  add_workflow: 'Add workflow task',
  subproject: 'Add subproject',
};

const MINDMAP_CONNECT_DEFAULT_TITLES: Record<MindmapConnectTaskKind, string> = {
  brainstorming: 'New brainstorm task',
  research: 'New research task',
  code: 'New code task',
  critiquing: 'New critique task',
  architect: 'New architecture task',
  add_workflow: 'New workflow task',
  subproject: 'New subproject',
};

export function mindmapConnectTaskLabel(kind: MindmapConnectTaskKind): string {
  return MINDMAP_CONNECT_LABELS[kind];
}

export function mindmapConnectDefaultTitle(kind: MindmapConnectTaskKind): string {
  return MINDMAP_CONNECT_DEFAULT_TITLES[kind];
}
