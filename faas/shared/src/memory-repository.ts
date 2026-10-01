import type {
  ChatArtifact,
  ChatMessage,
  Project,
  ProjectTask,
  TaskCodeOutput,
  TaskResearchOutput,
} from './domain.js';
import { HttpError } from './errors.js';
import type { WarplanRepository } from './repository.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryRepository implements WarplanRepository {
  private readonly projects = new Map<string, Project>();
  private readonly tasks = new Map<string, ProjectTask>();
  private readonly codeOutputs = new Map<string, TaskCodeOutput>();
  private readonly researchOutputs = new Map<string, TaskResearchOutput>();
  private messages: ChatMessage[] = [];
  private artifacts: ChatArtifact[] = [];

  async saveProject(project: Project): Promise<void> {
    this.projects.set(project.project_id, clone(project));
  }

  async getProject(projectId: string): Promise<Project | null> {
    const project = this.projects.get(projectId);
    return project ? clone(project) : null;
  }

  async listProjects(): Promise<Project[]> {
    return [...this.projects.values()]
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .map((project) => clone(project));
  }

  async findProjectByAgent(agentId: string): Promise<Project | null> {
    const project = [...this.projects.values()].find((item) => item.cursor_agent_id === agentId);
    return project ? clone(project) : null;
  }

  async deleteProject(projectId: string): Promise<void> {
    const tasks = await this.listTasks(projectId);
    this.projects.delete(projectId);
    this.messages = this.messages.filter((message) => message.project_id !== projectId);
    this.artifacts = this.artifacts.filter((artifact) => artifact.project_id !== projectId);
    for (const task of tasks) {
      await this.deleteTask(task.task_id);
    }
  }

  async saveTask(task: ProjectTask): Promise<void> {
    this.tasks.set(task.task_id, clone(task));
  }

  async saveTasks(tasks: ProjectTask[]): Promise<void> {
    for (const task of tasks) {
      await this.saveTask(task);
    }
  }

  async getTask(taskId: string): Promise<ProjectTask | null> {
    const task = this.tasks.get(taskId);
    return task ? clone(task) : null;
  }

  async listTasks(projectId: string): Promise<ProjectTask[]> {
    return [...this.tasks.values()]
      .filter((task) => task.project_id === projectId)
      .sort((left, right) => left.order - right.order || left.created_at.localeCompare(right.created_at))
      .map((task) => clone(task));
  }

  async findTaskByAgent(agentId: string): Promise<ProjectTask | null> {
    const task = [...this.tasks.values()].find((item) => item.cursor_agent_id === agentId);
    return task ? clone(task) : null;
  }

  async deleteTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;
    this.tasks.delete(taskId);
    this.codeOutputs.delete(taskId);
    this.researchOutputs.delete(taskId);
    this.messages = this.messages.filter((message) => message.task_id !== taskId);
    this.artifacts = this.artifacts.filter((artifact) => artifact.task_id !== taskId);
    for (const other of this.tasks.values()) {
      if (other.project_id === task.project_id && other.dependencies.includes(taskId)) {
        other.dependencies = other.dependencies.filter((dependency) => dependency !== taskId);
      }
    }
  }

  async getCodeOutput(taskId: string): Promise<TaskCodeOutput | null> {
    const output = this.codeOutputs.get(taskId);
    return output ? clone(output) : null;
  }

  async saveCodeOutput(output: TaskCodeOutput): Promise<void> {
    this.codeOutputs.set(output.task_id, clone(output));
  }

  async getResearchOutput(taskId: string): Promise<TaskResearchOutput | null> {
    const output = this.researchOutputs.get(taskId);
    return output ? clone(output) : null;
  }

  async saveResearchOutput(output: TaskResearchOutput): Promise<void> {
    this.researchOutputs.set(output.task_id, clone(output));
  }

  async listProjectMessages(projectId: string): Promise<ChatMessage[]> {
    return this.messages
      .filter((message) => message.scope === 'project' && message.project_id === projectId)
      .sort((left, right) => left.created_at.localeCompare(right.created_at))
      .map((message) => clone(message));
  }

  async listTaskMessages(taskId: string): Promise<ChatMessage[]> {
    return this.messages
      .filter((message) => message.scope === 'task' && message.task_id === taskId)
      .sort((left, right) => left.created_at.localeCompare(right.created_at))
      .map((message) => clone(message));
  }

  async saveMessage(message: ChatMessage): Promise<void> {
    if (message.scope === 'task' && !message.task_id) {
      throw new HttpError(500, 'Task messages require task_id.');
    }
    this.messages.push(clone(message));
  }

  async listArtifacts(scope: 'project' | 'task', ownerId: string): Promise<ChatArtifact[]> {
    return this.artifacts
      .filter((artifact) => artifact.scope === scope && (scope === 'project' ? artifact.project_id === ownerId : artifact.task_id === ownerId))
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((artifact) => clone(artifact));
  }

  async saveArtifact(artifact: ChatArtifact): Promise<void> {
    const index = this.artifacts.findIndex((item) => item.scope === artifact.scope
      && item.path === artifact.path
      && (artifact.scope === 'project' ? item.project_id === artifact.project_id : item.task_id === artifact.task_id));
    if (index >= 0) this.artifacts[index] = clone(artifact);
    else this.artifacts.push(clone(artifact));
  }
}
