import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AgentUsageLedger,
  ChatArtifact,
  ChatMessage,
  PendingChange,
  Project,
  ProjectAgent,
  ProjectTask,
  TaskCodeOutput,
  TaskResearchOutput,
} from '../src/app/core/models';
import type { BattleplanRepository } from '../src/app/data/repository';
import { readJsonFile, writeFileAtomic } from './atomic-write';
import { normalizeProjectWorkspaceUiState, type ProjectWorkspaceUiState } from '../src/app/core/project-ui-state';
import type { AppConfigDocument, ProjectDocument, ProjectUiState, StoredArtifact, TaskDocument } from './document-types';
import { DEFAULT_APP_CONFIG } from './document-types';
import { assertBattleplanGitMirrorPath } from '../src/app/core/git-mirror-path';

const PROJECT_FILE = 'project_config.json';
const TASK_FILE = 'task_config.json';
const APP_CONFIG_FILE = 'app_config.json';

export class FileRepository implements BattleplanRepository {
  constructor(private readonly rootDir: string) {}

  root(): string {
    return this.rootDir;
  }

  async readAppConfig(): Promise<AppConfigDocument> {
    const stored = await readJsonFile<AppConfigDocument>(this.appConfigPath());
    return stored ? { ...DEFAULT_APP_CONFIG, ...stored } : { ...DEFAULT_APP_CONFIG };
  }

  async writeAppConfig(patch: Partial<AppConfigDocument>): Promise<AppConfigDocument> {
    const next = { ...await this.readAppConfig(), ...patch };
    await writeFileAtomic(this.appConfigPath(), JSON.stringify(next, null, 2));
    return next;
  }

  async saveProject(project: Project): Promise<void> {
    const doc = await this.readProjectDocument(project.project_id);
    const next: ProjectDocument = {
      project,
      messages: doc?.messages ?? [],
      artifacts: doc?.artifacts ?? [],
      pending_changes: doc?.pending_changes,
      agents: doc?.agents ?? [],
      agent_usage_ledger: doc?.agent_usage_ledger,
      ui: doc?.ui,
    };
    await this.writeProjectDocument(project.project_id, next);
  }

  async getProject(projectId: string): Promise<Project | null> {
    const doc = await this.readProjectDocument(projectId);
    return doc?.project ?? null;
  }

  async listProjects(): Promise<Project[]> {
    const entries = await this.safeReadDir(this.rootDir);
    const projects: Project[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const doc = await this.readProjectDocument(entry.name);
      if (doc?.project) projects.push(doc.project);
    }
    return projects.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  }

  async deleteProject(projectId: string): Promise<void> {
    await fs.rm(this.projectDir(projectId), { recursive: true, force: true });
  }

  async saveTask(task: ProjectTask): Promise<void> {
    const doc = await this.readTaskDocument(task.project_id, task.task_id);
    const next: TaskDocument = {
      task,
      messages: doc?.messages ?? [],
      code_output: doc?.code_output ?? null,
      research_output: doc?.research_output ?? null,
      artifacts: doc?.artifacts ?? [],
    };
    await this.writeTaskDocument(task.project_id, task.task_id, next);
  }

  async saveTasks(tasks: ProjectTask[]): Promise<void> {
    for (const task of tasks) await this.saveTask(task);
  }

  async getTask(taskId: string): Promise<ProjectTask | null> {
    const located = await this.locateTask(taskId);
    return located?.doc.task ?? null;
  }

  async listTasks(projectId: string): Promise<ProjectTask[]> {
    const projectPath = this.projectDir(projectId);
    const entries = await this.safeReadDir(projectPath);
    const tasks: ProjectTask[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const doc = await this.readTaskDocument(projectId, entry.name);
      if (doc?.task) tasks.push(doc.task);
    }
    return tasks.sort((left, right) => left.order - right.order || left.created_at.localeCompare(right.created_at));
  }

  async deleteTask(taskId: string): Promise<void> {
    const located = await this.locateTask(taskId);
    if (!located) return;
    await fs.rm(this.taskDir(located.projectId, taskId), { recursive: true, force: true });
  }

  async getCodeOutput(taskId: string): Promise<TaskCodeOutput | null> {
    const located = await this.locateTask(taskId);
    return located?.doc.code_output ?? null;
  }

  async saveCodeOutput(output: TaskCodeOutput): Promise<void> {
    const located = await this.requireTask(output.task_id);
    const next: TaskDocument = { ...located.doc, code_output: output };
    await this.writeTaskDocument(located.projectId, output.task_id, next);
  }

  async getResearchOutput(taskId: string): Promise<TaskResearchOutput | null> {
    const located = await this.locateTask(taskId);
    return located?.doc.research_output ?? null;
  }

  async saveResearchOutput(output: TaskResearchOutput): Promise<void> {
    const located = await this.requireTask(output.task_id);
    const next: TaskDocument = { ...located.doc, research_output: output };
    await this.writeTaskDocument(located.projectId, output.task_id, next);
  }

  async writeGitMirrorFile(projectId: string, gitRelativePath: string, content: string): Promise<void> {
    const relative = assertBattleplanGitMirrorPath(gitRelativePath);
    const filePath = path.join(this.projectDir(projectId), ...relative.split('/'));
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await writeFileAtomic(filePath, content);
  }

  async readGitMirrorFile(projectId: string, gitRelativePath: string): Promise<string | null> {
    const relative = assertBattleplanGitMirrorPath(gitRelativePath);
    const filePath = path.join(this.projectDir(projectId), ...relative.split('/'));
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch {
      return null;
    }
  }

  async listProjectMessages(projectId: string): Promise<ChatMessage[]> {
    const doc = await this.readProjectDocument(projectId);
    return (doc?.messages ?? []).filter((message) => message.scope === 'project').sort(byCreated);
  }

  async listPendingChanges(projectId: string): Promise<PendingChange[]> {
    const doc = await this.readProjectDocument(projectId);
    return doc?.pending_changes ?? [];
  }

  async savePendingChanges(projectId: string, changes: PendingChange[]): Promise<void> {
    const doc = await this.requireProjectDocument(projectId);
    await this.writeProjectDocument(projectId, { ...doc, pending_changes: changes });
  }

  async listProjectAgents(projectId: string): Promise<ProjectAgent[]> {
    const doc = await this.readProjectDocument(projectId);
    return doc?.agents ?? [];
  }

  async saveProjectAgents(projectId: string, agents: ProjectAgent[]): Promise<void> {
    const doc = await this.requireProjectDocument(projectId);
    await this.writeProjectDocument(projectId, { ...doc, agents });
  }

  async getAgentUsageLedger(projectId: string): Promise<Record<string, AgentUsageLedger>> {
    const doc = await this.readProjectDocument(projectId);
    return doc?.agent_usage_ledger ?? {};
  }

  async saveAgentUsageLedger(projectId: string, ledger: Record<string, AgentUsageLedger>): Promise<void> {
    const doc = await this.requireProjectDocument(projectId);
    await this.writeProjectDocument(projectId, { ...doc, agent_usage_ledger: ledger });
  }

  async getProjectUiState(projectId: string): Promise<ProjectWorkspaceUiState | null> {
    const doc = await this.readProjectDocument(projectId);
    return normalizeProjectWorkspaceUiState(doc?.ui ?? null);
  }

  async saveProjectUiState(projectId: string, state: ProjectWorkspaceUiState): Promise<void> {
    const normalized = normalizeProjectWorkspaceUiState(state);
    if (!normalized) return;
    const doc = await this.requireProjectDocument(projectId);
    const ui: ProjectUiState = {
      pane_width: normalized.pane_width,
      mindmap_zoom: normalized.mindmap_zoom,
      mindmap_origin_x: normalized.mindmap_origin_x,
      mindmap_origin_y: normalized.mindmap_origin_y,
    };
    await this.writeProjectDocument(projectId, { ...doc, ui });
  }

  async listTaskMessages(taskId: string): Promise<ChatMessage[]> {
    const located = await this.locateTask(taskId);
    return (located?.doc.messages ?? []).filter((message) => message.scope === 'task').sort(byCreated);
  }

  async saveMessage(message: ChatMessage): Promise<void> {
    if (message.scope === 'project') {
      const doc = await this.requireProjectDocument(message.project_id);
      const messages = upsertById(doc.messages, message, 'message_id');
      await this.writeProjectDocument(message.project_id, { ...doc, messages });
      return;
    }
    const taskId = message.task_id;
    if (!taskId) throw new Error('task messages require task_id.');
    const located = await this.requireTask(taskId);
    const messages = upsertById(located.doc.messages, message, 'message_id');
    await this.writeTaskDocument(located.projectId, taskId, { ...located.doc, messages });
  }

  async listArtifacts(scope: 'project' | 'task', ownerId: string): Promise<ChatArtifact[]> {
    if (scope === 'project') {
      const doc = await this.readProjectDocument(ownerId);
      return (doc?.artifacts ?? []).map(stripStoredArtifact).sort((left, right) => left.updated_at.localeCompare(right.updated_at));
    }
    const located = await this.locateTask(ownerId);
    return (located?.doc.artifacts ?? []).map(stripStoredArtifact).sort((left, right) => left.updated_at.localeCompare(right.updated_at));
  }

  async saveArtifact(artifact: ChatArtifact): Promise<void> {
    const stored = await this.persistBinaryArtifact(artifact);
    if (artifact.scope === 'project') {
      const doc = await this.requireProjectDocument(artifact.project_id);
      const artifacts = upsertArtifact(doc.artifacts, stored);
      await this.writeProjectDocument(artifact.project_id, { ...doc, artifacts });
      return;
    }
    const taskId = artifact.task_id;
    if (!taskId) throw new Error('task artifacts require task_id.');
    const located = await this.requireTask(taskId);
    const artifacts = upsertArtifact(located.doc.artifacts, stored);
    await this.writeTaskDocument(located.projectId, taskId, { ...located.doc, artifacts });
  }

  artifactFilePath(
    scope: 'project' | 'task',
    projectId: string,
    ownerId: string,
    localFile: string,
  ): string {
    return scope === 'project'
      ? path.join(this.projectDir(projectId), localFile)
      : path.join(this.taskDir(projectId, ownerId), localFile);
  }

  resolveArtifactPath(
    scope: 'project' | 'task',
    projectId: string,
    ownerId: string,
    stored: StoredArtifact,
  ): string | null {
    if (!stored.local_file) return null;
    return this.artifactFilePath(scope, projectId, ownerId, stored.local_file);
  }

  private async persistBinaryArtifact(artifact: ChatArtifact): Promise<StoredArtifact> {
    const stored: StoredArtifact = { ...artifact };
    if (artifact.content_type === 'text') {
      delete stored.local_file;
      return stored;
    }
    const ownerId = artifact.scope === 'task' ? artifact.task_id ?? '' : artifact.project_id;
    const baseDir = artifact.scope === 'task'
      ? this.taskDir(artifact.project_id, ownerId)
      : this.projectDir(artifact.project_id);
    await fs.mkdir(baseDir, { recursive: true });
    const fileName = sanitizeFileName(artifact.name || path.basename(artifact.path));
    const filePath = path.join(baseDir, fileName);
    if (artifact.url?.startsWith('http')) {
      const response = await fetch(artifact.url);
      if (!response.ok) throw new Error(`Could not download artifact ${artifact.path}.`);
      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFileAtomic(filePath, buffer);
      stored.local_file = fileName;
      stored.size_bytes = buffer.length;
    } else {
      const existing = await this.findStoredArtifact(artifact);
      if (existing?.local_file) stored.local_file = existing.local_file;
    }
    delete stored.url;
    delete stored.url_expires_at;
    return stored;
  }

  private async findStoredArtifact(artifact: ChatArtifact): Promise<StoredArtifact | undefined> {
    if (artifact.scope === 'project') {
      const doc = await this.readProjectDocument(artifact.project_id);
      return doc?.artifacts.find((item) => item.path === artifact.path);
    }
    const taskId = artifact.task_id;
    if (!taskId) return undefined;
    const located = await this.locateTask(taskId);
    return located?.doc.artifacts.find((item) => item.path === artifact.path);
  }

  private appConfigPath(): string {
    return path.join(this.rootDir, APP_CONFIG_FILE);
  }

  private projectDir(projectId: string): string {
    return path.join(this.rootDir, projectId);
  }

  private taskDir(projectId: string, taskId: string): string {
    return path.join(this.projectDir(projectId), taskId);
  }

  private projectConfigPath(projectId: string): string {
    return path.join(this.projectDir(projectId), PROJECT_FILE);
  }

  private taskConfigPath(projectId: string, taskId: string): string {
    return path.join(this.taskDir(projectId, taskId), TASK_FILE);
  }

  private async readProjectDocument(projectId: string): Promise<ProjectDocument | null> {
    return readJsonFile<ProjectDocument>(this.projectConfigPath(projectId));
  }

  private async writeProjectDocument(projectId: string, doc: ProjectDocument): Promise<void> {
    await fs.mkdir(this.projectDir(projectId), { recursive: true });
    await writeFileAtomic(this.projectConfigPath(projectId), JSON.stringify(doc, null, 2));
  }

  private async readTaskDocument(projectId: string, taskId: string): Promise<TaskDocument | null> {
    return readJsonFile<TaskDocument>(this.taskConfigPath(projectId, taskId));
  }

  private async writeTaskDocument(projectId: string, taskId: string, doc: TaskDocument): Promise<void> {
    await fs.mkdir(this.taskDir(projectId, taskId), { recursive: true });
    await writeFileAtomic(this.taskConfigPath(projectId, taskId), JSON.stringify(doc, null, 2));
  }

  private async requireProjectDocument(projectId: string): Promise<ProjectDocument> {
    const existing = await this.readProjectDocument(projectId);
    if (existing) return existing;
    throw new Error(`Project ${projectId} was not found.`);
  }

  private async requireTask(taskId: string): Promise<{ projectId: string; doc: TaskDocument }> {
    const located = await this.locateTask(taskId);
    if (!located) throw new Error(`Task ${taskId} was not found.`);
    return located;
  }

  private async locateTask(taskId: string): Promise<{ projectId: string; doc: TaskDocument } | null> {
    const projects = await this.safeReadDir(this.rootDir);
    for (const projectEntry of projects) {
      if (!projectEntry.isDirectory()) continue;
      const projectId = projectEntry.name;
      if (projectId === APP_CONFIG_FILE) continue;
      const doc = await this.readTaskDocument(projectId, taskId);
      if (doc?.task) return { projectId, doc };
    }
    return null;
  }

  private async safeReadDir(dir: string): Promise<import('node:fs').Dirent[]> {
    try {
      return await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
}

function byCreated(left: { created_at: string }, right: { created_at: string }): number {
  return left.created_at.localeCompare(right.created_at);
}

function upsertById<T>(items: T[], value: T, key: keyof T): T[] {
  const index = items.findIndex((item) => item[key] === value[key]);
  if (index === -1) return [...items, value];
  const next = [...items];
  next[index] = value;
  return next;
}

function upsertArtifact(items: StoredArtifact[], value: StoredArtifact): StoredArtifact[] {
  const index = items.findIndex((item) => item.scope === value.scope && item.path === value.path);
  if (index === -1) return [...items, value];
  const next = [...items];
  next[index] = value;
  return next;
}

function stripStoredArtifact(stored: StoredArtifact): ChatArtifact {
  const { local_file: _local, ...artifact } = stored;
  return artifact;
}

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^\w.\-()+ ]+/g, '_').trim();
  return cleaned || 'artifact.bin';
}
