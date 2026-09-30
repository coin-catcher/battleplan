import type { CursorClient } from './cursor-client.js';
import type { Project } from './domain.js';
import { HttpError } from './errors.js';
import { systemClock, type Clock } from './ids.js';
import type { WarplanRepository } from './repository.js';

export interface CreateProjectInput {
  initial_prompt: string;
  repo_url?: string;
  starting_ref?: string;
}

export class ProjectsService {
  constructor(
    private readonly repo: WarplanRepository,
    private readonly cursor: CursorClient,
    private readonly clock: Clock = systemClock,
  ) {}

  async create(input: CreateProjectInput): Promise<Project> {
    const initialPrompt = input.initial_prompt?.trim();
    if (!initialPrompt) throw new HttpError(400, 'initial_prompt is required.');
    const created = await this.cursor.createAgent({
      prompt: initialPrompt,
      mode: 'plan',
      repoUrl: input.repo_url?.trim() || undefined,
      startingRef: input.starting_ref?.trim() || undefined,
      autoCreatePr: false,
    });
    const timestamp = this.clock.nowIso();
    const project: Project = {
      project_id: this.clock.newId(),
      title: created.agent.name?.trim() || 'Untitled warplan',
      initial_prompt: initialPrompt,
      cursor_chat_link: created.agent.url,
      cursor_agent_id: created.agent.id,
      latest_run_id: created.run.id,
      repo_url: input.repo_url?.trim() || undefined,
      starting_ref: input.starting_ref?.trim() || undefined,
      created_at: timestamp,
      updated_at: timestamp,
    };
    await this.repo.saveProject(project);
    await this.repo.saveMessage({
      message_id: this.clock.newId(),
      scope: 'project',
      project_id: project.project_id,
      role: 'user',
      content: initialPrompt,
      created_at: timestamp,
      run_id: created.run.id,
      intent: 'chat',
    });
    return project;
  }

  list(): Promise<Project[]> {
    return this.repo.listProjects();
  }

  async get(projectId: string): Promise<Project> {
    return this.require(projectId);
  }

  async updateTitle(projectId: string, title: string): Promise<Project> {
    const project = await this.require(projectId);
    const next = title.trim();
    if (!next) throw new HttpError(400, 'title is required.');
    if (next.length > 100) throw new HttpError(400, 'title must be 100 characters or fewer.');
    project.title = next;
    project.updated_at = this.clock.nowIso();
    await this.repo.saveProject(project);
    return project;
  }

  async remove(projectId: string): Promise<void> {
    const project = await this.require(projectId);
    if (project.cursor_agent_id) {
      await this.cursor.archiveAgent(project.cursor_agent_id);
    }
    const tasks = await this.repo.listTasks(projectId);
    for (const task of tasks) {
      if (task.cursor_agent_id) {
        await this.cursor.archiveAgent(task.cursor_agent_id);
      }
    }
    await this.repo.deleteProject(projectId);
  }

  private async require(projectId: string): Promise<Project> {
    const project = await this.repo.getProject(projectId);
    if (!project) throw new HttpError(404, 'Project not found.');
    return project;
  }
}
