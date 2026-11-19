import type { Page } from '@playwright/test';
import type { BrowserSeedPayload } from '../../e2e/seed-indexeddb';

const CURRENT_PROJECT_KEY = 'battleplan-current-project';
const OPEN_PROJECTS_KEY = 'battleplan-open-project-ids';

export async function seedBattleplanInBrowser(page: Page, payload: BrowserSeedPayload): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('battleplan-cursor-api-key', 'e2e-cursor-api-key');
  });
  await page.goto('/');
  await page.evaluate(async (data) => {
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
      tx.objectStore('projects').put(data.project);
      for (const task of data.tasks) {
        tx.objectStore('tasks').put(task);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB seed failed'));
    });

    localStorage.setItem('battleplan-current-project', data.project.project_id);
    localStorage.setItem('battleplan-open-project-ids', JSON.stringify([data.project.project_id]));
  }, payload);
  await page.reload({ waitUntil: 'networkidle' });
}

export async function readTaskPin(page: Page, taskId: string): Promise<{ map_x?: number; map_y?: number } | null> {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('battleplan', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('open failed'));
    });
    return new Promise<{ map_x?: number; map_y?: number } | null>((resolve, reject) => {
      const tx = db.transaction(['tasks'], 'readonly');
      const req = tx.objectStore('tasks').get(id);
      req.onsuccess = () => {
        const row = req.result as { map_x?: number; map_y?: number } | undefined;
        resolve(row ? { map_x: row.map_x, map_y: row.map_y } : null);
      };
      req.onerror = () => reject(req.error);
    });
  }, taskId);
}

export async function taskNodePosition(page: Page, taskId: string): Promise<{ left: number; top: number } | null> {
  const locator = page.locator(`.map-node[data-node-id="${taskId}"]`);
  await locator.waitFor({ state: 'visible', timeout: 60_000 });
  return locator.evaluate((node) => ({
    left: parseFloat((node as HTMLElement).style.left || '0'),
    top: parseFloat((node as HTMLElement).style.top || '0'),
  }));
}