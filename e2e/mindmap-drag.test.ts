import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { layoutMindmap } from '../src/app/core/mindmap';
import {
  MINDMAP_SAMPLE_GRAPH_EDGES,
  MINDMAP_SAMPLE_PROJECT,
  MINDMAP_SAMPLE_TASKS,
  mindmapSampleTasksWithLayoutPins,
} from '../src/app/core/fixtures/mindmap-sample-project';
import { buildMindmapHarnessHtml } from './mindmap-harness';
import { mindmapCanvasCenter } from '../src/app/core/project-ui-state';

describe('mindmap UI drag (puppeteer)', () => {
  it('drags a task node to a new screen position', async () => {
    const center = mindmapCanvasCenter();
    const migrated = layoutMindmap(
      MINDMAP_SAMPLE_PROJECT.title,
      MINDMAP_SAMPLE_TASKS,
      { x: center.x, y: center.y },
      MINDMAP_SAMPLE_PROJECT.status,
      MINDMAP_SAMPLE_GRAPH_EDGES,
      { useFramedCoordinates: false },
    );
    const pinned = mindmapSampleTasksWithLayoutPins(migrated.nodes);
    const projectNode = migrated.nodes.find((node) => node.id === 'project')!;
    const layout = layoutMindmap(
      MINDMAP_SAMPLE_PROJECT.title,
      pinned,
      { x: Math.round(projectNode.x), y: Math.round(projectNode.y) },
      MINDMAP_SAMPLE_PROJECT.status,
      MINDMAP_SAMPLE_GRAPH_EDGES,
      { useFramedCoordinates: true },
    );
    const target = layout.nodes.find((node) => node.id === 'code-a');
    expect(target).toBeTruthy();

    const dir = join(tmpdir(), `battleplan-mindmap-e2e-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const htmlPath = join(dir, 'harness.html');
    writeFileSync(htmlPath, buildMindmapHarnessHtml(layout, 0.12));

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 960, height: 720 });
      await page.goto(`file://${htmlPath}`, { waitUntil: 'domcontentloaded' });

      await page.waitForSelector('[data-node-id="code-a"]');
      await page.evaluate((zoom) => {
        const el = document.querySelector('[data-node-id="code-a"]') as HTMLElement;
        const stage = document.getElementById('stage') as HTMLElement;
        const x = Number(el.dataset.x) * zoom;
        const y = Number(el.dataset.y) * zoom;
        stage.scrollLeft = Math.max(0, x - stage.clientWidth / 2);
        stage.scrollTop = Math.max(0, y - stage.clientHeight / 2);
      }, 0.12);

      const before = await page.$eval('[data-node-id="code-a"]', (el) => ({
        x: Number((el as HTMLElement).dataset.x),
        y: Number((el as HTMLElement).dataset.y),
      }));

      const dragResult = await page.evaluate(() => {
        const el = document.querySelector('[data-node-id="code-a"]') as HTMLElement;
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        el.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true,
          clientX: cx,
          clientY: cy,
          pointerId: 1,
          isPrimary: true,
          buttons: 1,
        }));
        for (const step of [0.25, 0.5, 0.75, 1]) {
          window.dispatchEvent(new PointerEvent('pointermove', {
            bubbles: true,
            clientX: cx + 140 * step,
            clientY: cy + 90 * step,
            pointerId: 1,
            isPrimary: true,
            buttons: 1,
          }));
        }
        window.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true,
          clientX: cx + 140,
          clientY: cy + 90,
          pointerId: 1,
          isPrimary: true,
          buttons: 0,
        }));
        const moved = document.getElementById('moved');
        return {
          moved: Boolean(moved && !moved.hasAttribute('hidden')),
          x: Number(el.dataset.x),
          y: Number(el.dataset.y),
        };
      });

      expect(dragResult.moved).toBe(true);
      expect(Math.hypot(dragResult.x - before.x, dragResult.y - before.y)).toBeGreaterThan(80);
    } finally {
      await browser.close();
    }
  }, 60_000);
});