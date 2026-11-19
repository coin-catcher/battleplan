import { spawn, type ChildProcess } from 'node:child_process';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import puppeteer, { type Page } from 'puppeteer';
import waitOn from 'wait-on';
import {
  mindmapBrowserSeedPayloadLegacy,
  mindmapBrowserSeedPayloadMigrated,
  type BrowserSeedPayload,
} from './seed-indexeddb';

const APP_URL = 'http://127.0.0.1:4200';
const TASK_ID = 'code-a';

async function findTaskNode(page: Page, taskId: string): Promise<{ left: number; top: number } | null> {
  return page.evaluate((id) => {
    const node = document.querySelector(`.map-node[data-node-id="${id}"]`) as HTMLElement | null;
    return node
      ? { left: parseFloat(node.style.left || '0'), top: parseFloat(node.style.top || '0') }
      : null;
  }, taskId);
}

let devServer: ChildProcess | null = null;

/** Self-contained for Puppeteer serialization (no closed-over imports). */
async function seedBattleplanIndexedDb(payload: BrowserSeedPayload): Promise<void> {
  const openDb = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
    const request = indexedDB.open('battleplan', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'project_id' });
      }
      if (!db.objectStoreNames.contains('tasks')) {
        const tasks = db.createObjectStore('tasks', { keyPath: 'task_id' });
        tasks.createIndex('project_id', 'project_id', { unique: false });
      }
      if (!db.objectStoreNames.contains('codeOutputs')) {
        db.createObjectStore('codeOutputs', { keyPath: 'task_id' });
      }
      if (!db.objectStoreNames.contains('researchOutputs')) {
        db.createObjectStore('researchOutputs', { keyPath: 'task_id' });
      }
      if (!db.objectStoreNames.contains('messages')) {
        const messages = db.createObjectStore('messages', { keyPath: 'message_id' });
        messages.createIndex('project_id', 'project_id', { unique: false });
        messages.createIndex('task_id', 'task_id', { unique: false });
      }
      if (!db.objectStoreNames.contains('artifacts')) {
        const artifacts = db.createObjectStore('artifacts', { keyPath: 'id' });
        artifacts.createIndex('owner', 'owner', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });

  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['projects', 'tasks'], 'readwrite');
    tx.objectStore('projects').put(payload.project);
    for (const task of payload.tasks) {
      tx.objectStore('tasks').put(task);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB seed failed'));
  });

  localStorage.setItem('battleplan-cursor-api-key', 'e2e-cursor-api-key');
  localStorage.setItem('battleplan-current-project', payload.project.project_id);
  localStorage.setItem('battleplan-open-project-ids', JSON.stringify([payload.project.project_id]));
}

async function readTaskPinFromIndexedDb(taskId: string): Promise<{ map_x?: number; map_y?: number } | null> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('battleplan', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['tasks'], 'readonly');
    const req = tx.objectStore('tasks').get(taskId);
    req.onsuccess = () => {
      const row = req.result as { map_x?: number; map_y?: number } | undefined;
      resolve(row ? { map_x: row.map_x, map_y: row.map_y } : null);
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'));
  });
}

async function startDevServer(): Promise<void> {
  devServer = spawn('npm', ['run', 'start'], {
    cwd: process.cwd(),
    stdio: 'pipe',
    env: { ...process.env, BROWSER: 'none' },
  });
  await waitOn({
    resources: ['http-get://127.0.0.1:4200'],
    timeout: 120_000,
    validateStatus: (status) => status >= 200 && status < 400,
  });
}

function stopDevServer(): void {
  if (!devServer) return;
  devServer.kill('SIGTERM');
  devServer = null;
}

async function openSeededMindmap(page: Page, payload: BrowserSeedPayload): Promise<void> {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(seedBattleplanIndexedDb, payload);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.map-stage .map-node', { timeout: 90_000 });
  await page.waitForFunction(() => {
    const nodes = Array.from(document.querySelectorAll('.map-stage .map-node')) as HTMLElement[];
    if (nodes.length < 3) return false;
    const xs = nodes.map((node) => parseFloat(node.style.left || '0'));
    const ys = nodes.map((node) => parseFloat(node.style.top || '0'));
    const uniq = new Set(xs.map((x, i) => `${Math.round(x)},${Math.round(ys[i])}`));
    return uniq.size >= 3;
  }, { timeout: 90_000 });
}

describe('angular mindmap e2e (puppeteer + IndexedDB)', () => {
  beforeAll(async () => {
    await startDevServer();
  }, 130_000);

  afterAll(() => {
    stopDevServer();
  });

  it('migrates legacy piled tasks away from the top-left cluster', async () => {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      await openSeededMindmap(page, mindmapBrowserSeedPayloadLegacy());
      const spread = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('.map-stage .map-node:not(.circle)')) as HTMLElement[];
        const xs = nodes.map((node) => parseFloat(node.style.left || '0'));
        const ys = nodes.map((node) => parseFloat(node.style.top || '0'));
        return {
          count: nodes.length,
          maxX: Math.max(...xs),
          maxY: Math.max(...ys),
          uniq: new Set(xs.map((x, i) => `${Math.round(x)},${Math.round(ys[i])}`)).size,
        };
      });
      expect(spread.count).toBeGreaterThanOrEqual(3);
      expect(spread.uniq).toBeGreaterThanOrEqual(3);
      expect(spread.maxX).toBeGreaterThan(1500);
      expect(spread.maxY).toBeGreaterThan(1500);
    } finally {
      await browser.close();
    }
  }, 120_000);

  it('persists a dragged task position after pointer release', async () => {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      await openSeededMindmap(page, mindmapBrowserSeedPayloadMigrated());

      await page.waitForFunction(
        (taskId) => Boolean(document.querySelector(`.map-node[data-node-id="${taskId}"]`)),
        { timeout: 60_000 },
        TASK_ID,
      );

      const storageStats = await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('battleplan', 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error ?? new Error('open failed'));
        });
        const project = await new Promise<{ map_x?: number; mindmap_placement_version?: number } | undefined>((resolve, reject) => {
          const tx = db.transaction(['projects'], 'readonly');
          const req = tx.objectStore('projects').get('mindmap-sample-project');
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const tasks = await new Promise<{ map_x?: number }[]>((resolve, reject) => {
          const tx = db.transaction(['tasks'], 'readonly');
          const req = tx.objectStore('tasks').getAll();
          req.onsuccess = () => resolve(req.result as { map_x?: number }[]);
          req.onerror = () => reject(req.error);
        });
        return {
          projectX: project?.map_x,
          version: project?.mindmap_placement_version,
          framed: tasks.filter((task) => (task.map_x ?? 0) > 3000).length,
          total: tasks.length,
        };
      });
      expect(storageStats.framed).toBeGreaterThanOrEqual(10);

      const before = await findTaskNode(page, TASK_ID);
      expect(before).toBeTruthy();

      const pinBefore = await page.evaluate(readTaskPinFromIndexedDb, TASK_ID);

      await page.evaluate((taskId) => {
        const node = document.querySelector(`.map-node[data-node-id="${taskId}"]`) as HTMLElement | null;
        node?.scrollIntoView({ block: 'center', inline: 'center' });
      }, TASK_ID);

      await page.evaluate((taskId) => {
        const node = document.querySelector(`.map-node[data-node-id="${taskId}"]`) as HTMLElement | null;
        if (!node) throw new Error('task node not found');
        const rect = node.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        node.dispatchEvent(new PointerEvent('pointerdown', {
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
            clientX: cx + 220 * step,
            clientY: cy + 140 * step,
            pointerId: 1,
            isPrimary: true,
            buttons: 1,
          }));
        }
        window.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true,
          clientX: cx + 220,
          clientY: cy + 140,
          pointerId: 1,
          isPrimary: true,
          buttons: 0,
        }));
      }, TASK_ID);

      await page.waitForFunction(
        (start) => {
          const node = document.querySelector(`.map-node[data-node-id="code-a"]`) as HTMLElement | null;
          if (!node) return false;
          const left = parseFloat(node.style.left || '0');
          const top = parseFloat(node.style.top || '0');
          return Math.hypot(left - start.left, top - start.top) > 60;
        },
        { timeout: 20_000 },
        before,
      );

      let pinAfter = await page.evaluate(readTaskPinFromIndexedDb, TASK_ID);
      for (let attempt = 0; attempt < 30; attempt += 1) {
        pinAfter = await page.evaluate(readTaskPinFromIndexedDb, TASK_ID);
        if (pinBefore?.map_x !== undefined && pinAfter?.map_x !== undefined
          && Math.hypot(pinAfter.map_x - pinBefore.map_x, (pinAfter.map_y ?? 0) - (pinBefore.map_y ?? 0)) > 50) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      expect(pinAfter?.map_x).toBeDefined();
      expect(pinAfter?.map_y).toBeDefined();
      expect(pinAfter!.map_x!).toBeGreaterThan(1500);
      expect(pinAfter!.map_y!).toBeGreaterThan(1500);
      if (pinBefore?.map_x !== undefined && pinBefore?.map_y !== undefined) {
        expect(Math.hypot((pinAfter?.map_x ?? 0) - pinBefore.map_x, (pinAfter?.map_y ?? 0) - pinBefore.map_y))
          .toBeGreaterThan(50);
      }

      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForSelector('.map-stage .map-node', { timeout: 60_000 });
      const reloadedDom = await findTaskNode(page, TASK_ID);
      const pinReloaded = await page.evaluate(readTaskPinFromIndexedDb, TASK_ID);
      expect(reloadedDom).toBeTruthy();
      expect(pinReloaded?.map_x).toBe(pinAfter?.map_x);
      expect(pinReloaded?.map_y).toBe(pinAfter?.map_y);
      const drift = Math.hypot(reloadedDom!.left - (pinReloaded?.map_x ?? 0), reloadedDom!.top - (pinReloaded?.map_y ?? 0));
      expect(drift, `pin=${JSON.stringify(pinReloaded)} dom=${JSON.stringify(reloadedDom)}`).toBeLessThan(8);
    } finally {
      await browser.close();
    }
  }, 150_000);
});