import { test, expect } from '@playwright/test';
import {
  mindmapBrowserSeedPayloadLegacy,
  mindmapBrowserSeedPayloadMigrated,
} from '../e2e/seed-indexeddb';
import { readTaskPin, seedBattleplanInBrowser, taskNodePosition } from './helpers/seed-mindmap';

const TASK_ID = 'code-a';

test.describe('Mindmap task drag-drop', () => {
  test('migrates legacy piled tasks off the top-left cluster', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedBattleplanInBrowser(page, mindmapBrowserSeedPayloadLegacy());
    await page.locator('.map-stage .map-node').first().waitFor({ timeout: 60_000 });
    await expect.poll(async () => {
      const nodes = page.locator('.map-stage .map-node:not(.circle)');
      const count = await nodes.count();
      if (count < 3) return 0;
      const positions = await nodes.evaluateAll((els) => els.map((el) => ({
        x: parseFloat((el as HTMLElement).style.left || '0'),
        y: parseFloat((el as HTMLElement).style.top || '0'),
      })));
      return Math.min(...positions.map((p) => Math.min(p.x, p.y)));
    }, { timeout: 60_000 }).toBeGreaterThan(1500);
  });

  test('persists task position after drag and reload', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedBattleplanInBrowser(page, mindmapBrowserSeedPayloadMigrated());
    await page.locator(`.map-node[data-node-id="${TASK_ID}"]`).waitFor({ timeout: 90_000 });

    const before = await taskNodePosition(page, TASK_ID);
    expect(before).toBeTruthy();

    const node = page.locator(`.map-node[data-node-id="${TASK_ID}"]`);
    await node.scrollIntoViewIfNeeded();
    await node.evaluate((element) => {
      const el = element as HTMLElement;
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
      for (const step of [0.2, 0.4, 0.6, 0.8, 1]) {
        window.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true,
          clientX: cx + 240 * step,
          clientY: cy + 160 * step,
          pointerId: 1,
          isPrimary: true,
          buttons: 1,
        }));
      }
      window.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        clientX: cx + 240,
        clientY: cy + 160,
        pointerId: 1,
        isPrimary: true,
        buttons: 0,
      }));
    });

    await expect.poll(async () => {
      const after = await taskNodePosition(page, TASK_ID);
      if (!after || !before) return 0;
      return Math.hypot(after.left - before.left, after.top - before.top);
    }, { timeout: 15_000 }).toBeGreaterThan(60);

    const pinAfter = await readTaskPin(page, TASK_ID);
    const domAfter = await taskNodePosition(page, TASK_ID);
    expect(pinAfter?.map_x).toBeDefined();
    expect(Math.hypot((domAfter?.left ?? 0) - (pinAfter?.map_x ?? 0), (domAfter?.top ?? 0) - (pinAfter?.map_y ?? 0)))
      .toBeLessThan(8);

    await page.reload({ waitUntil: 'networkidle' });
    await page.locator(`.map-node[data-node-id="${TASK_ID}"]`).waitFor({ timeout: 60_000 });
    const pinReloaded = await readTaskPin(page, TASK_ID);
    const domReloaded = await taskNodePosition(page, TASK_ID);
    expect(pinReloaded?.map_x).toBe(pinAfter?.map_x);
    expect(pinReloaded?.map_y).toBe(pinAfter?.map_y);
    expect(Math.hypot((domReloaded?.left ?? 0) - (pinReloaded?.map_x ?? 0), (domReloaded?.top ?? 0) - (pinReloaded?.map_y ?? 0)))
      .toBeLessThan(8);
  });
});