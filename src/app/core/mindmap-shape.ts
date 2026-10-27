import type { MindmapShape } from './mindmap';
import type { ProjectTask } from './models';

/** Layout box sizes aligned to BPMN / flowchart stencil proportions. */
export function mindmapNodeSize(shape: MindmapShape): { width: number; height: number } {
  switch (shape) {
    case 'project':
    case 'subproject':
      return { width: 136, height: 136 };
    case 'research':
      return { width: 172, height: 72 };
    case 'brainstorm':
    case 'fog':
      return { width: 188, height: 104 };
    case 'decision':
      return { width: 112, height: 112 };
    case 'architect':
      return { width: 176, height: 72 };
    case 'gate':
    case 'code':
    default:
      return { width: 156, height: 64 };
  }
}

/** Resolve mindmap shape from task fields (single source for layout + tests). */
export function mindmapShapeForTask(task: Pick<ProjectTask, 'output_type' | 'node_kind'>): MindmapShape {
  if (task.node_kind === 'decision' || task.node_kind === 'critique') return 'decision';
  if (task.node_kind === 'gate') return 'gate';
  if (task.node_kind === 'fog' || task.node_kind === 'brainstorm') return 'brainstorm';
  if (task.node_kind === 'architect') return 'architect';
  if (task.output_type === 'research') return 'research';
  if (task.output_type === 'subproject') return 'subproject';
  if (task.output_type === 'execute' || task.output_type === 'add_workflow') return 'code';
  return 'code';
}
