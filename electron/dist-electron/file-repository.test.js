"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const vitest_1 = require("vitest");
const file_repository_1 = require("./file-repository");
const tempDirs = [];
function project(id) {
    return {
        project_id: id,
        title: id,
        initial_prompt: 'prompt',
        cursor_chat_link: 'https://cursor.com/agents/a',
        created_at: '2026-10-02T00:00:00.000Z',
        updated_at: '2026-10-02T00:00:00.000Z',
    };
}
function task(id, projectId) {
    return {
        task_id: id,
        project_id: projectId,
        title: id,
        prompt: 'do the work',
        dependencies: [],
        status: 'TODO',
        output_type: 'code',
        order: 0,
        created_at: '2026-10-02T00:00:00.000Z',
        updated_at: '2026-10-02T00:00:00.000Z',
    };
}
async function makeRepo() {
    const dir = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), 'battleplan-'));
    tempDirs.push(dir);
    return new file_repository_1.FileRepository(dir);
}
(0, vitest_1.afterEach)(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => promises_1.default.rm(dir, { recursive: true, force: true })));
});
(0, vitest_1.describe)('FileRepository', () => {
    (0, vitest_1.it)('stores projects, tasks, messages, and artifacts, then cascades a project delete', async () => {
        const repo = await makeRepo();
        await repo.saveProject(project('p1'));
        await repo.saveTask(task('t1', 'p1'));
        const message = {
            message_id: 'm1',
            scope: 'project',
            project_id: 'p1',
            role: 'user',
            content: 'hello',
            created_at: '2026-10-02T00:00:01.000Z',
        };
        await repo.saveMessage(message);
        const artifact = {
            scope: 'project',
            project_id: 'p1',
            path: 'artifacts/plan.md',
            name: 'plan.md',
            size_bytes: 12,
            updated_at: '2026-10-02T00:00:02.000Z',
            content_type: 'text',
            text: '# Plan',
        };
        await repo.saveArtifact(artifact);
        (0, vitest_1.expect)((await repo.listProjects()).map((item) => item.project_id)).toEqual(['p1']);
        (0, vitest_1.expect)((await repo.listTasks('p1')).map((item) => item.task_id)).toEqual(['t1']);
        (0, vitest_1.expect)(await repo.listProjectMessages('p1')).toHaveLength(1);
        (0, vitest_1.expect)((await repo.listArtifacts('project', 'p1'))[0]?.text).toBe('# Plan');
        await repo.deleteProject('p1');
        (0, vitest_1.expect)(await repo.listProjects()).toEqual([]);
        (0, vitest_1.expect)(await repo.listTasks('p1')).toEqual([]);
        (0, vitest_1.expect)(await repo.listProjectMessages('p1')).toEqual([]);
        (0, vitest_1.expect)(await repo.listArtifacts('project', 'p1')).toEqual([]);
    });
    (0, vitest_1.it)('writes app config atomically', async () => {
        const repo = await makeRepo();
        const saved = await repo.writeAppConfig({ theme: 'dusk', pane_width: 500, current_project_id: 'p1' });
        (0, vitest_1.expect)(saved.theme).toBe('dusk');
        (0, vitest_1.expect)((await repo.readAppConfig()).pane_width).toBe(500);
    });
});
