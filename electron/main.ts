import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildApplicationMenu, rebuildApplicationMenu, setExportProjectEnabled, setSaveEnabled } from './application-menu';
import { readJsonFile } from './atomic-write';
import { exportProject, importProject } from './battleplan-archive';
import type { AppConfigDocument } from './document-types';
import { runAgentConnectionInMain } from './agent-connection';
import { FileRepository } from './file-repository';
import { downloadReleaseAsset, installDownloadedRelease } from './release-installer';
import {
  BATTLEPLAN_RELEASE_REPO,
  githubAuthHeaders,
  isNewerVersion,
  latestProductionRelease,
  normalizeVersion,
  selectInstallerAsset,
  type GithubRelease,
  type GithubReleaseAsset,
} from './desktop-release-update';
import type {
  ChatArtifact,
  ChatMessage,
  Project,
  ProjectTask,
  TaskCodeOutput,
  TaskResearchOutput,
} from '../src/app/core/models';

const GITHUB_OWNER = BATTLEPLAN_RELEASE_REPO.owner;
const GITHUB_REPO = BATTLEPLAN_RELEASE_REPO.repo;

let mainWindow: BrowserWindow | null = null;
let repository: FileRepository | null = null;
let pendingRelease: { version: string; asset: GithubReleaseAsset } | null = null;

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
    'repo:listPendingChanges': (projectId) => repo().listPendingChanges(projectId as string),
    'repo:savePendingChanges': async (projectId, changes) => {
      await repo().savePendingChanges(projectId as string, changes as import('../src/app/core/models').PendingChange[]);
      return { ok: true };
    },
    'repo:listProjectAgents': (projectId) => repo().listProjectAgents(projectId as string),
    'repo:saveProjectAgents': async (projectId, agents) => {
      await repo().saveProjectAgents(
        projectId as string,
        agents as import('../src/app/core/models').ProjectAgent[],
      );
      return { ok: true };
    },
    'repo:getAgentUsageLedger': (projectId) => repo().getAgentUsageLedger(projectId as string),
    'repo:saveAgentUsageLedger': async (projectId, ledger) => {
      await repo().saveAgentUsageLedger(
        projectId as string,
        ledger as Record<string, import('../src/app/core/models').AgentUsageLedger>,
      );
      return { ok: true };
    },
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
    'update:install': async () => installPendingRelease(),
    'update:check': async () => checkForUpdatesFromGitHub(true),
    'shell:openExternal': async (url) => {
      await shell.openExternal(url as string);
      return { ok: true };
    },
    'agent:testConnection': async (params) =>
      runAgentConnectionInMain(params as import('../src/app/core/agent-connection').AgentConnectionInput),
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
    'menu:rebuild': async (payload) => {
      const data = payload as {
        projects?: Array<{ id: string; title: string }>;
        themeId?: string;
      };
      rebuildApplicationMenu(
        () => mainWindow,
        data.projects ?? [],
        data.themeId ?? 'harbor',
      );
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

const MISSING_GITHUB_PAT_MESSAGE = 'Add a GitHub personal access token under File → GitHub Token (Updates).';

async function readGithubPatFromConfig(): Promise<string | null> {
  const config = await repo().readAppConfig();
  const token = config.github_pat?.trim();
  return token || null;
}

async function requireGithubPat(): Promise<string> {
  const token = await readGithubPatFromConfig();
  if (!token) throw new Error(MISSING_GITHUB_PAT_MESSAGE);
  return token;
}

async function fetchGithubReleases(token: string): Promise<GithubRelease[]> {
  const response = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=100`, {
    headers: githubAuthHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`Could not read GitHub releases (${response.status}).`);
  }
  return await response.json() as GithubRelease[];
}

function notifyUpdateAvailable(release: GithubRelease, version: string, asset: GithubReleaseAsset): void {
  pendingRelease = { version, asset };
  mainWindow?.webContents.send('update:available', {
    version,
    releaseNotes: release.body ?? 'A newer Battleplan release is available.',
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
  try {
    const token = await readGithubPatFromConfig();
    if (!token) {
      if (notifyWhenCurrent) {
        return { ok: false, message: MISSING_GITHUB_PAT_MESSAGE };
      }
      return { ok: true, upToDate: true };
    }
    const current = normalizeVersion(app.getVersion());
    const latestRelease = latestProductionRelease(await fetchGithubReleases(token));
    if (!latestRelease) return { ok: false, message: 'Could not read the latest GitHub release.' };
    const latest = normalizeVersion(latestRelease.tag_name);
    const asset = selectInstallerAsset(latestRelease.assets, process.platform);
    if (!asset) {
      return { ok: false, message: `Release ${latest} has no installer for ${process.platform}.` };
    }
    if (!isNewerVersion(latest, current)) {
      pendingRelease = null;
      if (notifyWhenCurrent) {
        mainWindow?.webContents.send('update:status', { upToDate: true, current, latest });
      }
      return { ok: true, upToDate: true, current, latest };
    }
    pendingRelease = { version: latest, asset };
    notifyUpdateAvailable(latestRelease, latest, asset);
    return { ok: true, upToDate: false, current, latest };
  } catch (error) {
    console.error('Could not check for updates', error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Update check failed.',
    };
  }
}

async function installPendingRelease(): Promise<{ ok: boolean; message?: string }> {
  if (!pendingRelease) return { ok: false, message: 'No update is ready to install.' };
  try {
    const token = await requireGithubPat();
    const destination = path.join(app.getPath('temp'), pendingRelease.asset.name);
    await downloadReleaseAsset({
      assetApiUrl: pendingRelease.asset.url,
      token,
      destinationPath: destination,
    });
    await installDownloadedRelease(destination, process.platform);
    if (process.platform === 'win32' || process.platform === 'linux') {
      app.quit();
    }
    return { ok: true };
  } catch (error) {
    console.error('Could not install update', error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Update install failed.',
    };
  }
}

async function checkForUpdatesOnStartup(): Promise<void> {
  try {
    await checkForUpdatesFromGitHub(false);
  } catch (error) {
    console.warn('Startup update check skipped', error);
  }
}

app.whenReady().then(async () => {
  registerRepositoryHandlers();
  buildApplicationMenu(() => mainWindow);
  createWindow();
  void checkForUpdatesOnStartup();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
