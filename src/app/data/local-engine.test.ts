import { describe, expect, it, vi } from 'vitest';
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
  async saveTask(task: ProjectTask): Promise<void> {
    this.tasks.set(task.task_id, {
      ...task,
      dependencies: [...task.dependencies],
      sibling_dependencies: [...(task.sibling_dependencies ?? [])],
    });
  }
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
  async listPendingChanges(): Promise<import('../core/models').PendingChange[]> { return []; }
  async savePendingChanges(): Promise<void> { return; }
  agents = new Map<string, import('../core/models').ProjectAgent[]>();
  ledgers = new Map<string, Record<string, import('../core/models').AgentUsageLedger>>();
  async listProjectAgents(projectId: string): Promise<import('../core/models').ProjectAgent[]> {
    return this.agents.get(projectId) ?? [];
  }
  async saveProjectAgents(projectId: string, agents: import('../core/models').ProjectAgent[]): Promise<void> {
    this.agents.set(projectId, agents);
  }
  async getAgentUsageLedger(projectId: string): Promise<Record<string, import('../core/models').AgentUsageLedger>> {
    return this.ledgers.get(projectId) ?? {};
  }
  async saveAgentUsageLedger(
    projectId: string,
    ledger: Record<string, import('../core/models').AgentUsageLedger>,
  ): Promise<void> {
    this.ledgers.set(projectId, ledger);
  }
  ui = new Map<string, import('../core/project-ui-state').ProjectWorkspaceUiState>();
  async getProjectUiState(projectId: string): Promise<import('../core/project-ui-state').ProjectWorkspaceUiState | null> {
    return this.ui.get(projectId) ?? null;
  }
  async saveProjectUiState(
    projectId: string,
    state: import('../core/project-ui-state').ProjectWorkspaceUiState,
  ): Promise<void> {
    this.ui.set(projectId, state);
  }
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
    async streamRunText() { return undefined; },
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

  it('imports assistant text from a finished run when listRuns omits the result', async () => {
    const repo = new MemoryRepository();
    const client = cursor();
    client.listRuns = async () => [{
      id: 'run-1',
      agentId: 'agent-1',
      status: 'FINISHED',
    }];
    client.getRun = async () => ({
      id: 'run-1',
      agentId: 'agent-1',
      status: 'FINISHED',
      result: 'Here is the battleplan summary.',
    });
    const engine = new LocalEngine(repo, client, () => '2026-10-02T00:00:00.000Z', () => 'id-1');
    await repo.saveProject({
      project_id: 'p1',
      title: 'Plan',
      initial_prompt: 'Plan',
      cursor_chat_link: 'https://cursor.com/agents/agent-1',
      cursor_agent_id: 'agent-1',
      created_at: '2026-10-02T00:00:00.000Z',
      updated_at: '2026-10-02T00:00:00.000Z',
    });
    await repo.saveMessage({
      message_id: 'm-user',
      scope: 'project',
      project_id: 'p1',
      role: 'user',
      content: 'Plan this feature',
      created_at: '2026-10-02T00:00:00.000Z',
      run_id: 'run-1',
      intent: 'chat',
    });
    const page = await engine.listProjectMessages('p1');
    expect(page.messages.some((message) => message.role === 'assistant' && message.content.includes('battleplan summary'))).toBe(true);
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

  it('prepends task DAR to the first Cursor message while keeping chat separate', async () => {
    const repo = new MemoryRepository();
    const client = cursor();
    let tick = 0;
    const engine = new LocalEngine(repo, client, () => `2026-10-02T00:00:0${tick++}.000Z`, () => `id-${tick}`);
    await repo.saveProject({
      project_id: 'p1',
      title: 'Plan',
      initial_prompt: 'Plan',
      dar: 'Project rules',
      cursor_chat_link: 'https://cursor.com/agents/agent-1',
      repo_url: 'https://github.com/coin-catcher/custom',
      starting_ref: 'main',
      created_at: '2026-10-02T00:00:00.000Z',
      updated_at: '2026-10-02T00:00:00.000Z',
    });
    const task = await engine.createTask('p1', {
      title: 'Implement',
      output_type: 'code',
      dar: 'Task rules',
      initial_prompt: 'Please implement the feature.',
    });
    const sent = await engine.executeTask(task.task_id);
    expect(client.prompts[0]).toContain('Project rules');
    expect(client.prompts[0]).toContain('Task rules');
    expect(client.prompts[0]).toContain('Please implement the feature.');
    expect(sent.content).toBe('Please implement the feature.');
  });

  it('allows DAR updates after the agent starts without resubmitting initial prompt', async () => {
    const repo = new MemoryRepository();
    const client = cursor();
    let tick = 0;
    const engine = new LocalEngine(repo, client, () => `2026-10-02T00:00:0${tick++}.000Z`, () => `id-${tick}`);
    await repo.saveProject({
      project_id: 'p1',
      title: 'Plan',
      initial_prompt: 'Plan',
      cursor_chat_link: 'https://cursor.com/agents/agent-1',
      repo_url: 'https://github.com/coin-catcher/custom',
      starting_ref: 'main',
      created_at: '2026-10-02T00:00:00.000Z',
      updated_at: '2026-10-02T00:00:00.000Z',
    });
    const task = await engine.createTask('p1', {
      title: 'Implement',
      output_type: 'code',
      dar: 'Original rules',
      initial_prompt: 'Please implement the feature.',
    });
    await engine.executeTask(task.task_id);
    const updated = await engine.updateTask('p1', task.task_id, {
      dar: 'Revised rules',
      initial_prompt: 'Please implement the feature.',
    });
    expect(updated.dar).toBe('Revised rules');
  });

  it('defaults research task DAR and no default for code tasks', async () => {
    const repo = new MemoryRepository();
    let tick = 0;
    const engine = new LocalEngine(repo, cursor(), () => '2026-10-02T00:00:00.000Z', () => `id-${tick++}`);
    await repo.saveProject({
      project_id: 'p1',
      title: 'Plan',
      initial_prompt: 'Plan',
      cursor_chat_link: 'https://cursor.com/agents/agent-1',
      created_at: '2026-10-02T00:00:00.000Z',
      updated_at: '2026-10-02T00:00:00.000Z',
    });
    const research = await engine.createTask('p1', { output_type: 'research', title: 'Research' });
    const code = await engine.createTask('p1', { output_type: 'code', title: 'Code' });
    expect(research.dar).toContain('list of tasks');
    expect(code.dar ?? '').toBe('');
  });

  it('createTasks with graph edges ignores stale project edges and validates', async () => {
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
      task_graph_edges: [{
        edge_id: 'fork:ghost->gone',
        from_task_id: 'ghost',
        to_task_id: 'gone',
        kind: 'fork',
      }],
    });
    const research = await engine.createTask('p1', { title: 'Research parent', output_type: 'research' });
    await engine.createTasks('p1', [
      { title: 'Architect contracts', prompt: 'Doc only', output_type: 'research', depends_on: [] },
      { title: 'Implement edge fn', prompt: 'Code', output_type: 'code', depends_on: ['Architect contracts'] },
    ], research.task_id, [
      { from: 'Architect contracts', to: 'Implement edge fn', kind: 'fork' },
    ]);
    const project = await repo.getProject('p1');
    expect(project?.task_graph_edges?.some((edge) => edge.from_task_id === 'ghost')).toBe(false);
    expect(project?.task_graph_edges?.some((edge) => edge.kind === 'fork')).toBe(true);
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
    expect(tasks[0].dependencies).toEqual([tasks[1].task_id]);
    expect(tasks[1].dependencies).toEqual([]);
  });

  it('links a connected task on the source task instead of the new task', async () => {
    const repo = new MemoryRepository();
    let tick = 0;
    const engine = new LocalEngine(repo, cursor(), () => '2026-10-02T00:00:00.000Z', () => `task-${tick++}`);
    await repo.saveProject({
      project_id: 'p1',
      title: 'Plan',
      initial_prompt: 'Plan',
      cursor_chat_link: 'https://cursor.com/agents/agent-1',
      created_at: '2026-10-02T00:00:00.000Z',
      updated_at: '2026-10-02T00:00:00.000Z',
    });
    const parent = await engine.createTask('p1', { title: 'Parent' });
    const child = await engine.createTask('p1', { title: 'Child', depends_on: parent.task_id });
    const savedParent = await repo.getTask(parent.task_id);
    const savedChild = await repo.getTask(child.task_id);
    expect(savedParent?.dependencies).toEqual([child.task_id]);
    expect(savedChild?.dependencies).toEqual([]);
  });

  it('allows a child task to execute while its parent is still TODO', async () => {
    const repo = new MemoryRepository();
    const client = cursor();
    let tick = 0;
    const engine = new LocalEngine(repo, client, () => '2026-10-02T00:00:00.000Z', () => `task-${tick++}`);
    await repo.saveProject({
      project_id: 'p1',
      title: 'Plan',
      initial_prompt: 'Plan',
      cursor_chat_link: 'https://cursor.com/agents/agent-1',
      repo_url: 'https://github.com/coin-catcher/custom',
      starting_ref: 'main',
      created_at: '2026-10-02T00:00:00.000Z',
      updated_at: '2026-10-02T00:00:00.000Z',
    });
    const parent = await engine.createTask('p1', { title: 'Parent', output_type: 'code' });
    const child = await engine.createTask('p1', {
      title: 'Child',
      output_type: 'code',
      depends_on: parent.task_id,
      initial_prompt: 'Go',
    });
    expect((await repo.getTask(parent.task_id))?.dependencies).toContain(child.task_id);
    await engine.executeTask(child.task_id);
    expect(client.prompts.length).toBe(1);
  });

  it('abandons child tasks when a parent is abandoned', async () => {
    const repo = new MemoryRepository();
    let tick = 0;
    const engine = new LocalEngine(repo, cursor(), () => '2026-10-02T00:00:00.000Z', () => `task-${tick++}`);
    await repo.saveProject({
      project_id: 'p1',
      title: 'Plan',
      initial_prompt: 'Plan',
      cursor_chat_link: 'https://cursor.com/agents/agent-1',
      created_at: '2026-10-02T00:00:00.000Z',
      updated_at: '2026-10-02T00:00:00.000Z',
    });
    const parent = await engine.createTask('p1', { title: 'Parent' });
    const child = await engine.createTask('p1', { title: 'Child', depends_on: parent.task_id });
    await engine.transition('p1', parent.task_id, 'ABANDONED', true);
    const savedChild = await repo.getTask(child.task_id);
    expect(savedChild?.status).toBe('ABANDONED');
  });

  it('executes available child tasks in parallel batches', async () => {
    const repo = new MemoryRepository();
    const client = cursor();
    let tick = 0;
    const engine = new LocalEngine(repo, client, () => '2026-10-02T00:00:00.000Z', () => `task-${tick++}`);
    await repo.saveProject({
      project_id: 'p1',
      title: 'Plan',
      initial_prompt: 'Plan',
      cursor_chat_link: 'https://cursor.com/agents/agent-1',
      repo_url: 'https://github.com/coin-catcher/custom',
      starting_ref: 'main',
      created_at: '2026-10-02T00:00:00.000Z',
      updated_at: '2026-10-02T00:00:00.000Z',
    });
    const parent = await engine.createTask('p1', { title: 'Parent', output_type: 'code' });
    const left = await engine.createTask('p1', {
      title: 'Left',
      output_type: 'code',
      depends_on: parent.task_id,
      initial_prompt: 'Left go',
    });
    const right = await engine.createTask('p1', {
      title: 'Right',
      output_type: 'code',
      depends_on: parent.task_id,
      initial_prompt: 'Right go',
    });
    const started = await engine.executeChildren('p1', parent.task_id);
    expect(started.map((task) => task.task_id).sort()).toEqual([left.task_id, right.task_id].sort());
    expect(client.prompts.length).toBe(2);
  });

  it('allows chat after Start Discovery without Execute', async () => {
    const repo = new MemoryRepository();
    const engine = new LocalEngine(repo, cursor(), () => '2026-10-02T00:00:00.000Z', () => 'id-1');
    await repo.saveProject({
      project_id: 'p1',
      title: 'Plan',
      initial_prompt: 'Plan',
      cursor_chat_link: 'https://cursor.com/agents/agent-1',
      cursor_agent_id: 'agent-1',
      repo_url: 'https://github.com/coin-catcher/custom',
      created_at: '2026-10-02T00:00:00.000Z',
      updated_at: '2026-10-02T00:00:00.000Z',
      discovery_session: {
        source_task_id: 'task-disc',
        mode: 'depth_first',
        phase: 'partition',
        active_graph_id: 'graph-1',
        active_graph_goal: 'Discovery',
        layer: 1,
      },
    });
    const task = await engine.createTask('p1', {
      title: 'Brainstorm feature',
      output_type: 'research',
      initial_prompt: 'Rough goal',
      node_kind: 'brainstorm',
    });
    task.task_id = 'task-disc';
    await repo.saveTask(task);
    await engine.generateLayeredTaskTasks('task-disc', 1, 'Start Discovery partition pass');
    const linked = await repo.getTask('task-disc');
    expect(linked?.cursor_agent_id).toBe('agent-1');
    expect(linked?.status).toBe('DOING');
    await expect(engine.sendTaskMessage('task-disc', 'approve 1')).resolves.toBeDefined();
  });

  it('marks a task DOING when chat feedback is sent', async () => {
    const repo = new MemoryRepository();
    const engine = new LocalEngine(repo, cursor(), () => '2026-10-02T00:00:00.000Z', () => 'id-1');
    await repo.saveProject({
      project_id: 'p1',
      title: 'Plan',
      initial_prompt: 'Plan',
      cursor_chat_link: 'https://cursor.com/agents/agent-1',
      cursor_agent_id: 'agent-1',
      repo_url: 'https://github.com/coin-catcher/custom',
      created_at: '2026-10-02T00:00:00.000Z',
      updated_at: '2026-10-02T00:00:00.000Z',
    });
    const task = await engine.createTask('p1', {
      title: 'Work',
      output_type: 'code',
      initial_prompt: 'Go',
    });
    task.cursor_agent_id = 'agent-task';
    task.status = 'TODO';
    await repo.saveTask(task);
    await engine.sendTaskMessage(task.task_id, 'Keep going');
    expect((await repo.getTask(task.task_id))?.status).toBe('DOING');
  });

  it('moves a DOING project to REVIEW after a version bump agent run', async () => {
    const repo = new MemoryRepository();
    const client = cursor();
    client.listRuns = async () => [{
      id: 'run-version',
      agentId: 'agent-1',
      status: 'FINISHED',
      result: 'Branch name: cursor/release-1.0.13',
    }];
    client.getRun = async () => ({
      id: 'run-version',
      agentId: 'agent-1',
      status: 'FINISHED',
      result: 'Branch name: cursor/release-1.0.13',
      git: { branches: [{ branch: 'cursor/release-1.0.13' }] },
    });
    const engine = new LocalEngine(repo, client, () => '2026-10-09T12:00:00.000Z', () => 'id-1');
    await repo.saveProject({
      project_id: 'p1',
      title: 'Plan',
      initial_prompt: 'Plan',
      cursor_chat_link: 'https://cursor.com/agents/agent-1',
      cursor_agent_id: 'agent-1',
      status: 'DOING',
      latest_run_id: 'run-version',
      github_pat: 'ghp_test',
      repo_url: 'https://github.com/coin-catcher/custom',
      starting_ref: 'develop',
      created_at: '2026-10-09T00:00:00.000Z',
      updated_at: '2026-10-09T00:00:00.000Z',
    });
    await repo.saveMessage({
      message_id: 'm-user',
      scope: 'project',
      project_id: 'p1',
      role: 'user',
      content: 'bump version',
      created_at: '2026-10-09T00:00:00.000Z',
      run_id: 'run-version',
      intent: 'release_version_bump',
    });
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/compare/')) {
        return new Response(JSON.stringify({ ahead_by: 1, commits: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const page = await engine.listProjectMessages('p1');
    expect(page.project?.status).toBe('REVIEW');
    expect(page.project?.release_version_branch).toBe('cursor/release-1.0.13');
    vi.unstubAllGlobals();
  });

  it('moves a DOING root project to REVIEW after a normal agent run', async () => {
    const repo = new MemoryRepository();
    const client = cursor();
    client.listRuns = async () => [{
      id: 'run-chat',
      agentId: 'agent-1',
      status: 'FINISHED',
      result: 'Here is the updated plan.',
    }];
    client.getRun = async () => ({
      id: 'run-chat',
      agentId: 'agent-1',
      status: 'FINISHED',
      result: 'Here is the updated plan.',
    });
    const engine = new LocalEngine(repo, client, () => '2026-10-09T12:00:00.000Z', () => 'id-1');
    await repo.saveProject({
      project_id: 'p1',
      title: 'Plan',
      initial_prompt: 'Plan',
      cursor_chat_link: 'https://cursor.com/agents/agent-1',
      cursor_agent_id: 'agent-1',
      status: 'DOING',
      latest_run_id: 'run-chat',
      created_at: '2026-10-09T00:00:00.000Z',
      updated_at: '2026-10-09T00:00:00.000Z',
    });
    await repo.saveMessage({
      message_id: 'm-user',
      scope: 'project',
      project_id: 'p1',
      role: 'user',
      content: 'Continue planning',
      created_at: '2026-10-09T00:00:00.000Z',
      run_id: 'run-chat',
      intent: 'chat',
    });
    const page = await engine.listProjectMessages('p1');
    expect(page.project?.status).toBe('REVIEW');
  });

  it('marks the root project DOING when project chat is sent', async () => {
    const repo = new MemoryRepository();
    const engine = new LocalEngine(repo, cursor(), () => '2026-10-02T00:00:00.000Z', () => 'id-1');
    await repo.saveProject({
      project_id: 'p1',
      title: 'Plan',
      initial_prompt: 'Plan',
      cursor_chat_link: 'https://cursor.com/agents/agent-1',
      cursor_agent_id: 'agent-1',
      created_at: '2026-10-02T00:00:00.000Z',
      updated_at: '2026-10-02T00:00:00.000Z',
    });
    await engine.sendProjectMessage('p1', 'Continue planning');
    expect((await repo.getProject('p1'))?.status).toBe('DOING');
  });

  it('moves a DOING task to REVIEW when the agent run finishes', async () => {
    const repo = new MemoryRepository();
    const client = cursor();
    client.listRuns = async () => [{
      id: 'run-1',
      agentId: 'agent-1',
      status: 'FINISHED',
      result: 'Done.',
    }];
    client.getRun = async () => ({
      id: 'run-1',
      agentId: 'agent-1',
      status: 'FINISHED',
      result: 'Done.',
    });
    const engine = new LocalEngine(repo, client, () => '2026-10-02T00:00:00.000Z', () => 'id-1');
    await repo.saveProject({
      project_id: 'p1',
      title: 'Plan',
      initial_prompt: 'Plan',
      cursor_chat_link: 'https://cursor.com/agents/agent-1',
      repo_url: 'https://github.com/coin-catcher/custom',
      created_at: '2026-10-02T00:00:00.000Z',
      updated_at: '2026-10-02T00:00:00.000Z',
    });
    await repo.saveTask({
      task_id: 't1',
      project_id: 'p1',
      title: 'Work',
      prompt: '',
      dependencies: [],
      status: 'DOING',
      output_type: 'code',
      order: 0,
      cursor_agent_id: 'agent-1',
      latest_run_id: 'run-1',
      created_at: '2026-10-02T00:00:00.000Z',
      updated_at: '2026-10-02T00:00:00.000Z',
    });
    await repo.saveMessage({
      message_id: 'm-user',
      scope: 'task',
      project_id: 'p1',
      task_id: 't1',
      role: 'user',
      content: 'Go',
      created_at: '2026-10-02T00:00:00.000Z',
      run_id: 'run-1',
      intent: 'chat',
    });
    const page = await engine.listTaskMessages('t1');
    expect(page.task.status).toBe('REVIEW');
    expect(page.messages.some((message) => message.role === 'assistant')).toBe(true);
  });

  it('routes bound research tasks to a non-Cursor library agent', async () => {
    const repo = new MemoryRepository();
    const client = cursor();
    const engine = new LocalEngine(repo, client, () => '2026-10-09T12:00:00.000Z', () => 'id-1');
    await repo.saveProject({
      project_id: 'p1',
      title: 'Plan',
      initial_prompt: 'Plan',
      cursor_chat_link: 'https://cursor.com/agents/agent-1',
      created_at: '2026-10-09T00:00:00.000Z',
      updated_at: '2026-10-09T00:00:00.000Z',
    });
    const openAiAgent: import('../core/models').ProjectAgent = {
      agent_id: 'research-openai',
      kind: 'research',
      type: 'OpenAI',
      name: 'OpenAI Research',
      url: 'https://api.openai.com/v1',
      api_key: 'sk-test',
      options: { model: 'gpt-4.1-mini' },
      created_at: '2026-10-09T00:00:00.000Z',
      updated_at: '2026-10-09T00:00:00.000Z',
    };
    await repo.saveProjectAgents('p1', [openAiAgent]);
    const task = await engine.createTask('p1', {
      title: 'Research',
      output_type: 'research',
      initial_prompt: 'Summarize options',
    });
    task.research_agent_id = openAiAgent.agent_id;
    await repo.saveTask(task);

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'Here are the findings.' } }],
      usage: { total_tokens: 42 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await engine.executeTask(task.task_id);
    expect(client.prompts.length).toBe(0);
    expect(fetchMock).toHaveBeenCalled();
    expect((await repo.getTask(task.task_id))?.status).toBe('REVIEW');
    const messages = await repo.listTaskMessages(task.task_id);
    expect(messages.some((message) => message.role === 'assistant' && message.content.includes('findings'))).toBe(true);
    const ledger = await repo.getAgentUsageLedger('p1');
    expect(ledger[openAiAgent.agent_id]?.requests_period).toBe(1);
    vi.unstubAllGlobals();
  });

  it('blocks execution for abandoned tasks', async () => {
    const repo = new MemoryRepository();
    const engine = new LocalEngine(repo, cursor(), () => '2026-10-02T00:00:00.000Z', () => 'id-1');
    await repo.saveProject({
      project_id: 'p1',
      title: 'Plan',
      initial_prompt: 'Plan',
      cursor_chat_link: 'https://cursor.com/agents/agent-1',
      repo_url: 'https://github.com/coin-catcher/custom',
      created_at: '2026-10-02T00:00:00.000Z',
      updated_at: '2026-10-02T00:00:00.000Z',
    });
    const task = await engine.createTask('p1', { title: 'Work', output_type: 'code', initial_prompt: 'Go' });
    await engine.transition('p1', task.task_id, 'ABANDONED', true);
    await expect(engine.executeTask(task.task_id)).rejects.toThrow(/abandoned/i);
  });
});
