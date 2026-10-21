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

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.5;
const MIN_PANE = 280;
const MAX_PANE = 720;

export function clampMindmapZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
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
