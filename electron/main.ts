import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildApplicationMenu, setExportProjectEnabled, setSaveEnabled } from './application-menu';
import { readJsonFile } from './atomic-write';
import { exportProject, importProject } from './battleplan-archive';
import type { AppConfigDocument } from './document-types';
import { FileRepository } from './file-repository';
import type {
  ChatArtifact,
  ChatMessage,
  Project,
  ProjectTask,
  TaskCodeOutput,
  TaskResearchOutput,
} from '../src/app/core/models';

const GITHUB_OWNER = 'coin-catcher';
const GITHUB_REPO = 'battleplan';

let mainWindow: BrowserWindow | null = null;
let repository: FileRepository | null = null;
let pendingUpdateVersion: string | null = null;

function dataRoot(): string {
  return path.join(app.getPath('userData'), 'projects');
}

function repo(): FileRepository {
  if (!repository) repository = new FileRepository(dataRoot());
  return repository;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devUrl = process.env['BATTLEPLAN_DEV_SERVER_URL'];
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../../dist/frontend/browser/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerRepositoryHandlers(): void {
  const handlers: Record<string, (...args: unknown[]) => Promise<unknown>> = {
    'repo:saveProject': (project) => repo().saveProject(project as Project),
    'repo:getProject': (projectId) => repo().getProject(projectId as string),
    'repo:listProjects': () => repo().listProjects(),
    'repo:deleteProject': (projectId) => repo().deleteProject(projectId as string),
    'repo:saveTask': (task) => repo().saveTask(task as ProjectTask),
    'repo:saveTasks': (tasks) => repo().saveTasks(tasks as ProjectTask[]),
    'repo:getTask': (taskId) => repo().getTask(taskId as string),
    'repo:listTasks': (projectId) => repo().listTasks(projectId as string),
    'repo:deleteTask': (taskId) => repo().deleteTask(taskId as string),
    'repo:getCodeOutput': (taskId) => repo().getCodeOutput(taskId as string),
    'repo:saveCodeOutput': (output) => repo().saveCodeOutput(output as TaskCodeOutput),
    'repo:getResearchOutput': (taskId) => repo().getResearchOutput(taskId as string),
    'repo:saveResearchOutput': (output) => repo().saveResearchOutput(output as TaskResearchOutput),
    'repo:listProjectMessages': (projectId) => repo().listProjectMessages(projectId as string),
    'repo:listTaskMessages': (taskId) => repo().listTaskMessages(taskId as string),
    'repo:saveMessage': (message) => repo().saveMessage(message as ChatMessage),
    'repo:listArtifacts': async (scope, ownerId) => enrichArtifacts(scope as 'project' | 'task', ownerId as string),
    'repo:saveArtifact': (artifact) => repo().saveArtifact(artifact as ChatArtifact),
    'config:read': () => repo().readAppConfig(),
    'config:write': (patch) => repo().writeAppConfig(patch as Partial<AppConfigDocument>),
    'project:export': async (projectId) => {
      const project = await repo().getProject(projectId as string);
      if (!project) throw new Error('Project was not found.');
      const result = await dialog.showSaveDialog(mainWindow!, {
        title: 'Export battleplan project',
        defaultPath: `${sanitizeFilename(project.title)}.battleplan`,
        filters: [{ name: 'Battleplan archive', extensions: ['battleplan'] }],
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      const filePath = result.filePath.endsWith('.battleplan') ? result.filePath : `${result.filePath}.battleplan`;
      await exportProject(repo(), project.project_id, filePath);
      return { canceled: false, filePath };
    },
    'project:import': async (overwrite) => {
      const picked = await dialog.showOpenDialog(mainWindow!, {
        title: 'Import battleplan project',
        filters: [{ name: 'Battleplan archive', extensions: ['battleplan'] }],
        properties: ['openFile'],
      });
      if (picked.canceled || !picked.filePaths[0]) return { canceled: true };
      try {
        const project = await importProject(repo(), picked.filePaths[0], Boolean(overwrite));
        return { canceled: false, project };
      } catch (error) {
        if (error instanceof Error && error.message === 'PROJECT_EXISTS') {
          return { canceled: false, exists: true };
        }
        throw error;
      }
    },
    'update:install': async () => {
      if (!pendingUpdateVersion) return { ok: false };
      await autoUpdater.downloadUpdate();
      autoUpdater.quitAndInstall();
      return { ok: true };
    },
    'update:check': async () => checkForUpdatesFromGitHub(true),
    'shell:openExternal': async (url) => {
      await shell.openExternal(url as string);
      return { ok: true };
    },
    'menu:sync-state': async (state) => {
      const patch = state as { exportEnabled?: boolean; saveEnabled?: boolean };
      if (typeof patch.exportEnabled === 'boolean') {
        setExportProjectEnabled(patch.exportEnabled);
      }
      if (typeof patch.saveEnabled === 'boolean') {
        setSaveEnabled(patch.saveEnabled);
      }
      return { ok: true };
    },
  };

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_event, ...args) => handler(...args));
  }
}

async function enrichArtifacts(scope: 'project' | 'task', ownerId: string): Promise<ChatArtifact[]> {
  const store = repo();
  const projectId = scope === 'project' ? ownerId : (await store.getTask(ownerId))?.project_id;
  if (!projectId) return store.listArtifacts(scope, ownerId);
  const rawPath = scope === 'project'
    ? path.join(store.root(), projectId, 'project_config.json')
    : path.join(store.root(), projectId, ownerId, 'task_config.json');
  const doc = await readJsonFile<{ artifacts: Array<ChatArtifact & { local_file?: string }> }>(rawPath);
  const artifacts = doc?.artifacts ?? [];
  return artifacts.map((stored) => {
    const { local_file, ...rest } = stored;
    const artifact: ChatArtifact = { ...rest };
    if (local_file) {
      const filePath = store.artifactFilePath(scope, projectId, ownerId, local_file);
      artifact.url = pathToFileURL(filePath).href;
    }
    return artifact;
  }).sort((left, right) => left.updated_at.localeCompare(right.updated_at));
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\- ]+/g, '_').trim() || 'battleplan-project';
}

function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/i, '');
}

async function fetchLatestReleaseTag(): Promise<string | null> {
  const response = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'battleplan-desktop' },
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as { tag_name?: string };
  return payload.tag_name ? normalizeVersion(payload.tag_name) : null;
}

function configureAutoUpdater(): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
  });

  autoUpdater.on('update-available', (info) => {
    pendingUpdateVersion = info.version ? normalizeVersion(info.version) : pendingUpdateVersion;
    mainWindow?.webContents.send('update:available', {
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });

  autoUpdater.on('update-not-available', () => {
    pendingUpdateVersion = null;
  });

  autoUpdater.on('error', (error) => {
    console.error('Auto-update error', error);
    mainWindow?.webContents.send('update:error', {
      message: error instanceof Error ? error.message : 'Update check failed.',
    });
  });
}

async function checkForUpdatesFromGitHub(notifyWhenCurrent: boolean): Promise<{
  ok: boolean;
  upToDate?: boolean;
  current?: string;
  latest?: string;
  message?: string;
}> {
  if (!app.isPackaged) {
    return { ok: false, message: 'Updates are only available in the packaged desktop app.' };
  }
  const current = normalizeVersion(app.getVersion());
  const latest = await fetchLatestReleaseTag();
  if (!latest) return { ok: false, message: 'Could not read the latest GitHub release.' };
  if (latest === current) {
    if (notifyWhenCurrent) {
      mainWindow?.webContents.send('update:status', { upToDate: true, current, latest });
    }
    return { ok: true, upToDate: true, current, latest };
  }
  pendingUpdateVersion = latest;
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    console.error('Could not check for updates', error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Update check failed.',
    };
  }
  return { ok: true, upToDate: false, current, latest };
}

async function checkForUpdatesOnStartup(): Promise<void> {
  await checkForUpdatesFromGitHub(false);
}

app.whenReady().then(async () => {
  registerRepositoryHandlers();
  configureAutoUpdater();
  buildApplicationMenu(() => mainWindow);
  createWindow();
  await checkForUpdatesOnStartup();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
