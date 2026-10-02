"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportProject = exportProject;
exports.importProject = importProject;
const node_fs_1 = __importDefault(require("node:fs"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const archiver_1 = __importDefault(require("archiver"));
const extract_zip_1 = __importDefault(require("extract-zip"));
const MANIFEST = 'battleplan.manifest.json';
async function exportProject(repo, projectId, destinationFile) {
    const project = await repo.getProject(projectId);
    if (!project)
        throw new Error('Project was not found.');
    const sourceDir = node_path_1.default.join(repo.root(), projectId);
    await promises_1.default.mkdir(node_path_1.default.dirname(destinationFile), { recursive: true });
    const manifest = {
        format: 'battleplan',
        version: 1,
        project_id: project.project_id,
        title: project.title,
        exported_at: new Date().toISOString(),
    };
    const staging = node_path_1.default.join(node_path_1.default.dirname(destinationFile), `.export-${projectId}-${process.pid}`);
    await promises_1.default.rm(staging, { recursive: true, force: true });
    await promises_1.default.cp(sourceDir, staging, { recursive: true });
    await promises_1.default.writeFile(node_path_1.default.join(staging, MANIFEST), JSON.stringify(manifest, null, 2));
    await zipDirectory(staging, destinationFile);
    await promises_1.default.rm(staging, { recursive: true, force: true });
}
async function importProject(repo, archivePath, overwrite) {
    const staging = node_path_1.default.join(repo.root(), `.import-${process.pid}-${Date.now()}`);
    await promises_1.default.mkdir(staging, { recursive: true });
    try {
        await (0, extract_zip_1.default)(archivePath, { dir: staging });
        const manifestPath = node_path_1.default.join(staging, MANIFEST);
        const manifestRaw = await promises_1.default.readFile(manifestPath, 'utf8');
        const manifest = JSON.parse(manifestRaw);
        if (manifest.format !== 'battleplan')
            throw new Error('This file is not a battleplan archive.');
        const projectId = manifest.project_id;
        const targetDir = node_path_1.default.join(repo.root(), projectId);
        const exists = node_fs_1.default.existsSync(node_path_1.default.join(targetDir, 'project_config.json'));
        if (exists && !overwrite)
            throw new Error('PROJECT_EXISTS');
        if (exists)
            await promises_1.default.rm(targetDir, { recursive: true, force: true });
        await promises_1.default.mkdir(targetDir, { recursive: true });
        const entries = await promises_1.default.readdir(staging, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name === MANIFEST)
                continue;
            await promises_1.default.cp(node_path_1.default.join(staging, entry.name), node_path_1.default.join(targetDir, entry.name), { recursive: true });
        }
        const project = await repo.getProject(projectId);
        if (!project)
            throw new Error('Imported project could not be loaded.');
        return project;
    }
    finally {
        await promises_1.default.rm(staging, { recursive: true, force: true });
    }
}
function zipDirectory(sourceDir, destinationFile) {
    return new Promise((resolve, reject) => {
        const output = node_fs_1.default.createWriteStream(destinationFile);
        const archive = (0, archiver_1.default)('zip', { zlib: { level: 9 } });
        output.on('close', () => resolve());
        archive.on('error', (error) => reject(error));
        archive.pipe(output);
        archive.directory(sourceDir, false);
        void archive.finalize();
    });
}
