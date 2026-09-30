import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  ChatMessage,
  Project,
  ProjectTask,
  TaskCodeOutput,
  TaskDraft,
  TaskResearchOutput,
  TaskStatus,
} from '../core/models';

@Injectable({ providedIn: 'root' })
export class WarplanApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl.replace(/\/$/, '');

  listProjects(): Promise<Project[]> {
    return this.get<{ projects: Project[] }>('/projects').then((body) => body.projects);
  }

  createProject(input: { initial_prompt: string; repo_url?: string; starting_ref?: string }): Promise<Project> {
    return this.send<Project>('POST', '/projects', input);
  }

  updateTitle(projectId: string, title: string): Promise<Project> {
    return this.send<Project>('PATCH', `/projects/${projectId}`, { title });
  }

  deleteProject(projectId: string): Promise<void> {
    return this.send<void>('DELETE', `/projects/${projectId}`);
  }

  listTasks(projectId: string): Promise<ProjectTask[]> {
    return this.get<{ tasks: ProjectTask[] }>(`/projects/${projectId}/tasks`).then((body) => body.tasks);
  }

  createTasks(projectId: string, tasks: TaskDraft[]): Promise<ProjectTask[]> {
    return this.send<{ tasks: ProjectTask[] }>('POST', `/projects/${projectId}/tasks`, { tasks }).then((body) => body.tasks);
  }

  updateTask(projectId: string, taskId: string, patch: Record<string, unknown>): Promise<ProjectTask> {
    return this.send<ProjectTask>('PATCH', `/projects/${projectId}/tasks/${taskId}`, patch);
  }

  deleteTask(projectId: string, taskId: string): Promise<void> {
    return this.send<void>('DELETE', `/projects/${projectId}/tasks/${taskId}`);
  }

  reorderTasks(projectId: string, taskIds: string[]): Promise<ProjectTask[]> {
    return this.send<{ tasks: ProjectTask[] }>('POST', `/projects/${projectId}/tasks/reorder`, { task_ids: taskIds })
      .then((body) => body.tasks);
  }

  transition(projectId: string, taskId: string, status: TaskStatus, manual: boolean): Promise<ProjectTask> {
    return this.send<ProjectTask>('POST', `/projects/${projectId}/tasks/${taskId}/transition`, { status, manual });
  }

  getCodeOutput(taskId: string): Promise<TaskCodeOutput | null> {
    return this.get<{ output: TaskCodeOutput | null }>(`/tasks/${taskId}/outputs/code`).then((body) => body.output);
  }

  saveCodeOutput(taskId: string, output: Omit<TaskCodeOutput, 'task_id'>): Promise<TaskCodeOutput> {
    return this.send<TaskCodeOutput>('PUT', `/tasks/${taskId}/outputs/code`, output);
  }

  getResearchOutput(taskId: string): Promise<TaskResearchOutput | null> {
    return this.get<{ output: TaskResearchOutput | null }>(`/tasks/${taskId}/outputs/research`).then((body) => body.output);
  }

  saveResearchOutput(taskId: string, output: Omit<TaskResearchOutput, 'task_id'>): Promise<TaskResearchOutput> {
    return this.send<TaskResearchOutput>('PUT', `/tasks/${taskId}/outputs/research`, output);
  }

  listProjectMessages(projectId: string): Promise<ChatMessage[]> {
    return this.get<{ messages: ChatMessage[] }>(`/projects/${projectId}/messages`).then((body) => body.messages);
  }

  sendProjectMessage(projectId: string, message: string): Promise<ChatMessage> {
    return this.send<ChatMessage>('POST', `/projects/${projectId}/messages`, { message });
  }

  generateTasks(projectId: string): Promise<ChatMessage> {
    return this.send<ChatMessage>('POST', `/projects/${projectId}/messages/generate-tasks`);
  }

  listTaskMessages(taskId: string): Promise<{ messages: ChatMessage[]; task: ProjectTask }> {
    return this.get<{ messages: ChatMessage[]; task: ProjectTask }>(`/tasks/${taskId}/messages`);
  }

  sendTaskMessage(taskId: string, message: string): Promise<ChatMessage> {
    return this.send<ChatMessage>('POST', `/tasks/${taskId}/messages`, { message });
  }

  approve(taskId: string): Promise<ProjectTask> {
    return this.send<ProjectTask>('POST', `/tasks/${taskId}/approve`);
  }

  private get<T>(path: string): Promise<T> {
    return firstValueFrom(this.http.get<T>(`${this.base}${path}`)).catch((error: unknown) => {
      throw new Error(readError(error));
    });
  }

  private send<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
    return firstValueFrom(this.http.request<T>(method, `${this.base}${path}`, { body })).catch((error: unknown) => {
      throw new Error(readError(error));
    });
  }
}

function readError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const payload = error.error as { error?: string } | string | null;
    if (payload && typeof payload === 'object' && payload.error) return payload.error;
    if (typeof payload === 'string' && payload.trim()) return payload;
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Request failed.';
}
