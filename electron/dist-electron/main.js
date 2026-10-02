"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const electron_updater_1 = require("electron-updater");
const node_path_1 = __importDefault(require("node:path"));
const node_url_1 = require("node:url");
const atomic_write_1 = require("./atomic-write");
const battleplan_archive_1 = require("./battleplan-archive");
const file_repository_1 = require("./file-repository");
const GITHUB_OWNER = 'coin-catcher';
const GITHUB_REPO = 'battleplan';
let mainWindow = null;
let repository = null;
let pendingUpdateVersion = null;
function dataRoot() {
    return node_path_1.default.join(electron_1.app.getPath('userData'), 'projects');
}
function repo() {
    if (!repository)
        repository = new file_repository_1.FileRepository(dataRoot());
    return repository;
}
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 960,
        minHeight: 640,
        webPreferences: {
            preload: node_path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });
    const devUrl = process.env['BATTLEPLAN_DEV_SERVER_URL'];
    if (devUrl) {
        void mainWindow.loadURL(devUrl);
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
    else {
        void mainWindow.loadFile(node_path_1.default.join(__dirname, '../dist/frontend/browser/index.html'));
    }
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
function registerRepositoryHandlers() {
    const handlers = {
        'repo:saveProject': (project) => repo().saveProject(project),
        'repo:getProject': (projectId) => repo().getProject(projectId),
        'repo:listProjects': () => repo().listProjects(),
        'repo:deleteProject': (projectId) => repo().deleteProject(projectId),
        'repo:saveTask': (task) => repo().saveTask(task),
        'repo:saveTasks': (tasks) => repo().saveTasks(tasks),
        'repo:getTask': (taskId) => repo().getTask(taskId),
        'repo:listTasks': (projectId) => repo().listTasks(projectId),
        'repo:deleteTask': (taskId) => repo().deleteTask(taskId),
        'repo:getCodeOutput': (taskId) => repo().getCodeOutput(taskId),
        'repo:saveCodeOutput': (output) => repo().saveCodeOutput(output),
        'repo:getResearchOutput': (taskId) => repo().getResearchOutput(taskId),
        'repo:saveResearchOutput': (output) => repo().saveResearchOutput(output),
        'repo:listProjectMessages': (projectId) => repo().listProjectMessages(projectId),
        'repo:listTaskMessages': (taskId) => repo().listTaskMessages(taskId),
        'repo:saveMessage': (message) => repo().saveMessage(message),
        'repo:listArtifacts': async (scope, ownerId) => enrichArtifacts(scope, ownerId),
        'repo:saveArtifact': (artifact) => repo().saveArtifact(artifact),
        'config:read': () => repo().readAppConfig(),
        'config:write': (patch) => repo().writeAppConfig(patch),
        'project:export': async (projectId) => {
            const project = await repo().getProject(projectId);
            if (!project)
                throw new Error('Project was not found.');
            const result = await electron_1.dialog.showSaveDialog(mainWindow, {
                title: 'Export battleplan project',
                defaultPath: `${sanitizeFilename(project.title)}.battleplan`,
                filters: [{ name: 'Battleplan archive', extensions: ['battleplan'] }],
            });
            if (result.canceled || !result.filePath)
                return { canceled: true };
            const filePath = result.filePath.endsWith('.battleplan') ? result.filePath : `${result.filePath}.battleplan`;
            await (0, battleplan_archive_1.exportProject)(repo(), project.project_id, filePath);
            return { canceled: false, filePath };
        },
        'project:import': async (overwrite) => {
            const picked = await electron_1.dialog.showOpenDialog(mainWindow, {
                title: 'Import battleplan project',
                filters: [{ name: 'Battleplan archive', extensions: ['battleplan'] }],
                properties: ['openFile'],
            });
            if (picked.canceled || !picked.filePaths[0])
                return { canceled: true };
            try {
                const project = await (0, battleplan_archive_1.importProject)(repo(), picked.filePaths[0], Boolean(overwrite));
                return { canceled: false, project };
            }
            catch (error) {
                if (error instanceof Error && error.message === 'PROJECT_EXISTS') {
                    return { canceled: false, exists: true };
                }
                throw error;
            }
        },
        'update:install': async () => {
            if (!pendingUpdateVersion)
                return { ok: false };
            await electron_updater_1.autoUpdater.downloadUpdate();
            electron_updater_1.autoUpdater.quitAndInstall();
            return { ok: true };
        },
        'shell:openExternal': (url) => {
            void electron_1.shell.openExternal(url);
            return { ok: true };
        },
    };
    for (const [channel, handler] of Object.entries(handlers)) {
        electron_1.ipcMain.handle(channel, (_event, ...args) => handler(...args));
    }
}
async function enrichArtifacts(scope, ownerId) {
    const store = repo();
    const projectId = scope === 'project' ? ownerId : (await store.getTask(ownerId))?.project_id;
    if (!projectId)
        return store.listArtifacts(scope, ownerId);
    const rawPath = scope === 'project'
        ? node_path_1.default.join(store.root(), projectId, 'project_config.json')
        : node_path_1.default.join(store.root(), projectId, ownerId, 'task_config.json');
    const doc = await (0, atomic_write_1.readJsonFile)(rawPath);
    const artifacts = doc?.artifacts ?? [];
    return artifacts.map((stored) => {
        const { local_file, ...rest } = stored;
        const artifact = { ...rest };
        if (local_file) {
            const filePath = store.artifactFilePath(scope, projectId, ownerId, local_file);
            artifact.url = (0, node_url_1.pathToFileURL)(filePath).href;
        }
        return artifact;
    }).sort((left, right) => left.updated_at.localeCompare(right.updated_at));
}
function sanitizeFilename(name) {
    return name.replace(/[^\w.\- ]+/g, '_').trim() || 'battleplan-project';
}
function configureAutoUpdater() {
    electron_updater_1.autoUpdater.autoDownload = false;
    electron_updater_1.autoUpdater.setFeedURL({
        provider: 'github',
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
    });
    electron_updater_1.autoUpdater.on('update-available', (info) => {
        pendingUpdateVersion = info.version ?? null;
        mainWindow?.webContents.send('update:available', {
            version: info.version,
            releaseNotes: info.releaseNotes,
        });
    });
    electron_updater_1.autoUpdater.on('update-not-available', () => {
        pendingUpdateVersion = null;
    });
    electron_updater_1.autoUpdater.on('error', (error) => {
        console.error('Auto-update error', error);
    });
}
async function checkForUpdatesOnStartup() {
    if (!electron_1.app.isPackaged)
        return;
    try {
        await electron_updater_1.autoUpdater.checkForUpdates();
    }
    catch (error) {
        console.error('Could not check for updates', error);
    }
}
electron_1.app.whenReady().then(async () => {
    registerRepositoryHandlers();
    configureAutoUpdater();
    createWindow();
    await checkForUpdatesOnStartup();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
