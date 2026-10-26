import type { MindmapShape } from './mindmap';
import type { ProjectTask } from './models';

/** Resolve mindmap shape from task fields (single source for layout + tests). */
export function mindmapShapeForTask(task: Pick<ProjectTask, 'output_type' | 'node_kind'>): MindmapShape {
  if (task.node_kind === 'decision' || task.node_kind === 'critique') return 'decision';
  if (task.node_kind === 'gate') return 'gate';
  if (task.node_kind === 'fog' || task.node_kind === 'brainstorm') return 'brainstorm';
  if (task.node_kind === 'architect') return 'architect';
  if (task.output_type === 'research') return 'research';
  if (task.output_type === 'subproject') return 'subproject';
  return 'code';
}
