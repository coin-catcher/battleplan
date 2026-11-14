export interface MindmapViewState {
  zoom: number;
  origin_x: number;
  origin_y: number;
}

export interface ProjectWorkspaceUiState {
  pane_width: number;
  mindmap_zoom: number;
  mindmap_origin_x: number;
  mindmap_origin_y: number;
}

/** 0.01 ⇒ 100 world px render as 1 screen px (100× zoom out from 1:1). */
export const MIN_MINDMAP_ZOOM = 0.01;
/** Reference viewport edge length for zoom / scroll (UI pane size; not world canvas span). */
export const MINDMAP_CANVAS_REFERENCE_VIEWPORT_PX = 1024;
/** World mindmap canvas is this fraction of the span that would fill the viewport at min zoom. */
export const MINDMAP_WORLD_CANVAS_FRACTION = 0.5;
const MAX_ZOOM = 2.5;
const MIN_PANE = 280;
const MAX_PANE = 720;

export function clampMindmapZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_MINDMAP_ZOOM, value));
}

/** World-space width/height of the mindmap (half the legacy full-viewport span). */
export function mindmapCanvasWorldSpan(): number {
  const fullSpan = MINDMAP_CANVAS_REFERENCE_VIEWPORT_PX / MIN_MINDMAP_ZOOM;
  return Math.ceil(fullSpan * MINDMAP_WORLD_CANVAS_FRACTION);
}

export function mindmapCanvasCenter(): { x: number; y: number } {
  const span = mindmapCanvasWorldSpan();
  return { x: span / 2, y: span / 2 };
}

export function clampPaneWidth(value: number): number {
  if (!Number.isFinite(value)) return 420;
  return Math.min(MAX_PANE, Math.max(MIN_PANE, Math.round(value)));
}

export function mindmapViewFromScroll(scrollLeft: number, scrollTop: number, zoom: number): MindmapViewState {
  const safeZoom = clampMindmapZoom(zoom);
  return {
    zoom: safeZoom,
    origin_x: scrollLeft / safeZoom,
    origin_y: scrollTop / safeZoom,
  };
}

export function mindmapScrollFromView(view: MindmapViewState): { scrollLeft: number; scrollTop: number; zoom: number } {
  const zoom = clampMindmapZoom(view.zoom);
  return {
    zoom,
    scrollLeft: view.origin_x * zoom,
    scrollTop: view.origin_y * zoom,
  };
}

/** World origin (top-left of viewport) that centers the canvas in the given viewport. */
export function mindmapViewCenteredOnCanvas(
  canvasWidth: number,
  canvasHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  zoom = 1,
): MindmapViewState {
  const safeZoom = clampMindmapZoom(zoom);
  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;
  return {
    zoom: safeZoom,
    origin_x: centerX - viewportWidth / (2 * safeZoom),
    origin_y: centerY - viewportHeight / (2 * safeZoom),
  };
}

/** Scroll origin so `worldX`,`worldY` sits at the viewport center. */
export function mindmapViewCenteredOnWorldPoint(
  worldX: number,
  worldY: number,
  viewportWidth: number,
  viewportHeight: number,
  zoom = 1,
): MindmapViewState {
  const safeZoom = clampMindmapZoom(zoom);
  return {
    zoom: safeZoom,
    origin_x: worldX - viewportWidth / (2 * safeZoom),
    origin_y: worldY - viewportHeight / (2 * safeZoom),
  };
}

export function mindmapViewFromProjectUiState(
  ui: ProjectWorkspaceUiState,
): MindmapViewState {
  return {
    zoom: ui.mindmap_zoom,
    origin_x: ui.mindmap_origin_x,
    origin_y: ui.mindmap_origin_y,
  };
}

export function normalizeMindmapViewState(
  input: Partial<MindmapViewState> | null | undefined,
): MindmapViewState | null {
  if (!input) return null;
  const zoom = clampMindmapZoom(Number(input.zoom));
  const origin_x = Number(input.origin_x);
  const origin_y = Number(input.origin_y);
  if (!Number.isFinite(origin_x) || !Number.isFinite(origin_y)) return null;
  return { zoom, origin_x, origin_y };
}

export function normalizeProjectWorkspaceUiState(
  input: Partial<ProjectWorkspaceUiState> | null | undefined,
): ProjectWorkspaceUiState | null {
  if (!input) return null;
  const mindmap = normalizeMindmapViewState({
    zoom: input.mindmap_zoom,
    origin_x: input.mindmap_origin_x,
    origin_y: input.mindmap_origin_y,
  });
  const pane_width = clampPaneWidth(Number(input.pane_width));
  if (!mindmap) return null;
  return {
    pane_width,
    mindmap_zoom: mindmap.zoom,
    mindmap_origin_x: mindmap.origin_x,
    mindmap_origin_y: mindmap.origin_y,
  };
}

export function projectWorkspaceUiFromMindmap(
  paneWidth: number,
  mindmap: MindmapViewState,
): ProjectWorkspaceUiState {
  const normalized = normalizeMindmapViewState(mindmap)!;
  return {
    pane_width: clampPaneWidth(paneWidth),
    mindmap_zoom: normalized.zoom,
    mindmap_origin_x: normalized.origin_x,
    mindmap_origin_y: normalized.origin_y,
  };
}
