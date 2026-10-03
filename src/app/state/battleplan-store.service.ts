import { Injectable, computed, inject, signal } from '@angular/core';
import { BattleplanApi } from '../api/battleplan-api.service';
import { AppPreferences } from '../data/app-preferences.service';
import type {
  ChatArtifact,
  ChatMessage,
  ConversationPage,
  Project,
  ProjectTask,
  Selection,
  TaskCodeOutput,
  TaskResearchOutput,
  TaskStatus,
} from '../core/models';
import { layoutMindmap, positionConnectedNode, type CardinalDirection } from '../core/mindmap';
import { parseGeneratedTaskList } from '../core/parse-tasks';
import { buildTaskForest, reorderTaskIds, type TaskNode } from '../core/task-tree';

const POLL_INTERVAL_MS = 3000;
const POLL_ATTEMPTS = 300;

@Injectable({ providedIn: 'root' })
export class BattleplanStore {
  private readonly api = inject(BattleplanApi);
  private readonly preferences = inject(AppPreferences);

  readonly projects = signal<Project[]>([]);
  readonly projectId = signal<string | null>(null);
  readonly tasks = signal<ProjectTask[]>([]);
  readonly codeOutputs = signal<Record<string, TaskCodeOutput | null>>({});
  readonly researchOutputs = signal<Record<string, TaskResearchOutput | null>>({});
  readonly messages = signal<ChatMessage[]>([]);
  readonly artifacts = signal<ChatArtifact[]>([]);
  readonly selection = signal<Selection>({ kind: 'empty' });
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly busy = signal(false);
  readonly pendingReply = signal(false);

  readonly project = computed(() => this.projects().find((item) => item.project_id === this.projectId()) ?? null);
  readonly forest = computed(() => buildTaskForest(this.tasks()));
  readonly selectedTask = computed(() => {
    const selection = this.selection();
    if (selection.kind !== 'task' && selection.kind !== 'code' && selection.kind !== 'research') return null;
    return this.tasks().find((task) => task.task_id === selection.taskId) ?? null;
  });

  private watchGeneration = 0;
  private watchTimer: ReturnType<typeof setTimeout> | undefined;

  async loadProjects(): Promise<void> {
    await this.run(async () => {
      const projects = await this.api.listProjects();
      this.projects.set(projects);
      const preferred = this.preferences.currentProjectId();
      const initial = preferred && projects.some((item) => item.project_id === preferred)
        ? preferred
        : projects[0]?.project_id;
      if (!this.projectId() && initial) await this.selectProject(initial);
      if (projects.length === 0) this.selection.set({ kind: 'create' });
    });
  }

  async selectProject(projectId: string): Promise<void> {
    this.stopWatch();
    this.projectId.set(projectId);
    await this.preferences.setCurrentProjectId(projectId);
    this.selection.set({ kind: 'project' });
    await this.run(async () => {
      await this.reloadTasks();
      this.applyConversation(await this.api.listProjectMessages(projectId));
    });
    this.continueProjectWatch(projectId);
  }

  showCreate(): void {
    this.stopWatch();
    this.error.set(null);
    this.selection.set({ kind: 'create' });
  }

  async createProject(input: { initial_prompt: string; repo_url?: string; starting_ref?: string }): Promise<void> {
    this.stopWatch();
    let projectId = '';
    await this.run(async () => {
      const project = await this.api.createProject(input);
      projectId = project.project_id;
      this.projects.update((projects) => [project, ...projects.filter((item) => item.project_id !== project.project_id)]);
      this.projectId.set(project.project_id);
      this.tasks.set([]);
      this.codeOutputs.set({});
      this.researchOutputs.set({});
      this.artifacts.set([]);
      this.selection.set({ kind: 'project' });
      this.applyConversation(await this.api.listProjectMessages(project.project_id));
    });
    if (projectId && !this.error()) this.continueProjectWatch(projectId);
  }

  async saveProject(patch: { title: string; repo_url: string; starting_ref: string }): Promise<void> {
    const project = this.project();
    if (!project) return;
    await this.run(async () => {
      const updated = await this.api.updateProject(project.project_id, patch);
      this.projects.update((projects) => projects.map((item) => item.project_id === updated.project_id ? updated : item));
      this.applyConversation(await this.api.listProjectMessages(project.project_id));
      this.notice.set('Project saved.');
    });
  }

  async deleteProject(): Promise<void> {
    const project = this.project();
    if (!project) return;
    this.stopWatch();
    await this.run(async () => {
      await this.api.deleteProject(project.project_id);
      this.projects.update((projects) => projects.filter((item) => item.project_id !== project.project_id));
      const next = this.projects()[0];
      this.projectId.set(next?.project_id ?? null);
      await this.preferences.setCurrentProjectId(next?.project_id ?? null);
      this.tasks.set([]);
      this.messages.set([]);
      this.artifacts.set([]);
      this.selection.set(next ? { kind: 'project' } : { kind: 'create' });
      this.notice.set('Project deleted.');
    });
    const projectId = this.projectId();
    if (projectId && this.selection().kind === 'project') await this.selectProject(projectId);
  }

  async placeNode(id: string, x: number, y: number): Promise<void> {
    const map_x = Math.round(x);
    const map_y = Math.round(y);
    try {
      if (id === 'project') {
        const project = this.project();
        if (!project) return;
        this.projects.update((projects) => projects.map((item) => item.project_id === project.project_id ? { ...item, map_x, map_y } : item));
        const updated = await this.api.updateProject(project.project_id, { map_x, map_y });
        this.projects.update((projects) => projects.map((item) => item.project_id === updated.project_id ? updated : item));
        return;
      }
      const task = this.tasks().find((item) => item.task_id === id);
      if (!task) return;
      this.replaceTask({ ...task, map_x, map_y });
      const updated = await this.api.updateTask(task.project_id, task.task_id, { map_x, map_y });
      this.replaceTask(updated);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not save the node position.');
    }
  }

  async openProjectChat(): Promise<void> {
    const projectId = this.projectId();
    if (!projectId) return;
    this.stopWatch();
    this.selection.set({ kind: 'project' });
    await this.run(async () => {
      this.applyConversation(await this.api.listProjectMessages(projectId));
    });
    this.continueProjectWatch(projectId);
  }

  async sendProjectMessage(message: string): Promise<void> {
    const projectId = this.projectId();
    if (!projectId) return;
    let runId: string | undefined;
    await this.run(async () => {
      const sent = await this.api.sendProjectMessage(projectId, message);
      runId = sent.run_id;
      this.rememberMessage(sent);
    });
    if (runId && !this.error()) await this.watchProject(projectId, runId);
  }

  async generateTasks(): Promise<void> {
    const projectId = this.projectId();
    if (!projectId) return;
    const selection = this.selection();
    const taskId = selection.kind === 'task' ? selection.taskId : undefined;
    let runId: string | undefined;
    await this.run(async () => {
      const sent = taskId
        ? await this.api.generateTaskTasks(taskId)
        : await this.api.generateTasks(projectId);
      runId = sent.run_id;
      this.rememberMessage(sent);
    });
    if (!runId || this.error()) return;
    if (taskId) await this.watchTask(taskId, runId);
    else await this.watchProject(projectId, runId);
    const reply = this.messages().find((message) => message.run_id === runId && message.role === 'assistant');
    if (!reply) {
      this.error.set('The Cursor agent has not replied yet.');
      return;
    }
    await this.run(async () => {
      const drafts = parseGeneratedTaskList(reply.content);
      await this.api.createTasks(projectId, drafts);
      await this.reloadTasks();
      const note = `Created ${drafts.length} task${drafts.length === 1 ? '' : 's'} from this conversation.`;
      const saved = taskId ? await this.api.noteTask(taskId, note) : await this.api.noteProject(projectId, note);
      this.rememberMessage(saved);
      this.notice.set(note);
    });
  }

  async openTask(taskId: string): Promise<void> {
    this.stopWatch();
    this.selection.set({ kind: 'task', taskId });
    await this.run(async () => {
      const result = await this.api.listTaskMessages(taskId);
      this.applyTaskConversation(result);
      await this.refreshOutput(result.task);
    });
    this.continueTaskWatch(taskId);
  }

  async addTask(dependsOn?: string): Promise<void> {
    if (dependsOn) {
      await this.addConnectedTask({ sourceId: dependsOn, sourceKind: 'task', direction: 'east' });
      return;
    }
    await this.addConnectedTask({ sourceId: 'project', sourceKind: 'project', direction: 'east' });
  }

  async addConnectedTask(input: {
    sourceId: string;
    sourceKind: 'project' | 'task';
    direction: CardinalDirection;
  }): Promise<string | null> {
    const projectId = this.projectId();
    const project = this.project();
    if (!projectId || !project) return null;
    const layout = layoutMindmap(
      project.title,
      this.tasks(),
      Number.isFinite(project.map_x) && Number.isFinite(project.map_y)
        ? { x: project.map_x as number, y: project.map_y as number }
        : undefined,
    );
    const source = layout.nodes.find((node) => node.id === input.sourceId);
    if (!source) return null;
    const placement = positionConnectedNode(source, input.direction);
    const map_x = Math.round(placement.x);
    const map_y = Math.round(placement.y);
    const depends_on = input.sourceKind === 'task' ? input.sourceId : undefined;
    this.stopWatch();
    let taskId = '';
    await this.run(async () => {
      const task = await this.api.createTask(projectId, { depends_on, map_x, map_y });
      taskId = task.task_id;
      await this.reloadTasks();
      this.selection.set({ kind: 'task', taskId: task.task_id });
      const result = await this.api.listTaskMessages(task.task_id);
      this.applyTaskConversation(result);
      this.notice.set('Task added. Fill in the details.');
    });
    if (taskId) this.continueTaskWatch(taskId);
    return taskId || null;
  }

  async saveMapNodeTitle(nodeId: string, title: string): Promise<void> {
    const trimmed = title.trim();
    if (!trimmed) return;
    if (nodeId === 'project') {
      const project = this.project();
      if (!project) return;
      await this.run(async () => {
        const updated = await this.api.updateProject(project.project_id, { title: trimmed });
        this.projects.update((projects) => projects.map((item) => item.project_id === updated.project_id ? updated : item));
        this.notice.set('Project title saved.');
      });
      return;
    }
    const task = this.tasks().find((item) => item.task_id === nodeId);
    if (!task) return;
    await this.run(async () => {
      const updated = await this.api.updateTask(task.project_id, task.task_id, { title: trimmed });
      this.replaceTask(updated);
      this.notice.set('Task title saved.');
    });
  }

  async openOutput(taskId: string, kind: 'code' | 'research'): Promise<void> {
    this.stopWatch();
    this.selection.set({ kind, taskId });
    await this.run(async () => {
      const task = this.tasks().find((item) => item.task_id === taskId);
      if (task) await this.refreshOutput(task);
    });
  }

  async saveTask(patch: {
    title: string;
    prompt: string;
    output_type: 'code' | 'research';
    dependencies: string[];
  }): Promise<void> {
    const task = this.selectedTask();
    if (!task) return;
    await this.run(async () => {
      const updated = await this.api.updateTask(task.project_id, task.task_id, patch);
      this.replaceTask(updated);
      this.applyTaskConversation(await this.api.listTaskMessages(task.task_id));
      this.notice.set('Task saved.');
    });
  }

  async transition(taskId: string, status: TaskStatus, manual: boolean): Promise<void> {
    const task = this.tasks().find((item) => item.task_id === taskId);
    if (!task) return;
    await this.run(async () => {
      const updated = await this.api.transition(task.project_id, taskId, status, manual);
      this.replaceTask(updated);
      if (updated.cursor_agent_id) {
        const result = await this.api.listTaskMessages(taskId);
        this.applyTaskConversation(result);
        await this.refreshOutput(result.task);
      }
    });
    if (this.selection().kind === 'task') this.continueTaskWatch(taskId);
  }

  async sendTaskMessage(message: string): Promise<void> {
    const task = this.selectedTask();
    if (!task) return;
    let runId: string | undefined;
    await this.run(async () => {
      const sent = await this.api.sendTaskMessage(task.task_id, message);
      runId = sent.run_id;
      this.rememberMessage(sent);
    });
    if (runId && !this.error()) await this.watchTask(task.task_id, runId);
  }

  async approve(): Promise<void> {
    const task = this.selectedTask();
    if (!task) return;
    await this.run(async () => {
      const merging = await this.api.approve(task.task_id);
      this.replaceTask(merging);
      const refreshed = await this.api.listTaskMessages(task.task_id);
      this.applyTaskConversation(refreshed);
      this.notice.set(refreshed.task.status === 'DONE' ? 'Pull request merged. Task is DONE.' : 'Merge requested.');
    });
    this.continueTaskWatch(task.task_id);
  }

  async move(taskId: string, direction: -1 | 1): Promise<void> {
    const projectId = this.projectId();
    if (!projectId) return;
    const reordered = reorderTaskIds(this.tasks(), taskId, direction);
    if (reordered === 'edge') {
      this.error.set(null);
      this.notice.set('No sibling task in that direction.');
      return;
    }
    if (reordered === 'missing') return;
    await this.run(async () => {
      this.tasks.set(await this.api.reorderTasks(projectId, reordered));
    });
  }

  async deleteTask(taskId: string): Promise<void> {
    const task = this.tasks().find((item) => item.task_id === taskId);
    if (!task) return;
    this.stopWatch();
    await this.run(async () => {
      await this.api.deleteTask(task.project_id, taskId);
      await this.reloadTasks();
      this.selection.set({ kind: 'project' });
      this.messages.set([]);
      this.artifacts.set([]);
      this.notice.set('Task deleted.');
    });
    const projectId = this.projectId();
    if (projectId) {
      await this.run(async () => {
        this.applyConversation(await this.api.listProjectMessages(projectId));
      });
      this.continueProjectWatch(projectId);
    }
  }

  async saveCodeOutput(output: Omit<TaskCodeOutput, 'task_id'>): Promise<void> {
    const task = this.selectedTask();
    if (!task) return;
    await this.run(async () => {
      const saved = await this.api.saveCodeOutput(task.task_id, output);
      this.codeOutputs.update((current) => ({ ...current, [task.task_id]: saved }));
      await this.reloadTask(task.task_id);
      this.notice.set('Code output saved.');
    });
  }

  async saveResearchOutput(output: Omit<TaskResearchOutput, 'task_id'>): Promise<void> {
    const task = this.selectedTask();
    if (!task) return;
    await this.run(async () => {
      const saved = await this.api.saveResearchOutput(task.task_id, output);
      this.researchOutputs.update((current) => ({ ...current, [task.task_id]: saved }));
      await this.reloadTask(task.task_id);
      this.notice.set('Research output saved.');
    });
  }

  codeOutput(taskId: string): TaskCodeOutput | null {
    return this.codeOutputs()[taskId] ?? null;
  }

  researchOutput(taskId: string): TaskResearchOutput | null {
    return this.researchOutputs()[taskId] ?? null;
  }

  private continueProjectWatch(projectId: string): void {
    const runId = unansweredRun(this.messages());
    if (runId) void this.watchProject(projectId, runId);
  }

  private continueTaskWatch(taskId: string): void {
    const runId = unansweredRun(this.messages());
    if (runId) void this.watchTask(taskId, runId);
  }

  private watchProject(projectId: string, runId: string): Promise<void> {
    return this.poll(async (generation) => {
      if (!this.stillWatching(generation) || this.projectId() !== projectId || this.selection().kind !== 'project') return true;
      const page = await this.api.listProjectMessages(projectId);
      if (!this.stillWatching(generation) || this.projectId() !== projectId || this.selection().kind !== 'project') return true;
      this.applyConversation(page);
      return hasAssistant(page.messages, runId);
    });
  }

  private watchTask(taskId: string, runId: string): Promise<void> {
    return this.poll(async (generation) => {
      const selection = this.selection();
      if (!this.stillWatching(generation) || selection.kind !== 'task' || selection.taskId !== taskId) return true;
      const result = await this.api.listTaskMessages(taskId);
      const current = this.selection();
      if (!this.stillWatching(generation) || current.kind !== 'task' || current.taskId !== taskId) return true;
      this.applyTaskConversation(result);
      await this.refreshOutput(result.task);
      return hasAssistant(result.messages, runId);
    });
  }

  private poll(load: (generation: number) => Promise<boolean>): Promise<void> {
    this.stopWatch();
    const generation = ++this.watchGeneration;
    this.pendingReply.set(true);
    return new Promise((resolve) => {
      const finish = (done: boolean, timedOut: boolean) => {
        if (generation !== this.watchGeneration) {
          resolve();
          return;
        }
        this.pendingReply.set(false);
        if (timedOut && !done) this.notice.set('Still waiting for Cursor. Reopen the chat to check again.');
        resolve();
      };
      const tick = (attempt: number) => {
        void (async () => {
          if (!this.stillWatching(generation)) {
            resolve();
            return;
          }
          let done = false;
          try {
            done = await load(generation);
          } catch (error) {
            if (!this.stillWatching(generation)) {
              resolve();
              return;
            }
            this.error.set(error instanceof Error ? error.message : 'Request failed.');
          }
          if (!this.stillWatching(generation)) {
            resolve();
            return;
          }
          if (done || attempt + 1 >= POLL_ATTEMPTS) {
            finish(done, !done);
            return;
          }
          this.watchTimer = setTimeout(() => tick(attempt + 1), POLL_INTERVAL_MS);
        })();
      };
      tick(0);
    });
  }

  private stillWatching(generation: number): boolean {
    return generation === this.watchGeneration;
  }

  private stopWatch(): void {
    this.watchGeneration += 1;
    if (this.watchTimer) clearTimeout(this.watchTimer);
    this.watchTimer = undefined;
    this.pendingReply.set(false);
  }

  private applyConversation(page: ConversationPage): void {
    this.messages.set(page.messages);
    this.artifacts.set(page.artifacts ?? []);
  }

  private applyTaskConversation(result: { messages: ChatMessage[]; task: ProjectTask; artifacts: ChatArtifact[] }): void {
    this.messages.set(result.messages);
    this.artifacts.set(result.artifacts ?? []);
    this.replaceTask(result.task);
  }

  private rememberMessage(message: ChatMessage): void {
    this.messages.update((messages) => messages.some((item) => item.message_id === message.message_id)
      ? messages
      : [...messages, message]);
  }

  private async reloadTasks(): Promise<void> {
    const projectId = this.projectId();
    if (!projectId) return;
    const tasks = await this.api.listTasks(projectId);
    this.tasks.set(tasks);
    const code: Record<string, TaskCodeOutput | null> = {};
    const research: Record<string, TaskResearchOutput | null> = {};
    await Promise.all(tasks.map(async (task) => {
      if (task.output_type === 'code') code[task.task_id] = await this.api.getCodeOutput(task.task_id);
      else research[task.task_id] = await this.api.getResearchOutput(task.task_id);
    }));
    this.codeOutputs.set(code);
    this.researchOutputs.set(research);
  }

  private async refreshOutput(task: ProjectTask): Promise<void> {
    if (task.output_type === 'code') {
      const output = await this.api.getCodeOutput(task.task_id);
      this.codeOutputs.update((current) => ({ ...current, [task.task_id]: output }));
    } else {
      const output = await this.api.getResearchOutput(task.task_id);
      this.researchOutputs.update((current) => ({ ...current, [task.task_id]: output }));
    }
  }

  private async reloadTask(taskId: string): Promise<void> {
    const result = await this.api.listTaskMessages(taskId);
    this.replaceTask(result.task);
  }

  private replaceTask(task: ProjectTask): void {
    this.tasks.update((tasks) => {
      const exists = tasks.some((item) => item.task_id === task.task_id);
      const next = exists ? tasks.map((item) => item.task_id === task.task_id ? task : item) : [...tasks, task];
      return next.sort((left, right) => left.order - right.order);
    });
  }

  private async run(work: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      await work();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Request failed.');
    } finally {
      this.busy.set(false);
    }
  }
}

function unansweredRun(messages: ChatMessage[]): string | undefined {
  const answered = new Set(messages.filter((message) => message.role === 'assistant' && message.run_id).map((message) => message.run_id));
  return [...messages].reverse().find((message) => message.role === 'user' && message.run_id && !answered.has(message.run_id))?.run_id;
}

function hasAssistant(messages: ChatMessage[], runId: string): boolean {
  return messages.some((message) => message.run_id === runId && message.role === 'assistant');
}

export type { TaskNode };
