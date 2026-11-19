/**
 * Mindmap task drag-drop pipeline (pointer → persistence → layout → edges).
 *
 * Call graph:
 * 1. `AppComponent.onNodePointerDown` — capture layout node origins, register window `pointermove` / `pointerup`.
 * 2. `pointermove` — `mindmapDragDeltaWorld` → `dragPins` / `mapDraggingNodeId` (in-memory layout override).
 * 3. `AppComponent.map` computed — merge `dragPins` into task `map_x`/`map_y`; optional `withRecoveryMapPositions` (staged recovery only).
 * 4. `shouldApplyFramedMindmapLayout` + `layoutMindmapOptionsForProject` → `layoutMindmap` → node positions + `drawEdge` / `sanitizeMindmapLayout`.
 * 5. Template binds `node.x`/`node.y` to `.map-node` `left`/`top`; edges via `mindmapEdgeSvgAttributes`.
 * 6. `pointerup` — `BattleplanStore.commitMindmapPosition` (sync signal/IDB-shaped coords) then `placeNode` (persist).
 * 7. `placeTaskOnMindmapForTask` — clamp to canvas; `LocalEngine.updateTask` writes `map_x`/`map_y` to repository.
 * 8. `replaceTask` — tasks signal update → `map` recomputes with framed layout (no drag pins).
 * 9. `ensureMindmapPlacementMigrated` — when legacy pile / sentinel / collision, batch-framed coords to storage.
 */
import type { Project, ProjectTask } from './models';
import {
  hasAnyFramedWorldTaskPin,
  layoutMindmap,
  layoutMindmapOptionsForProject,
  LEGACY_MINDMAP_PIN_MAX,
  MINDMAP_PLACEMENT_VERSION,
  mindmapPinsAreFramedWorldSpace,
  projectOrTasksNeedMindmapRelayout,
  resolvePersistedMindmapPin,
  type LayoutMindmapOptions,
} from './mindmap';

export const LEGACY_WORLD_PIN_MAX = LEGACY_MINDMAP_PIN_MAX;

export interface MindmapDragWorldDelta {
  dx: number;
  dy: number;
}

export interface MindmapPlacementPatch {
  project: Pick<Project, 'project_id' | 'map_x' | 'map_y' | 'mindmap_placement_version'>;
  tasks: Pick<ProjectTask, 'task_id' | 'map_x' | 'map_y'>[];
}

/** Convert screen pointer movement to world-space delta (matches `AppComponent.onNodePointerDown`). */
export function mindmapDragDeltaWorld(
  startClientX: number,
  startClientY: number,
  clientX: number,
  clientY: number,
  zoom: number,
): MindmapDragWorldDelta {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return {
    dx: (clientX - startClientX) / safeZoom,
    dy: (clientY - startClientY) / safeZoom,
  };
}

export function worldPointAfterDrag(
  originX: number,
  originY: number,
  delta: MindmapDragWorldDelta,
  minDragWorld = 0,
): { x: number; y: number; dragged: boolean } {
  const dragged = Math.hypot(delta.dx, delta.dy) >= minDragWorld;
  return {
    x: originX + delta.dx,
    y: originY + delta.dy,
    dragged,
  };
}

/**
 * Decide whether this layout pass should skip `applyMindmapCanvasFrame`.
 * Prevents snap-back when one task has been dragged into world space while siblings are still legacy.
 */
export function shouldApplyFramedMindmapLayout(
  project: Pick<Project, 'mindmap_placement_version' | 'map_x' | 'map_y'> | null | undefined,
  tasks: Pick<ProjectTask, 'map_x' | 'map_y'>[],
  layoutOptions: LayoutMindmapOptions,
  draggingMindmap: boolean,
): boolean {
  if (draggingMindmap) return true;
  if (layoutOptions.useFramedCoordinates) return true;
  return hasAnyFramedWorldTaskPin(tasks);
}

export function mindmapNeedsPlacementMigration(
  project: Pick<Project, 'mindmap_placement_version' | 'map_x' | 'map_y'>,
  tasks: Pick<ProjectTask, 'map_x' | 'map_y'>[],
): boolean {
  const version = project.mindmap_placement_version ?? 0;
  return projectOrTasksNeedMindmapRelayout(project, tasks) || version < MINDMAP_PLACEMENT_VERSION;
}

/** Pure migration payload for store / IndexedDB (unit-testable). */
export function computeMindmapPlacementPatch(
  project: Project,
  tasks: ProjectTask[],
): MindmapPlacementPatch | null {
  const version = project.mindmap_placement_version ?? 0;
  const needsContent = projectOrTasksNeedMindmapRelayout(project, tasks);
  const needsVersion = version < MINDMAP_PLACEMENT_VERSION;
  if (!needsContent && !needsVersion) return null;
  if (!needsContent && needsVersion && mindmapPinsAreFramedWorldSpace(project, tasks)) {
    return {
      project: {
        project_id: project.project_id,
        map_x: project.map_x,
        map_y: project.map_y,
        mindmap_placement_version: MINDMAP_PLACEMENT_VERSION,
      },
      tasks: [],
    };
  }
  const layout = layoutMindmap(
    project.title,
    tasks,
    resolvePersistedMindmapPin(project.map_x, project.map_y),
    project.status,
    project.task_graph_edges,
    { useFramedCoordinates: false },
  );
  const projectNode = layout.nodes.find((node) => node.id === 'project');
  if (!projectNode) return null;
  return {
    project: {
      project_id: project.project_id,
      map_x: Math.round(projectNode.x),
      map_y: Math.round(projectNode.y),
      mindmap_placement_version: MINDMAP_PLACEMENT_VERSION,
    },
    tasks: tasks.flatMap((task) => {
      const node = layout.nodes.find((item) => item.id === task.task_id);
      if (!node) return [];
      return [{
        task_id: task.task_id,
        map_x: Math.round(node.x),
        map_y: Math.round(node.y),
      }];
    }),
  };
}

/** Layout node position for a task after drag commit (no drag pins). */
export function layoutNodePositionAfterDragCommit(
  project: Pick<Project, 'title' | 'status' | 'mindmap_placement_version' | 'map_x' | 'map_y' | 'task_graph_edges'>,
  tasks: ProjectTask[],
  taskId: string,
  worldX: number,
  worldY: number,
): { x: number; y: number } | null {
  const committed = tasks.map((task) => (
    task.task_id === taskId
      ? { ...task, map_x: worldX, map_y: worldY }
      : task
  ));
  const layoutOptions = layoutMindmapOptionsForProject(project, committed);
  const useFramed = shouldApplyFramedMindmapLayout(project, committed, layoutOptions, false);
  const layout = layoutMindmap(
    project.title,
    committed,
    resolvePersistedMindmapPin(project.map_x, project.map_y),
    project.status,
    project.task_graph_edges,
    { useFramedCoordinates: useFramed },
  );
  const node = layout.nodes.find((item) => item.id === taskId);
  return node ? { x: node.x, y: node.y } : null;
}