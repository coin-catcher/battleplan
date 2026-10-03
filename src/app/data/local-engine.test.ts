import { describe, expect, it } from 'vitest';
import type { ChatArtifact, ChatMessage, Project, ProjectTask, TaskCodeOutput, TaskResearchOutput } from '../core/models';
import type { CursorClient } from './cursor-browser';
import { LocalEngine } from './local-engine';
import type { BattleplanRepository } from './repository';

class MemoryRepository implements BattleplanRepository {
  projects = new Map<string, Project>();
  tasks = new Map<string, ProjectTask>();
  code = new Map<string, TaskCodeOutput>();
  research = new Map<string, TaskResearchOutput>();
  messages: ChatMessage[] = [];
  artifacts: ChatArtifact[] = [];

  async saveProject(project: Project): Promise<void> { this.projects.set(project.project_id, { ...project }); }
  async getProject(projectId: string): Promise<Project | null> { return this.projects.get(projectId) ?? null; }
  async listProjects(): Promise<Project[]> { return [...this.projects.values()]; }
  async deleteProject(projectId: string): Promise<void> { this.projects.delete(projectId); }
  async saveTask(task: ProjectTask): Promise<void> { this.tasks.set(task.task_id, { ...task, dependencies: [...task.dependencies] }); }
  async saveTasks(tasks: ProjectTask[]): Promise<void> { for (const task of tasks) await this.saveTask(task); }
  async getTask(taskId: string): Promise<ProjectTask | null> { return this.tasks.get(taskId) ?? null; }
  async listTasks(projectId: string): Promise<ProjectTask[]> {
    return [...this.tasks.values()].filter((task) => task.project_id === projectId);
  }
  async deleteTask(taskId: string): Promise<void> { this.tasks.delete(taskId); }
  async getCodeOutput(taskId: string): Promise<TaskCodeOutput | null> { return this.code.get(taskId) ?? null; }
  async saveCodeOutput(output: TaskCodeOutput): Promise<void> { this.code.set(output.task_id, output); }
  async getResearchOutput(taskId: string): Promise<TaskResearchOutput | null> { return this.research.get(taskId) ?? null; }
  async saveResearchOutput(output: TaskResearchOutput): Promise<void> { this.research.set(output.task_id, output); }
  async listProjectMessages(projectId: string): Promise<ChatMessage[]> {
    return this.messages.filter((message) => message.scope === 'project' && message.project_id === projectId);
  }
  async listTaskMessages(taskId: string): Promise<ChatMessage[]> {
    return this.messages.filter((message) => message.scope === 'task' && message.task_id === taskId);
  }
  async saveMessage(message: ChatMessage): Promise<void> { this.messages.push(message); }
  async listArtifacts(): Promise<ChatArtifact[]> { return this.artifacts; }
  async saveArtifact(artifact: ChatArtifact): Promise<void> { this.artifacts.push(artifact); }
}

function cursor(): CursorClient & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    async createAgent(input) {
      prompts.push(input.prompt);
      return {
        agent: { id: 'agent-1', name: 'Landscape plan', status: 'RUNNING', url: 'https://cursor.com/agents/agent-1' },
        run: { id: 'run-1', agentId: 'agent-1', status: 'RUNNING' },
      };
    },
    async archiveAgent() {},
    async createRun() { return { id: 'run-2', agentId: 'agent-1', status: 'RUNNING' }; },
    async listRuns() { return []; },
    async getRun() { return { id: 'run-1', agentId: 'agent-1', status: 'RUNNING' }; },
    async listArtifacts() { return []; },
    async downloadArtifact() { return { url: 'https://example.test/file', expiresAt: '2099-01-01T00:00:00.000Z' }; },
  };
}

describe('LocalEngine', () => {
  it('stores a project and the opening prompt locally', async () => {
    const repo = new MemoryRepository();
    const client = cursor();
    let tick = 0;
    const engine = new LocalEngine(repo, client, () => `2026-10-02T00:00:0${tick++}.000Z`, () => `id-${tick}`);
    const project = await engine.createProject({
      initial_prompt: 'Map the deletion landscape',
      repo_url: 'https://github.com/coin-catcher/custom',
      starting_ref: 'main',
    });
    expect(project.title).toBe('Landscape plan');
    expect(project.cursor_agent_id).toBe('agent-1');
    expect(client.prompts).toEqual(['Map the deletion landscape']);
    const page = await engine.listProjectMessages(project.project_id);
    expect(page.messages.map((message) => message.content)).toEqual(['Map the deletion landscape']);
    expect(repo.projects.size).toBe(1);
  });

  it('persists map coordinates when creating a task', async () => {
    const repo = new MemoryRepository();
    const engine = new LocalEngine(repo, cursor(), () => '2026-10-02T00:00:00.000Z', () => 'id-1');
    await repo.saveProject({
      project_id: 'p1',
      title: 'Plan',
      initial_prompt: 'Plan',
      cursor_chat_link: 'https://cursor.com/agents/agent-1',
      created_at: '2026-10-02T00:00:00.000Z',
      updated_at: '2026-10-02T00:00:00.000Z',
    });
    const task = await engine.createTask('p1', { map_x: 120, map_y: 340 });
    expect(task.map_x).toBe(120);
    expect(task.map_y).toBe(340);
  });

  it('marks a task BLOCKED without calling Cursor', async () => {
    const repo = new MemoryRepository();
    const client = cursor();
    let tick = 0;
    const engine = new LocalEngine(repo, client, () => `2026-10-02T00:00:0${tick++}.000Z`, () => `id-${tick}`);
    await repo.saveProject({
      project_id: 'p1',
      title: 'Plan',
      initial_prompt: 'Plan',
      cursor_chat_link: 'https://cursor.com/agents/agent-1',
      created_at: '2026-10-02T00:00:00.000Z',
      updated_at: '2026-10-02T00:00:00.000Z',
    });
    const task = await engine.createTask('p1', { title: 'Map sources' });
    const blocked = await engine.transition('p1', task.task_id, 'BLOCKED', true);
    expect(blocked.status).toBe('BLOCKED');
    expect(client.prompts).toEqual([]);
    const notes = await repo.listTaskMessages(task.task_id);
    expect(notes.some((note) => note.content.includes('BLOCKED'))).toBe(true);
  });

  it('splits a both-output draft into research then code', async () => {
    const repo = new MemoryRepository();
    let tick = 0;
    const engine = new LocalEngine(
      repo,
      cursor(),
      () => `2026-10-02T00:00:0${tick}.000Z`,
      () => `id-${tick++}`,
    );
    await repo.saveProject({
      project_id: 'p1',
      title: 'Plan',
      initial_prompt: 'Plan',
      cursor_chat_link: 'https://cursor.com/agents/agent-1',
      created_at: '2026-10-02T00:00:00.000Z',
      updated_at: '2026-10-02T00:00:00.000Z',
    });
    const tasks = await engine.createTasks('p1', [{
      title: 'Survey vendors',
      prompt: 'Write up the vendors, then script the checks.',
      output_type: 'both',
      depends_on: [],
    }]);
    expect(tasks.map((task) => task.title)).toEqual(['Survey vendors (research)', 'Survey vendors (code)']);
    expect(tasks[1].dependencies).toEqual([tasks[0].task_id]);
  });
});
