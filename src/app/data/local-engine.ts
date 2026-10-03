import type {
  ChatArtifact,
  ChatMessage,
  OutputType,
  Project,
  ProjectTask,
  TaskCodeOutput,
  TaskDraft,
  TaskResearchOutput,
  TaskStatus,
} from '../core/models';
import { TASK_STATUSES } from '../core/models';
import type { CursorClient, CursorRun } from './cursor-browser';
import { normalizeRepoUrl } from './cursor-browser';
import type { BattleplanRepository } from './repository';

const TERMINAL_RUN = new Set(['FINISHED', 'ERROR', 'CANCELLED', 'CANCELED', 'FAILED', 'EXPIRED']);
const TEXT_ARTIFACT = /\.(md|markdown|txt|json|csv|ya?ml|html|log|xml|tsv|rst)$/i;
const IMAGE_ARTIFACT = /\.(png|jpe?g|gif|webp|svg)$/i;
const MAX_TEXT_BYTES = 200_000;
const MAX_TEXT_CHARS = 100_000;

const GUIDED: Record<TaskStatus, TaskStatus[]> = {
  TODO: ['DOING', 'BLOCKED', 'ABANDONED'],
  DOING: ['REVIEW', 'DONE', 'BLOCKED', 'ABANDONED'],
  REVIEW: ['DOING', 'DONE', 'BLOCKED', 'ABANDONED'],
  BLOCKED: ['TODO', 'DOING', 'ABANDONED'],
  DONE: [],
  ABANDONED: [],
};

const GENERATE_TASKS_INSTRUCTION = [
  'Generate an ordered list of project tasks based on the agreed decisions in this battleplan.',
  'Return only a JSON array, with no markdown and no commentary.',
  'Each item must be an object with:',
  '- "title": string, a short task name',
  '- "prompt": string, the instruction the executing agent should follow',
  '- "output_type": "code" or "research"',
  '- "depends_on": array of task titles this task depends on',
  'A task must declare exactly one output type. If work needs both research and code, emit two tasks.',
  'Order the array so each task appears after the tasks it depends on.',
].join('\n');

export interface ConversationPage {
  messages: ChatMessage[];
  artifacts: ChatArtifact[];
}

interface NormalizedDraft {
  title: string;
  prompt: string;
  output_type: OutputType;
  depends_on: string[];
}

export class LocalEngine {
  constructor(
    private readonly repo: BattleplanRepository,
    private readonly cursor: CursorClient,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  listProjects(): Promise<Project[]> {
    return this.repo.listProjects();
  }

  async createProject(input: { initial_prompt: string; repo_url?: string; starting_ref?: string }): Promise<Project> {
    const initialPrompt = input.initial_prompt?.trim();
    if (!initialPrompt) throw new Error('initial_prompt is required.');
    const created = await this.cursor.createAgent({
      prompt: initialPrompt,
      mode: 'plan',
      repoUrl: input.repo_url?.trim() || undefined,
      startingRef: input.starting_ref?.trim() || undefined,
      autoCreatePr: false,
    });
    const timestamp = this.now();
    const project: Project = {
      project_id: this.newId(),
      title: created.agent.name?.trim() || 'Untitled battleplan',
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
      message_id: this.newId(),
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

  async updateProject(projectId: string, patch: {
    title?: string;
    repo_url?: string;
    starting_ref?: string;
    map_x?: number;
    map_y?: number;
  }): Promise<Project> {
    const project = await this.requireProject(projectId);
    const changes: string[] = [];
    if (patch.title !== undefined) {
      const next = patch.title.trim();
      if (!next) throw new Error('title is required.');
      if (next.length > 100) throw new Error('title must be 100 characters or fewer.');
      if (next !== project.title) changes.push(`Title: ${next}`);
      project.title = next;
    }
    if (patch.repo_url !== undefined) {
      const next = patch.repo_url.trim();
      if (next !== (project.repo_url ?? '')) changes.push(`Repository: ${next || 'cleared'}`);
      project.repo_url = next || undefined;
    }
    if (patch.starting_ref !== undefined) {
      const next = patch.starting_ref.trim();
      if (next !== (project.starting_ref ?? '')) changes.push(`Base branch: ${next || 'main'}`);
      project.starting_ref = next || undefined;
    }
    if (patch.map_x !== undefined) project.map_x = patch.map_x;
    if (patch.map_y !== undefined) project.map_y = patch.map_y;
    project.updated_at = this.now();
    await this.repo.saveProject(project);
    if (changes.length > 0) {
      await this.repo.saveMessage({
        message_id: this.newId(),
        scope: 'project',
        project_id: project.project_id,
        role: 'change',
        content: changes.join('\n'),
        created_at: this.now(),
        intent: 'chat',
      });
    }
    return project;
  }

  async deleteProject(projectId: string): Promise<void> {
    const project = await this.requireProject(projectId);
    if (project.cursor_agent_id) await this.cursor.archiveAgent(project.cursor_agent_id);
    const tasks = await this.repo.listTasks(projectId);
    for (const task of tasks) {
      if (task.cursor_agent_id) await this.cursor.archiveAgent(task.cursor_agent_id);
    }
    await this.repo.deleteProject(projectId);
  }

  async listTasks(projectId: string): Promise<ProjectTask[]> {
    await this.requireProject(projectId);
    return this.repo.listTasks(projectId);
  }

  async createTask(projectId: string, input: {
    title?: string;
    prompt?: string;
    output_type?: OutputType;
    depends_on?: string;
    map_x?: number;
    map_y?: number;
  }): Promise<ProjectTask> {
    await this.requireProject(projectId);
    const existing = await this.repo.listTasks(projectId);
    const title = input.title?.trim() || 'New task';
    const prompt = input.prompt?.trim() || 'Describe what this task should do.';
    const outputType = input.output_type ?? 'code';
    if (outputType !== 'code' && outputType !== 'research') throw new Error('output_type must be code or research.');
    const dependencies = input.depends_on ? [input.depends_on] : [];
    if (dependencies.some((id) => !existing.some((task) => task.task_id === id))) {
      throw new Error('depends_on must be a task in this project.');
    }
    const timestamp = this.now();
    const task: ProjectTask = {
      task_id: this.newId(),
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
    if (input.map_x !== undefined) task.map_x = input.map_x;
    if (input.map_y !== undefined) task.map_y = input.map_y;
    assertAcyclic([...existing, task]);
    await this.repo.saveTask(task);
    const parent = dependencies[0] ? existing.find((item) => item.task_id === dependencies[0]) : undefined;
    await this.repo.saveMessage(this.taskNote(
      task,
      parent ? `Created task connected to "${parent.title}".` : 'Created task connected to the project.',
    ));
    return task;
  }

  async createTasks(projectId: string, drafts: TaskDraft[]): Promise<ProjectTask[]> {
    await this.requireProject(projectId);
    const normalized = normalizeDrafts(drafts);
    const existing = await this.repo.listTasks(projectId);
    const timestamp = this.now();
    const created: ProjectTask[] = normalized.map((draft, index) => ({
      task_id: this.newId(),
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
    bindDependencies(existing, created, normalized);
    assertAcyclic([...existing, ...created]);
    await this.repo.saveTasks(created);
    return created;
  }

  async updateTask(projectId: string, taskId: string, patch: {
    title?: string;
    prompt?: string;
    dependencies?: string[];
    output_type?: OutputType;
    status?: TaskStatus;
    manual?: boolean;
    map_x?: number;
    map_y?: number;
  }): Promise<ProjectTask> {
    const task = await this.requireTask(projectId, taskId);
    const changes: string[] = [];
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) throw new Error('title is required.');
      if (title !== task.title) changes.push(`Title: ${title}`);
      task.title = title;
    }
    if (patch.prompt !== undefined) {
      const prompt = patch.prompt.trim();
      if (!prompt) throw new Error('prompt is required.');
      if (prompt !== task.prompt) changes.push('Prompt updated.');
      task.prompt = prompt;
    }
    if (patch.output_type !== undefined) {
      if (patch.output_type !== 'code' && patch.output_type !== 'research') {
        throw new Error('output_type must be code or research.');
      }
      if (patch.output_type !== task.output_type) {
        const other = task.output_type === 'code'
          ? await this.repo.getResearchOutput(taskId)
          : await this.repo.getCodeOutput(taskId);
        if (other) throw new Error('Split mixed outputs into two tasks instead of changing output_type.');
        changes.push(`Output: ${patch.output_type}`);
      }
      task.output_type = patch.output_type;
    }
    if (patch.dependencies !== undefined) {
      const nextDependencies = [...new Set(patch.dependencies)];
      if (nextDependencies.join(',') !== task.dependencies.join(',')) changes.push('Dependencies updated.');
      task.dependencies = nextDependencies;
      const tasks = (await this.repo.listTasks(projectId)).map((item) => item.task_id === task.task_id ? task : item);
      assertAcyclic(tasks);
    }
    if (patch.status !== undefined) {
      if (!isStatus(patch.status)) throw new Error('Unknown task status.');
      if (patch.status !== task.status) changes.push(`Status: ${patch.status}`);
      await this.applyStatus(task, patch.status, Boolean(patch.manual));
    }
    if (patch.map_x !== undefined) task.map_x = patch.map_x;
    if (patch.map_y !== undefined) task.map_y = patch.map_y;
    task.updated_at = this.now();
    await this.repo.saveTask(task);
    if (changes.length > 0) await this.repo.saveMessage(this.taskNote(task, changes.join('\n')));
    return task;
  }

  transition(projectId: string, taskId: string, status: TaskStatus, manual: boolean): Promise<ProjectTask> {
    return this.updateTask(projectId, taskId, { status, manual });
  }

  async deleteTask(projectId: string, taskId: string): Promise<void> {
    const task = await this.requireTask(projectId, taskId);
    if (task.cursor_agent_id) await this.cursor.archiveAgent(task.cursor_agent_id);
    await this.repo.deleteTask(taskId);
  }

  async reorderTasks(projectId: string, taskIds: string[]): Promise<ProjectTask[]> {
    await this.requireProject(projectId);
    const tasks = await this.repo.listTasks(projectId);
    if (taskIds.length !== tasks.length || new Set(taskIds).size !== taskIds.length) {
      throw new Error('Reorder must include each task in the project exactly once.');
    }
    const byId = new Map(tasks.map((task) => [task.task_id, task]));
    const timestamp = this.now();
    const ordered = taskIds.map((taskId, order) => {
      const task = byId.get(taskId);
      if (!task) throw new Error(`Unknown task ${taskId}.`);
      return { ...task, order, updated_at: timestamp };
    });
    await this.repo.saveTasks(ordered);
    return ordered;
  }

  getCodeOutput(taskId: string): Promise<TaskCodeOutput | null> {
    return this.repo.getCodeOutput(taskId);
  }

  async saveCodeOutput(taskId: string, output: Omit<TaskCodeOutput, 'task_id'>): Promise<TaskCodeOutput> {
    const saved = { ...output, task_id: taskId };
    await this.repo.saveCodeOutput(saved);
    return saved;
  }

  getResearchOutput(taskId: string): Promise<TaskResearchOutput | null> {
    return this.repo.getResearchOutput(taskId);
  }

  async saveResearchOutput(taskId: string, output: Omit<TaskResearchOutput, 'task_id'>): Promise<TaskResearchOutput> {
    const saved = { ...output, task_id: taskId };
    await this.repo.saveResearchOutput(saved);
    return saved;
  }

  async listProjectMessages(projectId: string): Promise<ConversationPage> {
    const project = await this.requireProject(projectId);
    if (project.cursor_agent_id) {
      await this.importFinishedRuns(project.cursor_agent_id, { scope: 'project', projectId });
      await this.syncArtifacts(project.cursor_agent_id, { scope: 'project', projectId });
    }
    return {
      messages: await this.repo.listProjectMessages(projectId),
      artifacts: await this.repo.listArtifacts('project', projectId),
    };
  }

  async sendProjectMessage(projectId: string, message: string): Promise<ChatMessage> {
    return this.dispatchProject(projectId, message, 'chat');
  }

  generateTasks(projectId: string): Promise<ChatMessage> {
    return this.dispatchProject(projectId, GENERATE_TASKS_INSTRUCTION, 'generate_tasks');
  }

  async generateTaskTasks(taskId: string): Promise<ChatMessage> {
    const task = await this.requireTaskById(taskId);
    const project = await this.requireProject(task.project_id);
    const agentId = task.cursor_agent_id || project.cursor_agent_id;
    if (!agentId) throw new Error('This project is not linked to a Cursor agent.');
    const text = [
      `Generate tasks from the conversation for "${task.title}".`,
      task.prompt ? `Task prompt:\n${task.prompt}` : '',
      GENERATE_TASKS_INSTRUCTION,
    ].filter(Boolean).join('\n\n');
    const run = await this.cursor.createRun(agentId, {
      text,
      mode: task.cursor_agent_id ? 'agent' : 'plan',
    });
    return this.record({
      scope: 'task',
      project_id: task.project_id,
      task_id: taskId,
      role: 'user',
      content: text,
      run_id: run.id,
      intent: 'generate_tasks',
      cursor_agent_id: agentId,
    });
  }

  async noteProject(projectId: string, message: string): Promise<ChatMessage> {
    const text = message.trim();
    if (!text) throw new Error('message is required.');
    const project = await this.requireProject(projectId);
    return this.record({
      scope: 'project',
      project_id: project.project_id,
      role: 'change',
      content: text,
      intent: 'chat',
    });
  }

  async noteTask(taskId: string, message: string): Promise<ChatMessage> {
    const text = message.trim();
    if (!text) throw new Error('message is required.');
    const task = await this.requireTaskById(taskId);
    return this.record({
      scope: 'task',
      project_id: task.project_id,
      task_id: task.task_id,
      role: 'change',
      content: text,
      intent: 'chat',
    });
  }

  async listTaskMessages(taskId: string): Promise<{ messages: ChatMessage[]; task: ProjectTask; artifacts: ChatArtifact[] }> {
    const task = await this.requireTaskById(taskId);
    if (task.cursor_agent_id) {
      await this.importFinishedRuns(task.cursor_agent_id, { scope: 'task', projectId: task.project_id, taskId });
      await this.syncArtifacts(task.cursor_agent_id, { scope: 'task', projectId: task.project_id, taskId });
    }
    await this.importReferencedRuns({ scope: 'task', projectId: task.project_id, taskId });
    const updated = await this.repo.getTask(taskId);
    return {
      messages: await this.repo.listTaskMessages(taskId),
      task: updated ?? task,
      artifacts: await this.repo.listArtifacts('task', taskId),
    };
  }

  async sendTaskMessage(taskId: string, text: string): Promise<ChatMessage> {
    const task = await this.requireTaskById(taskId);
    const feedback = text.trim();
    if (!feedback) throw new Error('message is required.');
    if (!task.cursor_agent_id) throw new Error('Start the task before sending feedback.');
    if (task.status === 'REVIEW') {
      assertCanTransition('REVIEW', 'DOING', false);
      task.status = 'DOING';
      task.pending_action = undefined;
    }
    const run = await this.cursor.createRun(task.cursor_agent_id, {
      text: feedbackPrompt(task, feedback),
      mode: 'agent',
    });
    task.latest_run_id = run.id;
    task.updated_at = this.now();
    await this.repo.saveTask(task);
    return this.record({
      scope: 'task',
      project_id: task.project_id,
      task_id: taskId,
      role: 'user',
      content: feedback,
      run_id: run.id,
      intent: 'feedback',
    });
  }

  async approve(taskId: string): Promise<ProjectTask> {
    const task = await this.requireTaskById(taskId);
    if (task.status !== 'REVIEW') throw new Error('Only a task in REVIEW can be approved.');
    if (!task.cursor_agent_id) throw new Error('This task has no Cursor agent.');
    const output = task.output_type === 'code'
      ? await this.repo.getCodeOutput(taskId)
      : await this.repo.getResearchOutput(taskId);
    if (!output?.pr_link) throw new Error('Record a pull request before approving the task.');
    assertCanTransition('REVIEW', 'DOING', false);
    const project = await this.requireProject(task.project_id);
    const run = await this.cursor.createRun(task.cursor_agent_id, {
      text: mergePrompt(task, output.pr_link, project.starting_ref?.trim() || 'main'),
      mode: 'agent',
    });
    task.status = 'DOING';
    task.pending_action = 'merge';
    task.latest_run_id = run.id;
    task.updated_at = this.now();
    await this.repo.saveTask(task);
    await this.record({
      scope: 'task',
      project_id: task.project_id,
      task_id: taskId,
      role: 'user',
      content: 'Approved. Merge the pull request.',
      run_id: run.id,
      intent: 'approve',
    });
    return task;
  }

  private async dispatchProject(projectId: string, text: string, intent: ChatMessage['intent']): Promise<ChatMessage> {
    const project = await this.requireProject(projectId);
    const content = text.trim();
    if (!content) throw new Error('message is required.');
    if (!project.cursor_agent_id) throw new Error('This project is not linked to a Cursor agent.');
    const run = await this.cursor.createRun(project.cursor_agent_id, { text: content, mode: 'plan' });
    project.latest_run_id = run.id;
    project.updated_at = this.now();
    await this.repo.saveProject(project);
    return this.record({
      scope: 'project',
      project_id: projectId,
      role: 'user',
      content,
      run_id: run.id,
      intent,
    });
  }

  private async importFinishedRuns(
    agentId: string,
    target: { scope: 'project'; projectId: string } | { scope: 'task'; projectId: string; taskId: string },
  ): Promise<void> {
    const existing = target.scope === 'project'
      ? await this.repo.listProjectMessages(target.projectId)
      : await this.repo.listTaskMessages(target.taskId);
    const runs = await this.cursor.listRuns(agentId);
    for (const summary of [...runs].reverse()) {
      const run = summary.result || TERMINAL_RUN.has(summary.status)
        ? summary
        : await this.cursor.getRun(agentId, summary.id);
      if (!TERMINAL_RUN.has(run.status)) continue;
      if (!existing.some((message) => message.run_id === run.id && message.role === 'assistant')) {
        const user = existing.find((message) => message.run_id === run.id && message.role === 'user');
        const saved = await this.record({
          scope: target.scope,
          project_id: target.projectId,
          task_id: target.scope === 'task' ? target.taskId : undefined,
          role: 'assistant',
          content: assistantText(run),
          run_id: run.id,
          intent: user?.intent ?? 'chat',
        });
        existing.push(saved);
      }
      if (target.scope === 'task') await this.applyTaskRun(target.taskId, run);
    }
  }

  private async importReferencedRuns(
    target: { scope: 'task'; projectId: string; taskId: string },
  ): Promise<void> {
    const existing = await this.repo.listTaskMessages(target.taskId);
    const pending = existing.filter((message) => message.role === 'user'
      && message.run_id
      && message.cursor_agent_id
      && !existing.some((item) => item.role === 'assistant' && item.run_id === message.run_id));
    for (const message of pending) {
      const agentId = message.cursor_agent_id;
      const runId = message.run_id;
      if (!agentId || !runId) continue;
      let run: CursorRun;
      try {
        run = await this.cursor.getRun(agentId, runId);
      } catch {
        continue;
      }
      if (!TERMINAL_RUN.has(run.status)) continue;
      if (existing.some((item) => item.role === 'assistant' && item.run_id === run.id)) continue;
      existing.push(await this.record({
        scope: 'task',
        project_id: target.projectId,
        task_id: target.taskId,
        role: 'assistant',
        content: assistantText(run),
        run_id: run.id,
        intent: message.intent ?? 'chat',
        cursor_agent_id: agentId,
      }));
      await this.applyTaskRun(target.taskId, run);
    }
  }

  private async syncArtifacts(
    agentId: string,
    target: { scope: 'project'; projectId: string } | { scope: 'task'; projectId: string; taskId: string },
  ): Promise<void> {
    let remote;
    try {
      remote = await this.cursor.listArtifacts(agentId);
    } catch {
      return;
    }
    const ownerId = target.scope === 'project' ? target.projectId : target.taskId;
    const stored = await this.repo.listArtifacts(target.scope, ownerId);
    for (const item of remote) {
      const kind = artifactKind(item.path, item.sizeBytes);
      const previous = stored.find((artifact) => artifact.path === item.path);
      if (previous && previous.updated_at === item.updatedAt && previous.size_bytes === item.sizeBytes) {
        if (kind === 'text' && previous.text) continue;
        if (kind !== 'text' && urlFresh(previous.url_expires_at, this.now())) continue;
      }
      const artifact: ChatArtifact = {
        scope: target.scope,
        project_id: target.projectId,
        task_id: target.scope === 'task' ? target.taskId : undefined,
        path: item.path,
        name: item.path.split('/').filter(Boolean).at(-1) || item.path,
        size_bytes: item.sizeBytes,
        updated_at: item.updatedAt,
        content_type: kind,
      };
      try {
        const download = await this.cursor.downloadArtifact(agentId, item.path);
        if (kind === 'text') artifact.text = await readArtifactText(download.url);
        else {
          artifact.url = download.url;
          artifact.url_expires_at = download.expiresAt;
        }
      } catch {
        if (previous?.text) artifact.text = previous.text;
        if (previous?.url) {
          artifact.url = previous.url;
          artifact.url_expires_at = previous.url_expires_at;
        }
      }
      await this.repo.saveArtifact(artifact);
    }
  }

  private async applyTaskRun(taskId: string, run: CursorRun): Promise<void> {
    const task = await this.repo.getTask(taskId);
    if (!task || task.latest_run_id !== run.id || run.status !== 'FINISHED') return;
    if (task.pending_action === 'merge') {
      task.status = 'DONE';
      task.pending_action = undefined;
      task.updated_at = this.now();
      await this.repo.saveTask(task);
      return;
    }
    const branch = run.git?.branches.find((item) => item.prUrl && item.branch);
    if (!branch?.prUrl || !branch.branch) return;
    const shared = {
      task_id: task.task_id,
      repo: normalizeRepoUrl(branch.repoUrl),
      branch: branch.branch,
      pr_message: (run.result ?? task.title).slice(0, 500),
      pr_link: branch.prUrl,
    };
    if (task.output_type === 'code') await this.repo.saveCodeOutput(shared);
    else {
      await this.repo.saveResearchOutput({
        ...shared,
        path: `research/${task.project_id}/${task.task_id}/`,
      });
    }
    if (task.status === 'DOING') {
      assertCanTransition('DOING', 'REVIEW', false);
      task.status = 'REVIEW';
      task.updated_at = this.now();
      await this.repo.saveTask(task);
    }
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
        throw new Error('Dependencies must be DONE before this task can start.');
      }
    }
  }

  private async launch(task: ProjectTask): Promise<void> {
    const project = await this.requireProject(task.project_id);
    if (!project.repo_url) throw new Error('Add a repository to the project before starting a task.');
    const base = project.starting_ref?.trim() || 'main';
    const lines = [
      `You are executing a battleplan ${task.output_type} task.`,
      `Create the working branch from \`${base}\` in ${project.repo_url}.`,
      `Open the pull request against \`${base}\`, which is the branch this project merges into.`,
    ];
    if (task.output_type === 'research') {
      lines.push(
        `Write the research into the git repository under \`research/${project.project_id}/${task.task_id}/\`.`,
        'Use markdown, JSON, CSV, or YAML, whichever fits the findings.',
        'Do not change application source code.',
        'Open a pull request that contains those research files.',
      );
    } else {
      lines.push('Implement the task in code and open a pull request.');
    }
    lines.push(`Task title: ${task.title}`, `Task prompt:\n${task.prompt}`);
    if (task.dependencies.length > 0) {
      lines.push(`This task depends on these completed task ids: ${task.dependencies.join(', ')}.`);
    }
    const created = await this.cursor.createAgent({
      prompt: lines.join('\n\n'),
      name: task.title,
      mode: 'agent',
      repoUrl: project.repo_url,
      startingRef: base,
      autoCreatePr: true,
    });
    task.cursor_agent_id = created.agent.id;
    task.cursor_chat_link = created.agent.url;
    task.latest_run_id = created.run.id;
    await this.repo.saveMessage({
      message_id: this.newId(),
      scope: 'task',
      project_id: task.project_id,
      task_id: task.task_id,
      role: 'user',
      content: task.prompt,
      created_at: this.now(),
      run_id: created.run.id,
      intent: 'chat',
    });
  }

  private taskNote(task: ProjectTask, content: string): ChatMessage {
    return {
      message_id: this.newId(),
      scope: 'task',
      project_id: task.project_id,
      task_id: task.task_id,
      role: 'change',
      content,
      created_at: this.now(),
      intent: 'chat',
    };
  }

  private async record(message: Omit<ChatMessage, 'message_id' | 'created_at'>): Promise<ChatMessage> {
    const saved: ChatMessage = { ...message, message_id: this.newId(), created_at: this.now() };
    await this.repo.saveMessage(saved);
    return saved;
  }

  private async requireProject(projectId: string): Promise<Project> {
    const project = await this.repo.getProject(projectId);
    if (!project) throw new Error('Project not found.');
    return project;
  }

  private async requireTask(projectId: string, taskId: string): Promise<ProjectTask> {
    const task = await this.repo.getTask(taskId);
    if (!task || task.project_id !== projectId) throw new Error('Task not found.');
    return task;
  }

  private async requireTaskById(taskId: string): Promise<ProjectTask> {
    const task = await this.repo.getTask(taskId);
    if (!task) throw new Error('Task not found.');
    return task;
  }
}

function isStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

function assertCanTransition(from: TaskStatus, to: TaskStatus, manual: boolean): void {
  if (from === to) return;
  if (manual) return;
  if (!GUIDED[from].includes(to)) {
    throw new Error(`Cannot move a task from ${from} to ${to}. Expected one of: ${GUIDED[from].join(', ') || 'a manual change'}.`);
  }
}

function assertAcyclic(tasks: { task_id: string; dependencies: string[] }[]): void {
  const ids = new Set(tasks.map((task) => task.task_id));
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const task of tasks) {
    indegree.set(task.task_id, indegree.get(task.task_id) ?? 0);
    outgoing.set(task.task_id, []);
  }
  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      if (dependency === task.task_id) throw new Error('A task cannot depend on itself.');
      if (!ids.has(dependency)) throw new Error(`Dependency ${dependency} is not a task in this project.`);
      outgoing.get(dependency)?.push(task.task_id);
      indegree.set(task.task_id, (indegree.get(task.task_id) ?? 0) + 1);
    }
  }
  const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id);
  let seen = 0;
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) break;
    seen += 1;
    for (const next of outgoing.get(id) ?? []) {
      const degree = (indegree.get(next) ?? 1) - 1;
      indegree.set(next, degree);
      if (degree === 0) queue.push(next);
    }
  }
  if (seen !== tasks.length) throw new Error('Task dependencies contain a cycle.');
}

function normalizeDrafts(raw: TaskDraft[]): NormalizedDraft[] {
  if (raw.length === 0) throw new Error('The task list is empty.');
  const normalized: NormalizedDraft[] = [];
  raw.forEach((item, index) => {
    const title = item.title?.trim();
    const prompt = item.prompt?.trim();
    if (!title) throw new Error(`Task ${index + 1} title is required.`);
    if (!prompt) throw new Error(`Task ${index + 1} prompt is required.`);
    const types = outputTypesOf(item.output_type, index + 1);
    const depends = item.depends_on ?? [];
    if (types.length === 1) {
      normalized.push({ title, prompt, output_type: types[0], depends_on: depends });
      return;
    }
    normalized.push({
      title: `${title} (research)`,
      prompt,
      output_type: 'research',
      depends_on: depends,
    });
    normalized.push({
      title: `${title} (code)`,
      prompt,
      output_type: 'code',
      depends_on: [...depends, `${title} (research)`],
    });
  });
  return normalized;
}

function outputTypesOf(value: string, index: number): OutputType[] {
  const tokens = value.split(/[+,/]/).map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (tokens.length === 0) throw new Error(`Task ${index} output_type must be "code" or "research".`);
  const types = new Set<OutputType>();
  for (const token of tokens) {
    if (token === 'both' || token === 'code+research' || token === 'research+code') {
      types.add('research');
      types.add('code');
      continue;
    }
    if (token !== 'code' && token !== 'research') {
      throw new Error(`Task ${index} output_type must be "code" or "research".`);
    }
    types.add(token);
  }
  return [...types];
}

function bindDependencies(existing: ProjectTask[], created: ProjectTask[], drafts: NormalizedDraft[]): void {
  const titles = new Map<string, string[]>();
  for (const task of [...existing, ...created]) {
    const ids = titles.get(task.title) ?? [];
    ids.push(task.task_id);
    titles.set(task.title, ids);
  }
  created.forEach((task, index) => {
    task.dependencies = drafts[index].depends_on.map((title) => {
      const matches = titles.get(title) ?? [];
      if (matches.length === 0) throw new Error(`Unknown dependency "${title}".`);
      if (matches.length > 1) throw new Error(`Dependency "${title}" matches more than one task.`);
      return matches[0];
    });
  });
}

function feedbackPrompt(task: ProjectTask, feedback: string): string {
  return [
    `The user reviewed the pull request for "${task.title}" and sent feedback.`,
    'Incorporate the feedback into the existing branch and update the pull request.',
    '',
    feedback,
  ].join('\n');
}

function mergePrompt(task: ProjectTask, prLink: string, baseBranch: string): string {
  return [
    `The user approved the battleplan task "${task.title}".`,
    `Merge the pull request ${prLink} into \`${baseBranch}\` and confirm when the merge is complete.`,
    'Do not open a new pull request.',
  ].join('\n');
}

function assistantText(run: CursorRun): string {
  const result = run.result?.trim();
  if (result) return result;
  if (run.status === 'FINISHED') return 'The agent finished. Attached files are shown with this conversation.';
  return `The agent run ended (${run.status}).`;
}

function artifactKind(path: string, sizeBytes: number): ChatArtifact['content_type'] {
  if (IMAGE_ARTIFACT.test(path)) return 'image';
  if (TEXT_ARTIFACT.test(path) && sizeBytes <= MAX_TEXT_BYTES) return 'text';
  return 'file';
}

function urlFresh(expiresAt: string | undefined, nowIso: string): boolean {
  if (!expiresAt) return false;
  const expires = Date.parse(expiresAt);
  const now = Date.parse(nowIso);
  return Number.isFinite(expires) && Number.isFinite(now) && expires > now + 60_000;
}

async function readArtifactText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Artifact download failed (${response.status}).`);
  const text = await response.text();
  if (text.length <= MAX_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_TEXT_CHARS)}\n\n…truncated…`;
}
