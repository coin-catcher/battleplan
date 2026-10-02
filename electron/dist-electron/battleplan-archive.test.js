"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const vitest_1 = require("vitest");
const battleplan_archive_1 = require("./battleplan-archive");
const file_repository_1 = require("./file-repository");
const tempDirs = [];
function project(id) {
    return {
        project_id: id,
        title: 'Sample',
        initial_prompt: 'prompt',
        cursor_chat_link: 'https://cursor.com/agents/a',
        created_at: '2026-10-02T00:00:00.000Z',
        updated_at: '2026-10-02T00:00:00.000Z',
    };
}
async function makeRepo() {
    const root = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), 'battleplan-'));
    tempDirs.push(root);
    return { repo: new file_repository_1.FileRepository(root), root };
}
(0, vitest_1.afterEach)(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => promises_1.default.rm(dir, { recursive: true, force: true })));
});
(0, vitest_1.describe)('battleplan archive', () => {
    (0, vitest_1.it)('exports and imports a project archive', async () => {
        const { repo, root } = await makeRepo();
        await repo.saveProject(project('p1'));
        const archivePath = node_path_1.default.join(root, 'sample.battleplan');
        await (0, battleplan_archive_1.exportProject)(repo, 'p1', archivePath);
        const target = await makeRepo();
        const imported = await (0, battleplan_archive_1.importProject)(target.repo, archivePath, false);
        (0, vitest_1.expect)(imported.project_id).toBe('p1');
        (0, vitest_1.expect)((await target.repo.listProjects())).toHaveLength(1);
    });
    (0, vitest_1.it)('signals when a project already exists', async () => {
        const { repo, root } = await makeRepo();
        await repo.saveProject(project('p1'));
        const archivePath = node_path_1.default.join(root, 'sample.battleplan');
        await (0, battleplan_archive_1.exportProject)(repo, 'p1', archivePath);
        await (0, vitest_1.expect)((0, battleplan_archive_1.importProject)(repo, archivePath, false)).rejects.toThrow('PROJECT_EXISTS');
    });
});
