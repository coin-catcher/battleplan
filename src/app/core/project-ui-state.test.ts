import { describe, expect, it } from 'vitest';
import {
  clampMindmapZoom,
  MIN_MINDMAP_ZOOM,
  mindmapCanvasWorldSpan,
  mindmapScrollFromView,
  mindmapViewCenteredOnCanvas,
  mindmapViewFromScroll,
  MINDMAP_CANVAS_REFERENCE_VIEWPORT_PX,
  normalizeProjectWorkspaceUiState,
  projectWorkspaceUiFromMindmap,
} from './project-ui-state';

describe('project-ui-state', () => {
  it('round-trips scroll position through world origin', () => {
    const view = mindmapViewFromScroll(240, 120, 1.2);
    const scroll = mindmapScrollFromView(view);
    expect(scroll.zoom).toBe(1.2);
    expect(scroll.scrollLeft).toBeCloseTo(240, 5);
    expect(scroll.scrollTop).toBeCloseTo(120, 5);
  });

  it('clamps zoom and pane width', () => {
    expect(clampMindmapZoom(99)).toBe(2.5);
    expect(clampMindmapZoom(0.001)).toBe(0.01);
    const ui = normalizeProjectWorkspaceUiState({
      pane_width: 40,
      mindmap_zoom: 0.01,
      mindmap_origin_x: 10,
      mindmap_origin_y: 20,
    });
    expect(ui?.pane_width).toBe(280);
    expect(ui?.mindmap_zoom).toBe(0.01);
  });

  it('centers the viewport on the canvas midpoint', () => {
    const view = mindmapViewCenteredOnCanvas(102_400, 102_400, 800, 600, 1);
    expect(view.origin_x + 800 / 2).toBeCloseTo(51_200, 0);
    expect(view.origin_y + 600 / 2).toBeCloseTo(51_200, 0);
  });

  it('sizes world canvas for edge-to-edge view at minimum zoom', () => {
    expect(mindmapCanvasWorldSpan()).toBe(Math.ceil(MINDMAP_CANVAS_REFERENCE_VIEWPORT_PX / MIN_MINDMAP_ZOOM));
    expect(MINDMAP_CANVAS_REFERENCE_VIEWPORT_PX / mindmapCanvasWorldSpan()).toBe(MIN_MINDMAP_ZOOM);
  });

  it('builds persisted workspace rows from live mindmap state', () => {
    const ui = projectWorkspaceUiFromMindmap(500, { zoom: 1, origin_x: 80, origin_y: 40 });
    expect(ui.pane_width).toBe(500);
    expect(ui.mindmap_origin_x).toBe(80);
  });
});
