import type { CursorClient } from './cursor-client.js';
import type { NormalizedTaskDraft, OutputType, ProjectTask, TaskStatus } from './domain.js';
import { isOutputType, isTaskStatus } from './domain.js';
import { HttpError } from './errors.js';
import { assertAcyclic } from './graph.js';
import { systemClock, type Clock } from './ids.js';
import { normalizeTaskDrafts } from './task-list.js';
import { taskExecutionPrompt } from './prompts.js';
import type { WarplanRepository } from './repository.js';
import { assertCanTransition } from './status.js';

export interface TaskPatch {
  title?: string;
  prompt?: string;
  dependencies?: string[];
  output_type?: OutputType;
  status?: TaskStatus;
  manual?: boolean;
}

export class TasksService {
  constructor(
    private readonly repo: WarplanRepository,
    private readonly cursor: CursorClient,
    private readonly clock: Clock = systemClock,
  ) {}

  async list(projectId: string): Promise<ProjectTask[]> {
    await this.requireProject(projectId);
    return this.repo.listTasks(projectId);
  }

  async get(projectId: string, taskId: string): Promise<ProjectTask> {
    return this.requireTask(projectId, taskId);
  }

  async createOne(
    projectId: string,
    input: { title?: string; prompt?: string; output_type?: OutputType; depends_on?: string },
  ): Promise<ProjectTask> {
    await this.requireProject(projectId);
    const existing = await this.repo.listTasks(projectId);
    const title = input.title?.trim() || 'New task';
    const prompt = input.prompt?.trim() || 'Describe what this task should do.';
    const outputType = input.output_type ?? 'code';
    if (!isOutputType(outputType)) throw new HttpError(400, 'output_type must be code or research.');
    const dependencies = input.depends_on ? [input.depends_on] : [];
    if (dependencies.some((id) => !existing.some((task) => task.task_id === id))) {
      throw new HttpError(400, 'depends_on must be a task in this project.');
    }
    const timestamp = this.clock.nowIso();
    const task: ProjectTask = {
      task_id: this.clock.newId(),
      project_id: projectId,
      title,
      prompt,
      dependencies,
      status: 'TODO',
      output_type: outputType,
      order: existing.length,
      created_at: timestamp,
      updated_at: timestamp,
    };
    assertAcyclic([...existing, task]);
    await this.repo.saveTask(task);
    return task;
  }

  async createBatch(projectId: string, drafts: unknown[]): Promise<ProjectTask[]> {
    await this.requireProject(projectId);
    const normalized = normalizeTaskDrafts(drafts);
    const existing = await this.repo.listTasks(projectId);
    const timestamp = this.clock.nowIso();
    const created: ProjectTask[] = normalized.map((draft, index) => ({
      task_id: this.clock.newId(),
      project_id: projectId,
      title: draft.title,
      prompt: draft.prompt,
      dependencies: [],
      status: 'TODO',
      output_type: draft.output_type,
      order: existing.length + index,
      created_at: timestamp,
      updated_at: timestamp,
    }));
    this.bindDependencies(existing, created, normalized);
    assertAcyclic([...existing, ...created]);
    await this.repo.saveTasks(created);
    return created;
  }

  async update(projectId: string, taskId: string, patch: TaskPatch): Promise<ProjectTask> {
    const task = await this.requireTask(projectId, taskId);
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) throw new HttpError(400, 'title is required.');
      task.title = title;
    }
    if (patch.prompt !== undefined) {
      const prompt = patch.prompt.trim();
      if (!prompt) throw new HttpError(400, 'prompt is required.');
      task.prompt = prompt;
    }
    if (patch.output_type !== undefined) {
      if (!isOutputType(patch.output_type)) throw new HttpError(400, 'output_type must be code or research.');
      if (patch.output_type !== task.output_type) {
        const other = task.output_type === 'code'
          ? await this.repo.getResearchOutput(taskId)
          : await this.repo.getCodeOutput(taskId);
        if (other) {
          throw new HttpError(400, 'Split mixed outputs into two tasks instead of changing output_type.');
        }
      }
      task.output_type = patch.output_type;
    }
    if (patch.dependencies !== undefined) {
      if (!Array.isArray(patch.dependencies) || patch.dependencies.some((item) => typeof item !== 'string')) {
        throw new HttpError(400, 'dependencies must be an array of task ids.');
      }
      task.dependencies = [...new Set(patch.dependencies)];
      const tasks = (await this.repo.listTasks(projectId)).map((item) => item.task_id === task.task_id ? task : item);
      assertAcyclic(tasks);
    }
    if (patch.status !== undefined) {
      if (!isTaskStatus(patch.status)) throw new HttpError(400, 'Unknown task status.');
      await this.applyStatus(task, patch.status, Boolean(patch.manual));
    }
    task.updated_at = this.clock.nowIso();
    await this.repo.saveTask(task);
    return task;
  }

  async transition(projectId: string, taskId: string, status: TaskStatus, manual: boolean): Promise<ProjectTask> {
    return this.update(projectId, taskId, { status, manual });
  }

  async remove(projectId: string, taskId: string): Promise<void> {
    const task = await this.requireTask(projectId, taskId);
    if (task.cursor_agent_id) await this.cursor.archiveAgent(task.cursor_agent_id);
    await this.repo.deleteTask(taskId);
  }

  async reorder(projectId: string, taskIds: string[]): Promise<ProjectTask[]> {
    await this.requireProject(projectId);
    const tasks = await this.repo.listTasks(projectId);
    if (taskIds.length !== tasks.length || new Set(taskIds).size !== taskIds.length) {
      throw new HttpError(400, 'Reorder must include each task in the project exactly once.');
    }
    const byId = new Map(tasks.map((task) => [task.task_id, task]));
    const timestamp = this.clock.nowIso();
    const ordered = taskIds.map((taskId, order) => {
      const task = byId.get(taskId);
      if (!task) throw new HttpError(400, `Unknown task ${taskId}.`);
      return { ...task, order, updated_at: timestamp };
    });
    await this.repo.saveTasks(ordered);
    return ordered;
  }

  private bindDependencies(existing: ProjectTask[], created: ProjectTask[], drafts: NormalizedTaskDraft[]): void {
    const titles = new Map<string, string[]>();
    for (const task of [...existing, ...created]) {
      const ids = titles.get(task.title) ?? [];
      ids.push(task.task_id);
      titles.set(task.title, ids);
    }
    created.forEach((task, index) => {
      task.dependencies = drafts[index].depends_on.map((title) => {
        const matches = titles.get(title) ?? [];
        if (matches.length === 0) throw new HttpError(400, `Unknown dependency "${title}".`);
        if (matches.length > 1) throw new HttpError(400, `Dependency "${title}" matches more than one task.`);
        return matches[0];
      });
    });
  }

  private async applyStatus(task: ProjectTask, status: TaskStatus, manual: boolean): Promise<void> {
    assertCanTransition(task.status, status, manual);
    if (status === 'DOING' && !task.cursor_agent_id) {
      if (!manual) await this.assertDependenciesDone(task);
      await this.launch(task);
    }
    task.status = status;
    if (status !== 'DOING') task.pending_action = undefined;
  }

  private async assertDependenciesDone(task: ProjectTask): Promise<void> {
    const tasks = await this.repo.listTasks(task.project_id);
    const byId = new Map(tasks.map((item) => [item.task_id, item]));
    for (const dependency of task.dependencies) {
      const other = byId.get(dependency);
      if (!other || other.status !== 'DONE') {
        throw new HttpError(409, 'Dependencies must be DONE before this task can start.');
      }
    }
  }

  private async launch(task: ProjectTask): Promise<void> {
    const project = await this.requireProject(task.project_id);
    if (!project.repo_url) {
      throw new HttpError(400, 'Add a repository to the project before starting a task.');
    }
    const created = await this.cursor.createAgent({
      prompt: taskExecutionPrompt(task, project),
      name: task.title,
      mode: 'agent',
      repoUrl: project.repo_url,
      startingRef: project.starting_ref || 'main',
      autoCreatePr: true,
    });
    task.cursor_agent_id = created.agent.id;
    task.cursor_chat_link = created.agent.url;
    task.latest_run_id = created.run.id;
    await this.repo.saveMessage({
      message_id: this.clock.newId(),
      scope: 'task',
      project_id: task.project_id,
      task_id: task.task_id,
      role: 'user',
      content: task.prompt,
      created_at: this.clock.nowIso(),
      run_id: created.run.id,
      intent: 'chat',
    });
  }

  private async requireProject(projectId: string) {
    const project = await this.repo.getProject(projectId);
    if (!project) throw new HttpError(404, 'Project not found.');
    return project;
  }

  private async requireTask(projectId: string, taskId: string): Promise<ProjectTask> {
    const task = await this.repo.getTask(taskId);
    if (!task || task.project_id !== projectId) throw new HttpError(404, 'Task not found.');
    return task;
  }
}
