import type { Project, ProjectTask } from '../src/app/core/models';
import { layoutMindmap, MINDMAP_PLACEMENT_VERSION, resolvePersistedMindmapPin } from '../src/app/core/mindmap';
import {
  MINDMAP_SAMPLE_GRAPH_EDGES,
  MINDMAP_SAMPLE_PROJECT,
  MINDMAP_SAMPLE_TASKS,
  mindmapSampleTasksWithLayoutPins,
} from '../src/app/core/fixtures/mindmap-sample-project';

export type BrowserSeedPayload = {
  project: Project;
  tasks: ProjectTask[];
};

/** Tasks with legacy pre-frame pins (top-left cluster) to reproduce the pile bug in the browser. */
export function mindmapSampleTasksLegacyPile(): ProjectTask[] {
  return MINDMAP_SAMPLE_TASKS.map((task, index) => ({
    ...task,
    map_x: 120 + (index % 3) * 8,
    map_y: 140 + Math.floor(index / 3) * 8,
  }));
}

export function mindmapSampleProjectLegacyPile(): Project {
  return {
    ...MINDMAP_SAMPLE_PROJECT,
    mindmap_placement_version: 3,
    map_x: 118,
    map_y: 136,
    task_graph_edges: MINDMAP_SAMPLE_GRAPH_EDGES,
    graph_recovery_completed_at: new Date().toISOString(),
  };
}

export function mindmapBrowserSeedPayloadLegacy(): BrowserSeedPayload {
  return {
    project: mindmapSampleProjectLegacyPile(),
    tasks: mindmapSampleTasksLegacyPile(),
  };
}

export function mindmapBrowserSeedPayloadMigrated(): BrowserSeedPayload {
  const project = mindmapSampleProjectLegacyPile();
  const tasks = mindmapSampleTasksLegacyPile();
  const layout = layoutMindmap(
    project.title,
    tasks,
    resolvePersistedMindmapPin(project.map_x, project.map_y),
    project.status,
    project.task_graph_edges,
    { useFramedCoordinates: false },
  );
  const projectNode = layout.nodes.find((node) => node.id === 'project')!;
  return {
    project: {
      ...project,
      map_x: Math.round(projectNode.x),
      map_y: Math.round(projectNode.y),
      mindmap_placement_version: MINDMAP_PLACEMENT_VERSION,
    },
    tasks: mindmapSampleTasksWithLayoutPins(layout.nodes),
  };
}

export function mindmapBrowserSeedPayload(): BrowserSeedPayload {
  return mindmapBrowserSeedPayloadMigrated();
}