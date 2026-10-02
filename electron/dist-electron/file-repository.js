"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileRepository = void 0;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const atomic_write_1 = require("./atomic-write");
const document_types_1 = require("./document-types");
const PROJECT_FILE = 'project_config.json';
const TASK_FILE = 'task_config.json';
const APP_CONFIG_FILE = 'app_config.json';
class FileRepository {
    rootDir;
    constructor(rootDir) {
        this.rootDir = rootDir;
    }
    root() {
        return this.rootDir;
    }
    async readAppConfig() {
        const stored = await (0, atomic_write_1.readJsonFile)(this.appConfigPath());
        return stored ? { ...document_types_1.DEFAULT_APP_CONFIG, ...stored } : { ...document_types_1.DEFAULT_APP_CONFIG };
    }
    async writeAppConfig(patch) {
        const next = { ...await this.readAppConfig(), ...patch };
        await (0, atomic_write_1.writeFileAtomic)(this.appConfigPath(), JSON.stringify(next, null, 2));
        return next;
    }
    async saveProject(project) {
        const doc = await this.readProjectDocument(project.project_id);
        const next = {
            project,
            messages: doc?.messages ?? [],
            artifacts: doc?.artifacts ?? [],
        };
        await this.writeProjectDocument(project.project_id, next);
    }
    async getProject(projectId) {
        const doc = await this.readProjectDocument(projectId);
        return doc?.project ?? null;
    }
    async listProjects() {
        const entries = await this.safeReadDir(this.rootDir);
        const projects = [];
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            const doc = await this.readProjectDocument(entry.name);
            if (doc?.project)
                projects.push(doc.project);
        }
        return projects.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
    }
    async deleteProject(projectId) {
        await promises_1.default.rm(this.projectDir(projectId), { recursive: true, force: true });
    }
    async saveTask(task) {
        const doc = await this.readTaskDocument(task.project_id, task.task_id);
        const next = {
            task,
            messages: doc?.messages ?? [],
            code_output: doc?.code_output ?? null,
            research_output: doc?.research_output ?? null,
            artifacts: doc?.artifacts ?? [],
        };
        await this.writeTaskDocument(task.project_id, task.task_id, next);
    }
    async saveTasks(tasks) {
        for (const task of tasks)
            await this.saveTask(task);
    }
    async getTask(taskId) {
        const located = await this.locateTask(taskId);
        return located?.doc.task ?? null;
    }
    async listTasks(projectId) {
        const projectPath = this.projectDir(projectId);
        const entries = await this.safeReadDir(projectPath);
        const tasks = [];
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            const doc = await this.readTaskDocument(projectId, entry.name);
            if (doc?.task)
                tasks.push(doc.task);
        }
        return tasks.sort((left, right) => left.order - right.order || left.created_at.localeCompare(right.created_at));
    }
    async deleteTask(taskId) {
        const located = await this.locateTask(taskId);
        if (!located)
            return;
        await promises_1.default.rm(this.taskDir(located.projectId, taskId), { recursive: true, force: true });
    }
    async getCodeOutput(taskId) {
        const located = await this.locateTask(taskId);
        return located?.doc.code_output ?? null;
    }
    async saveCodeOutput(output) {
        const located = await this.requireTask(output.task_id);
        const next = { ...located.doc, code_output: output };
        await this.writeTaskDocument(located.projectId, output.task_id, next);
    }
    async getResearchOutput(taskId) {
        const located = await this.locateTask(taskId);
        return located?.doc.research_output ?? null;
    }
    async saveResearchOutput(output) {
        const located = await this.requireTask(output.task_id);
        const next = { ...located.doc, research_output: output };
        await this.writeTaskDocument(located.projectId, output.task_id, next);
    }
    async listProjectMessages(projectId) {
        const doc = await this.readProjectDocument(projectId);
        return (doc?.messages ?? []).filter((message) => message.scope === 'project').sort(byCreated);
    }
    async listTaskMessages(taskId) {
        const located = await this.locateTask(taskId);
        return (located?.doc.messages ?? []).filter((message) => message.scope === 'task').sort(byCreated);
    }
    async saveMessage(message) {
        if (message.scope === 'project') {
            const doc = await this.requireProjectDocument(message.project_id);
            const messages = upsertById(doc.messages, message, 'message_id');
            await this.writeProjectDocument(message.project_id, { ...doc, messages });
            return;
        }
        const taskId = message.task_id;
        if (!taskId)
            throw new Error('task messages require task_id.');
        const located = await this.requireTask(taskId);
        const messages = upsertById(located.doc.messages, message, 'message_id');
        await this.writeTaskDocument(located.projectId, taskId, { ...located.doc, messages });
    }
    async listArtifacts(scope, ownerId) {
        if (scope === 'project') {
            const doc = await this.readProjectDocument(ownerId);
            return (doc?.artifacts ?? []).map(stripStoredArtifact).sort((left, right) => left.updated_at.localeCompare(right.updated_at));
        }
        const located = await this.locateTask(ownerId);
        return (located?.doc.artifacts ?? []).map(stripStoredArtifact).sort((left, right) => left.updated_at.localeCompare(right.updated_at));
    }
    async saveArtifact(artifact) {
        const stored = await this.persistBinaryArtifact(artifact);
        if (artifact.scope === 'project') {
            const doc = await this.requireProjectDocument(artifact.project_id);
            const artifacts = upsertArtifact(doc.artifacts, stored);
            await this.writeProjectDocument(artifact.project_id, { ...doc, artifacts });
            return;
        }
        const taskId = artifact.task_id;
        if (!taskId)
            throw new Error('task artifacts require task_id.');
        const located = await this.requireTask(taskId);
        const artifacts = upsertArtifact(located.doc.artifacts, stored);
        await this.writeTaskDocument(located.projectId, taskId, { ...located.doc, artifacts });
    }
    artifactFilePath(scope, projectId, ownerId, localFile) {
        return scope === 'project'
            ? node_path_1.default.join(this.projectDir(projectId), localFile)
            : node_path_1.default.join(this.taskDir(projectId, ownerId), localFile);
    }
    resolveArtifactPath(scope, projectId, ownerId, stored) {
        if (!stored.local_file)
            return null;
        return this.artifactFilePath(scope, projectId, ownerId, stored.local_file);
    }
    async persistBinaryArtifact(artifact) {
        const stored = { ...artifact };
        if (artifact.content_type === 'text') {
            delete stored.local_file;
            return stored;
        }
        const ownerId = artifact.scope === 'task' ? artifact.task_id ?? '' : artifact.project_id;
        const baseDir = artifact.scope === 'task'
            ? this.taskDir(artifact.project_id, ownerId)
            : this.projectDir(artifact.project_id);
        await promises_1.default.mkdir(baseDir, { recursive: true });
        const fileName = sanitizeFileName(artifact.name || node_path_1.default.basename(artifact.path));
        const filePath = node_path_1.default.join(baseDir, fileName);
        if (artifact.url?.startsWith('http')) {
            const response = await fetch(artifact.url);
            if (!response.ok)
                throw new Error(`Could not download artifact ${artifact.path}.`);
            const buffer = Buffer.from(await response.arrayBuffer());
            await (0, atomic_write_1.writeFileAtomic)(filePath, buffer);
            stored.local_file = fileName;
            stored.size_bytes = buffer.length;
        }
        else {
            const existing = await this.findStoredArtifact(artifact);
            if (existing?.local_file)
                stored.local_file = existing.local_file;
        }
        delete stored.url;
        delete stored.url_expires_at;
        return stored;
    }
    async findStoredArtifact(artifact) {
        if (artifact.scope === 'project') {
            const doc = await this.readProjectDocument(artifact.project_id);
            return doc?.artifacts.find((item) => item.path === artifact.path);
        }
        const taskId = artifact.task_id;
        if (!taskId)
            return undefined;
        const located = await this.locateTask(taskId);
        return located?.doc.artifacts.find((item) => item.path === artifact.path);
    }
    appConfigPath() {
        return node_path_1.default.join(this.rootDir, APP_CONFIG_FILE);
    }
    projectDir(projectId) {
        return node_path_1.default.join(this.rootDir, projectId);
    }
    taskDir(projectId, taskId) {
        return node_path_1.default.join(this.projectDir(projectId), taskId);
    }
    projectConfigPath(projectId) {
        return node_path_1.default.join(this.projectDir(projectId), PROJECT_FILE);
    }
    taskConfigPath(projectId, taskId) {
        return node_path_1.default.join(this.taskDir(projectId, taskId), TASK_FILE);
    }
    async readProjectDocument(projectId) {
        return (0, atomic_write_1.readJsonFile)(this.projectConfigPath(projectId));
    }
    async writeProjectDocument(projectId, doc) {
        await promises_1.default.mkdir(this.projectDir(projectId), { recursive: true });
        await (0, atomic_write_1.writeFileAtomic)(this.projectConfigPath(projectId), JSON.stringify(doc, null, 2));
    }
    async readTaskDocument(projectId, taskId) {
        return (0, atomic_write_1.readJsonFile)(this.taskConfigPath(projectId, taskId));
    }
    async writeTaskDocument(projectId, taskId, doc) {
        await promises_1.default.mkdir(this.taskDir(projectId, taskId), { recursive: true });
        await (0, atomic_write_1.writeFileAtomic)(this.taskConfigPath(projectId, taskId), JSON.stringify(doc, null, 2));
    }
    async requireProjectDocument(projectId) {
        const existing = await this.readProjectDocument(projectId);
        if (existing)
            return existing;
        throw new Error(`Project ${projectId} was not found.`);
    }
    async requireTask(taskId) {
        const located = await this.locateTask(taskId);
        if (!located)
            throw new Error(`Task ${taskId} was not found.`);
        return located;
    }
    async locateTask(taskId) {
        const projects = await this.safeReadDir(this.rootDir);
        for (const projectEntry of projects) {
            if (!projectEntry.isDirectory())
                continue;
            const projectId = projectEntry.name;
            if (projectId === APP_CONFIG_FILE)
                continue;
            const doc = await this.readTaskDocument(projectId, taskId);
            if (doc?.task)
                return { projectId, doc };
        }
        return null;
    }
    async safeReadDir(dir) {
        try {
            return await promises_1.default.readdir(dir, { withFileTypes: true });
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return [];
            throw error;
        }
    }
}
exports.FileRepository = FileRepository;
function byCreated(left, right) {
    return left.created_at.localeCompare(right.created_at);
}
function upsertById(items, value, key) {
    const index = items.findIndex((item) => item[key] === value[key]);
    if (index === -1)
        return [...items, value];
    const next = [...items];
    next[index] = value;
    return next;
}
function upsertArtifact(items, value) {
    const index = items.findIndex((item) => item.scope === value.scope && item.path === value.path);
    if (index === -1)
        return [...items, value];
    const next = [...items];
    next[index] = value;
    return next;
}
function stripStoredArtifact(stored) {
    const { local_file: _local, ...artifact } = stored;
    return artifact;
}
function sanitizeFileName(name) {
    const cleaned = name.replace(/[^\w.\-()+ ]+/g, '_').trim();
    return cleaned || 'artifact.bin';
}
