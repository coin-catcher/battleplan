import { Injectable, computed, inject, signal } from '@angular/core';
import { WarplanApi } from '../api/warplan-api.service';
import type {
  ChatMessage,
  Project,
  ProjectTask,
  Selection,
  TaskCodeOutput,
  TaskResearchOutput,
  TaskStatus,
} from '../core/models';
import { parseGeneratedTaskList } from '../core/parse-tasks';
import { buildTaskForest, reorderTaskIds, type TaskNode } from '../core/task-tree';

@Injectable({ providedIn: 'root' })
export class WarplanStore {
  private readonly api = inject(WarplanApi);

  readonly projects = signal<Project[]>([]);
  readonly projectId = signal<string | null>(null);
  readonly tasks = signal<ProjectTask[]>([]);
  readonly codeOutputs = signal<Record<string, TaskCodeOutput | null>>({});
  readonly researchOutputs = signal<Record<string, TaskResearchOutput | null>>({});
  readonly messages = signal<ChatMessage[]>([]);
  readonly selection = signal<Selection>({ kind: 'empty' });
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly busy = signal(false);

  readonly project = computed(() => this.projects().find((item) => item.project_id === this.projectId()) ?? null);
  readonly forest = computed(() => buildTaskForest(this.tasks()));
  readonly selectedTask = computed(() => {
    const selection = this.selection();
    if (selection.kind !== 'task' && selection.kind !== 'code' && selection.kind !== 'research') return null;
    return this.tasks().find((task) => task.task_id === selection.taskId) ?? null;
  });

  async loadProjects(): Promise<void> {
    await this.run(async () => {
      const projects = await this.api.listProjects();
      this.projects.set(projects);
      if (!this.projectId() && projects[0]) await this.selectProject(projects[0].project_id);
      if (projects.length === 0) this.selection.set({ kind: 'create' });
    });
  }

  async selectProject(projectId: string): Promise<void> {
    this.projectId.set(projectId);
    this.selection.set({ kind: 'project' });
    await this.run(async () => {
      await this.reloadTasks();
      this.messages.set(await this.api.listProjectMessages(projectId));
    });
  }

  showCreate(): void {
    this.error.set(null);
    this.selection.set({ kind: 'create' });
  }

  async createProject(input: { initial_prompt: string; repo_url?: string; starting_ref?: string }): Promise<void> {
    await this.run(async () => {
      const project = await this.api.createProject(input);
      this.projects.update((projects) => [project, ...projects.filter((item) => item.project_id !== project.project_id)]);
      this.projectId.set(project.project_id);
      this.tasks.set([]);
      this.codeOutputs.set({});
      this.researchOutputs.set({});
      this.selection.set({ kind: 'project' });
      this.messages.set(await this.waitForAssistant(project.project_id, project.latest_run_id));
    });
  }

  async saveTitle(title: string): Promise<void> {
    const project = this.project();
    if (!project) return;
    await this.run(async () => {
      const updated = await this.api.updateTitle(project.project_id, title);
      this.projects.update((projects) => projects.map((item) => item.project_id === updated.project_id ? updated : item));
      this.notice.set('Title saved.');
    });
  }

  async openProjectChat(): Promise<void> {
    const projectId = this.projectId();
    if (!projectId) return;
    this.selection.set({ kind: 'project' });
    await this.run(async () => {
      this.messages.set(await this.api.listProjectMessages(projectId));
    });
  }

  async sendProjectMessage(message: string): Promise<void> {
    const projectId = this.projectId();
    if (!projectId) return;
    await this.run(async () => {
      const sent = await this.api.sendProjectMessage(projectId, message);
      this.messages.set(await this.waitForAssistant(projectId, sent.run_id));
    });
  }

  async generateTasks(): Promise<void> {
    const projectId = this.projectId();
    if (!projectId) return;
    await this.run(async () => {
      const sent = await this.api.generateTasks(projectId);
      const messages = await this.waitForAssistant(projectId, sent.run_id);
      this.messages.set(messages);
      const reply = messages.find((message) => message.run_id === sent.run_id && message.role === 'assistant');
      if (!reply) throw new Error('The Cursor agent has not replied yet.');
      const drafts = parseGeneratedTaskList(reply.content);
      await this.api.createTasks(projectId, drafts);
      await this.reloadTasks();
      this.notice.set(`Created ${drafts.length} task${drafts.length === 1 ? '' : 's'}.`);
    });
  }

  async openTask(taskId: string): Promise<void> {
    this.selection.set({ kind: 'task', taskId });
    await this.run(async () => {
      const result = await this.api.listTaskMessages(taskId);
      this.messages.set(result.messages);
      this.replaceTask(result.task);
      await this.refreshOutput(result.task);
    });
  }

  async openOutput(taskId: string, kind: 'code' | 'research'): Promise<void> {
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
        this.messages.set(result.messages);
        this.replaceTask(result.task);
        await this.refreshOutput(result.task);
      }
    });
  }

  async sendTaskMessage(message: string): Promise<void> {
    const task = this.selectedTask();
    if (!task) return;
    await this.run(async () => {
      const sent = await this.api.sendTaskMessage(task.task_id, message);
      const result = await this.api.listTaskMessages(task.task_id);
      const reply = result.messages.find((item) => item.run_id === sent.run_id && item.role === 'assistant');
      this.messages.set(reply ? result.messages : await this.waitForTaskAssistant(task.task_id, sent.run_id));
      const refreshed = await this.api.listTaskMessages(task.task_id);
      this.messages.set(refreshed.messages);
      this.replaceTask(refreshed.task);
      await this.refreshOutput(refreshed.task);
    });
  }

  async approve(): Promise<void> {
    const task = this.selectedTask();
    if (!task) return;
    await this.run(async () => {
      const merging = await this.api.approve(task.task_id);
      this.replaceTask(merging);
      const refreshed = await this.api.listTaskMessages(task.task_id);
      this.messages.set(refreshed.messages);
      this.replaceTask(refreshed.task);
      this.notice.set(refreshed.task.status === 'DONE' ? 'Pull request merged. Task is DONE.' : 'Merge requested.');
    });
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
    await this.run(async () => {
      await this.api.deleteTask(task.project_id, taskId);
      await this.reloadTasks();
      this.selection.set({ kind: 'project' });
      this.notice.set('Task deleted.');
    });
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

  private async waitForAssistant(projectId: string, runId: string | undefined): Promise<ChatMessage[]> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const messages = await this.api.listProjectMessages(projectId);
      if (!runId || messages.some((message) => message.run_id === runId && message.role === 'assistant')) {
        return messages;
      }
      await delay(400);
    }
    return this.api.listProjectMessages(projectId);
  }

  private async waitForTaskAssistant(taskId: string, runId: string | undefined): Promise<ChatMessage[]> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const result = await this.api.listTaskMessages(taskId);
      this.replaceTask(result.task);
      if (!runId || result.messages.some((message) => message.run_id === runId && message.role === 'assistant')) {
        return result.messages;
      }
      await delay(400);
    }
    return (await this.api.listTaskMessages(taskId)).messages;
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type { TaskNode };
