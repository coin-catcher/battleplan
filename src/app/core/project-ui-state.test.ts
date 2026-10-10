import { describe, expect, it } from 'vitest';
import {
  clampMindmapZoom,
  mindmapScrollFromView,
  mindmapViewFromScroll,
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
    const ui = normalizeProjectWorkspaceUiState({
      pane_width: 40,
      mindmap_zoom: 0.01,
      mindmap_origin_x: 10,
      mindmap_origin_y: 20,
    });
    expect(ui?.pane_width).toBe(280);
    expect(ui?.mindmap_zoom).toBe(0.35);
  });

  it('builds persisted workspace rows from live mindmap state', () => {
    const ui = projectWorkspaceUiFromMindmap(500, { zoom: 1, origin_x: 80, origin_y: 40 });
    expect(ui.pane_width).toBe(500);
    expect(ui.mindmap_origin_x).toBe(80);
  });
});
