import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { LocalEngine } from './local-engine';
import { IdbRepository } from './idb-repository';
import { computeMindmapPlacementPatch } from '../core/mindmap-drag-pipeline';
import {
  mindmapBrowserSeedPayloadLegacy,
} from '../../../e2e/seed-indexeddb';

function cursorStub() {
  return {
    createAgent: async () => ({ id: 'agent-1' }),
    archiveAgent: async () => {},
  };
}

describe('mindmap IndexedDB migration', () => {
  it('persists framed coordinates after applying a placement patch', async () => {
    const repo = new IdbRepository();
    const engine = new LocalEngine(repo, cursorStub() as never, () => new Date().toISOString(), () => 'id-1');
    const seed = mindmapBrowserSeedPayloadLegacy();
    await repo.saveProject(seed.project);
    await repo.saveTasks(seed.tasks);

    const tasks = await engine.listTasks(seed.project.project_id);
    const patch = computeMindmapPlacementPatch(seed.project, tasks);
    expect(patch).toBeTruthy();
    expect(patch!.tasks.length).toBeGreaterThan(0);

    await engine.updateProject(seed.project.project_id, {
      map_x: patch!.project.map_x,
      map_y: patch!.project.map_y,
      mindmap_placement_version: patch!.project.mindmap_placement_version,
    });
    for (const row of patch!.tasks) {
      await engine.updateTask(seed.project.project_id, row.task_id, {
        map_x: row.map_x,
        map_y: row.map_y,
      });
    }

    const stored = await repo.listTasks(seed.project.project_id);
    const framed = stored.filter((task) => (task.map_x ?? 0) > 2500);
    expect(framed.length).toBeGreaterThanOrEqual(seed.tasks.length - 1);
    const project = await repo.getProject(seed.project.project_id);
    expect(project?.mindmap_placement_version).toBe(4);
    expect(project?.map_x).toBeGreaterThan(2500);
  });
});