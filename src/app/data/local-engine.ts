import type {
  ChatArtifact,
  ChatMessage,
  OutputType,
  PendingChange,
  Project,
  ProjectTask,
  TaskCodeOutput,
  TaskDraft,
  TaskResearchOutput,
  TaskStatus,
} from '../core/models';
import { syncPendingChangesForProject } from '../core/pending-changes';
import { TASK_STATUSES } from '../core/models';
import type { CursorClient, CursorRun } from './cursor-browser';
import { normalizeRepoUrl } from './cursor-browser';
import type { BattleplanRepository } from './repository';
import { collectProjectDarSections, collectTaskDarSections, joinDarSections } from '../core/dar';
import {
  assertAcyclicNormalLinks,
  migrateLegacyDependencies,
  migrateMutualLinksToSiblingDependencies,
  normalChildIds,
  siblingDependencyIds,
} from '../core/dependencies';
import { availableDescendants, independentBatch } from '../core/execute-children';
import { defaultDarForOutputType, taskDar, taskInitialPrompt } from '../core/task-fields';

const TERMINAL_RUN = new Set(['FINISHED', 'ERROR', 'CANCELLED', 'CANCELED', 'FAILED', 'EXPIRED']);
const ASSISTANT_PLACEHOLDER = 'The agent finished. Attached files are shown with this conversation.';
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

  async executeProjectChat(projectId: string): Promise<{ message: ChatMessage; project: Project }> {
    const project = await this.requireProject(projectId);
    if (project.parent_task_id) {
      const parentTask = await this.repo.getTask(project.parent_task_id);
      if (parentTask?.status === 'ABANDONED') {
        throw new Error('This subproject is abandoned and cannot be executed.');
      }
    }
    if (project.cursor_agent_id) throw new Error('This project already has a Cursor agent.');
    const initial = project.initial_prompt?.trim();
    if (!initial) throw new Error('Initial prompt is required.');
    const dar = joinDarSections(await collectProjectDarSections(project, this.darLookup()));
    const payload = joinDarSections([dar, initial]);
    const created = await this.cursor.createAgent({
      prompt: payload,
      name: project.title,
      mode: 'plan',
      repoUrl: project.repo_url?.trim() || undefined,
      startingRef: project.starting_ref?.trim() || undefined,
      autoCreatePr: false,
    });
    const timestamp = this.now();
    project.cursor_agent_id = created.agent.id;
    project.cursor_chat_link = created.agent.url;
    project.latest_run_id = created.run.id;
    project.updated_at = timestamp;
    await this.repo.saveProject(project);
    const message = await this.record({
      scope: 'project',
      project_id: projectId,
      role: 'user',
      content: initial,
      run_id: created.run.id,
      intent: 'chat',
    });
    return { message, project };
  }

  async updateProject(projectId: string, patch: {
    title?: string;
    repo_url?: string;
    starting_ref?: string;
    dar?: string;
    initial_prompt?: string;
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
    if (patch.dar !== undefined) {
      const next = patch.dar.trim();
      if (next !== (project.dar ?? '')) changes.push('Data and Rules updated.');
      project.dar = next || undefined;
    }
    if (patch.initial_prompt !== undefined) {
      if (project.cursor_agent_id) throw new Error('Initial prompt cannot be changed after the Cursor agent has started.');
      const next = patch.initial_prompt.trim();
      if (next !== (project.initial_prompt ?? '')) changes.push('Initial prompt updated.');
      project.initial_prompt = next;
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
    const tasks = await this.repo.listTasks(projectId);
    let migrated = migrateLegacyDependencies(tasks);
    migrated = migrateMutualLinksToSiblingDependencies(tasks) || migrated;
    if (migrated) {
      await this.repo.saveTasks(tasks);
    }
    return tasks;
  }

  async createTask(projectId: string, input: {
    title?: string;
    dar?: string;
    initial_prompt?: string;
    output_type?: OutputType;
    depends_on?: string;
    map_x?: number;
    map_y?: number;
  }): Promise<ProjectTask> {
    await this.requireProject(projectId);
    const existing = await this.repo.listTasks(projectId);
    const title = input.title?.trim() || 'New task';
    const outputType = input.output_type ?? 'research';
    const dar = input.dar !== undefined ? input.dar.trim() : defaultDarForOutputType(outputType);
    const initialPrompt = input.initial_prompt?.trim() ?? '';
    if (outputType !== 'code' && outputType !== 'research' && outputType !== 'subproject') {
      throw new Error('output_type must be code, research, or subproject.');
    }
    const parentId = input.depends_on?.trim();
    if (parentId && !existing.some((task) => task.task_id === parentId)) {
      throw new Error('depends_on must be a task in this project.');
    }
    const timestamp = this.now();
    const task: ProjectTask = {
      task_id: this.newId(),
      project_id: projectId,
      title,
      prompt: dar,
      dar: dar || undefined,
      initial_prompt: initialPrompt || undefined,
      dependencies: [],
      status: 'TODO',
      output_type: outputType,
      order: existing.length,
      created_at: timestamp,
      updated_at: timestamp,
    };
    if (input.map_x !== undefined) task.map_x = input.map_x;
    if (input.map_y !== undefined) task.map_y = input.map_y;
    if (outputType === 'subproject') {
      const nested = await this.createNestedProject(projectId, {
        title,
        parentTaskId: parentId,
      });
      task.subproject_id = nested.project_id;
      await this.attachSubproject(
        projectId,
        nested.project_id,
        parentId ? { kind: 'task', taskId: parentId } : { kind: 'project' },
      );
    }
    if (parentId) {
      const parent = existing.find((item) => item.task_id === parentId);
      if (parent) {
        parent.dependencies = [...new Set([...parent.dependencies, task.task_id])];
        parent.updated_at = timestamp;
      }
    }
    assertAcyclicNormalLinks([...existing, task]);
    if (parentId) {
      const parent = existing.find((item) => item.task_id === parentId);
      if (parent) await this.repo.saveTask(parent);
    }
    await this.repo.saveTask(task);
    const parent = parentId ? existing.find((item) => item.task_id === parentId) : undefined;
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
    const created: ProjectTask[] = normalized.map((draft, index) => {
      const dar = defaultDarForOutputType(draft.output_type);
      const initialPrompt = draft.prompt.trim();
      return {
      task_id: this.newId(),
      project_id: projectId,
      title: draft.title,
      prompt: dar,
      dar: dar || undefined,
      initial_prompt: initialPrompt || undefined,
      dependencies: [],
      status: 'TODO',
      output_type: draft.output_type,
      order: existing.length + index,
      created_at: timestamp,
      updated_at: timestamp,
    };
    });
    bindDependencies(existing, created, normalized);
    assertAcyclicNormalLinks([...existing, ...created]);
    await this.repo.saveTasks([...existing, ...created]);
    return created;
  }

  async updateTask(projectId: string, taskId: string, patch: {
    title?: string;
    dar?: string;
    initial_prompt?: string;
    dependencies?: string[];
    sibling_dependencies?: string[];
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
    if (patch.dar !== undefined) {
      const dar = patch.dar.trim();
      if (dar !== taskDar(task)) changes.push('Data and Rules updated.');
      task.dar = dar || undefined;
      task.prompt = dar;
    }
    if (patch.initial_prompt !== undefined) {
      if (task.cursor_agent_id) throw new Error('Initial prompt cannot be changed after the Cursor agent has started.');
      const initial = patch.initial_prompt.trim();
      if (initial !== taskInitialPrompt(task)) changes.push('Initial prompt updated.');
      task.initial_prompt = initial || undefined;
    }
    if (patch.output_type !== undefined) {
      if (patch.output_type !== 'code' && patch.output_type !== 'research' && patch.output_type !== 'subproject') {
        throw new Error('output_type must be code, research, or subproject.');
      }
      if (patch.output_type !== task.output_type) {
        if (patch.output_type !== 'subproject' && task.output_type !== 'subproject') {
          const other = task.output_type === 'code'
            ? await this.repo.getResearchOutput(taskId)
            : await this.repo.getCodeOutput(taskId);
          if (other) throw new Error('Split mixed outputs into two tasks instead of changing output_type.');
        }
        if (patch.output_type === 'subproject' && !task.subproject_id) {
          const nested = await this.createNestedProject(projectId, {
            title: task.title,
            parentTaskId: task.task_id,
          });
          task.subproject_id = nested.project_id;
          await this.attachSubproject(projectId, nested.project_id, { kind: 'task', taskId: task.task_id });
        }
        changes.push(`Output: ${patch.output_type}`);
      }
      task.output_type = patch.output_type;
    }
    if (patch.dependencies !== undefined) {
      const nextDependencies = [...new Set(patch.dependencies)];
      if (nextDependencies.join(',') !== task.dependencies.join(',')) changes.push('Dependencies updated.');
      task.dependencies = nextDependencies;
      const tasks = (await this.repo.listTasks(projectId)).map((item) => item.task_id === task.task_id ? task : item);
      assertAcyclicNormalLinks(tasks);
    }
    if (patch.sibling_dependencies !== undefined) {
      const next = [...new Set(patch.sibling_dependencies.filter((id) => id !== task.task_id))];
      const previous = task.sibling_dependencies ?? [];
      if (next.join(',') !== previous.join(',')) changes.push('Sibling dependencies updated.');
      task.sibling_dependencies = next;
    }
    if (patch.status !== undefined) {
      if (!isStatus(patch.status)) throw new Error('Unknown task status.');
      if (patch.status !== task.status) changes.push(`Status: ${patch.status}`);
      await this.applyStatus(task, patch.status, Boolean(patch.manual));
      if (patch.status === 'ABANDONED') {
        await this.cascadeAbandonChildren(projectId, task);
      }
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

  listPendingChanges(projectId: string): Promise<PendingChange[]> {
    return this.repo.listPendingChanges(projectId);
  }

  savePendingChanges(projectId: string, changes: PendingChange[]): Promise<void> {
    return this.repo.savePendingChanges(projectId, changes);
  }

  async syncPendingChanges(projectId: string, input: {
    tasks: ProjectTask[];
    codeOutputs: Record<string, TaskCodeOutput | null>;
    researchOutputs: Record<string, TaskResearchOutput | null>;
    current: PendingChange[];
  }): Promise<PendingChange[]> {
    const project = await this.requireProject(projectId);
    return syncPendingChangesForProject({
      project,
      tasks: input.tasks,
      codeOutputs: input.codeOutputs,
      researchOutputs: input.researchOutputs,
      current: input.current,
    });
  }

  async sendProjectMessage(projectId: string, message: string): Promise<ChatMessage> {
    const project = await this.requireProject(projectId);
    const content = message.trim();
    if (!content) throw new Error('message is required.');
    if (!project.cursor_agent_id) {
      throw new Error('Execute the subproject with its Initial Prompt before sending chat messages.');
    }
    return this.dispatchProject(projectId, content, 'chat');
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
      taskDar(task) ? `Task data and rules:\n${taskDar(task)}` : '',
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

  async convertTask(projectId: string, taskId: string, to: 'code' | 'subproject'): Promise<ProjectTask> {
    const task = await this.requireTask(projectId, taskId);
    if (task.output_type !== 'research') {
      throw new Error('Only research tasks can be converted from the mindmap.');
    }
    return this.updateTask(projectId, taskId, { output_type: to });
  }

  async executeChildren(projectId: string, parentTaskId: string): Promise<ProjectTask[]> {
    await this.requireTask(projectId, parentTaskId);
    const started: ProjectTask[] = [];
    for (let guard = 0; guard < 500; guard += 1) {
      const tasks = await this.listTasks(projectId);
      const available = availableDescendants(parentTaskId, tasks);
      if (available.length === 0) break;
      const batch = independentBatch(available, tasks);
      if (batch.length === 0) break;
      await Promise.all(batch.map(async (candidate) => {
        if (candidate.output_type === 'subproject') return;
        if (candidate.status === 'ABANDONED') return;
        const fresh = await this.requireTask(projectId, candidate.task_id);
        if (fresh.cursor_agent_id || fresh.status !== 'TODO') return;
        if (!taskInitialPrompt(fresh)) {
          throw new Error(`"${fresh.title}" needs an Initial Prompt before it can be executed.`);
        }
        await this.executeTask(candidate.task_id);
        const updated = await this.requireTask(projectId, candidate.task_id);
        started.push(updated);
      }));
    }
    return started;
  }

  async executeTask(taskId: string): Promise<ChatMessage> {
    const task = await this.requireTaskById(taskId);
    if (task.status === 'ABANDONED') {
      throw new Error('An abandoned task cannot be executed.');
    }
    if (task.output_type === 'subproject') {
      throw new Error('Open the subproject and use Execute there.');
    }
    if (task.cursor_agent_id) throw new Error('This task already has a Cursor agent.');
    const initial = taskInitialPrompt(task);
    if (!initial) throw new Error('Initial prompt is required.');
    await this.assertDependenciesDone(task);
    return this.launchWithFirstMessage(task, initial);
  }

  async sendTaskMessage(taskId: string, text: string): Promise<ChatMessage> {
    const task = await this.requireTaskById(taskId);
    const feedback = text.trim();
    if (!feedback) throw new Error('message is required.');
    if (task.output_type === 'subproject' && task.subproject_id) {
      return this.sendProjectMessage(task.subproject_id, feedback);
    }
    if (!task.cursor_agent_id) {
      throw new Error('Execute the task with its Initial Prompt before sending chat messages.');
    }
    const active = await this.requireTaskById(taskId);
    if (!active.cursor_agent_id) throw new Error('Start the task before sending feedback.');
    if (active.status === 'REVIEW') {
      assertCanTransition('REVIEW', 'DOING', false);
      active.status = 'DOING';
      active.pending_action = undefined;
    }
    const run = await this.cursor.createRun(active.cursor_agent_id!, {
      text: feedbackPrompt(active, feedback),
      mode: 'agent',
    });
    active.latest_run_id = run.id;
    active.updated_at = this.now();
    await this.repo.saveTask(active);
    return this.record({
      scope: 'task',
      project_id: active.project_id,
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

  private async dispatchProject(
    projectId: string,
    text: string,
    intent: ChatMessage['intent'],
    transcriptContent = text.trim(),
  ): Promise<ChatMessage> {
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
      content: transcriptContent,
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
      const run = await this.resolveTerminalRun(agentId, summary);
      if (!TERMINAL_RUN.has(run.status)) continue;
      const user = existing.find((message) => message.run_id === run.id && message.role === 'user');
      const assistant = existing.find((message) => message.run_id === run.id && message.role === 'assistant');
      const content = await this.assistantText(agentId, run);
      if (!assistant) {
        const saved = await this.record({
          scope: target.scope,
          project_id: target.projectId,
          task_id: target.scope === 'task' ? target.taskId : undefined,
          role: 'assistant',
          content,
          run_id: run.id,
          intent: user?.intent ?? 'chat',
        });
        existing.push(saved);
      } else if (assistant.content !== content && shouldReplaceAssistantText(assistant.content, content)) {
        const saved = { ...assistant, content };
        await this.repo.saveMessage(saved);
        const index = existing.findIndex((message) => message.message_id === assistant.message_id);
        if (index >= 0) existing[index] = saved;
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
      const resolved = await this.resolveTerminalRun(agentId, run);
      const content = await this.assistantText(agentId, resolved);
      const assistant = existing.find((item) => item.role === 'assistant' && item.run_id === resolved.id);
      if (!assistant) {
        existing.push(await this.record({
          scope: 'task',
          project_id: target.projectId,
          task_id: target.taskId,
          role: 'assistant',
          content,
          run_id: resolved.id,
          intent: message.intent ?? 'chat',
          cursor_agent_id: agentId,
        }));
      } else if (assistant.content !== content && shouldReplaceAssistantText(assistant.content, content)) {
        const saved = { ...assistant, content };
        await this.repo.saveMessage(saved);
        const index = existing.findIndex((item) => item.message_id === assistant.message_id);
        if (index >= 0) existing[index] = saved;
      }
      await this.applyTaskRun(target.taskId, resolved);
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
    if (status === 'DOING' && !task.cursor_agent_id && task.output_type !== 'subproject' && !manual) {
      await this.assertDependenciesDone(task);
    }
    task.status = status;
    if (status !== 'DOING') task.pending_action = undefined;
  }

  private async assertDependenciesDone(task: ProjectTask): Promise<void> {
    const tasks = await this.repo.listTasks(task.project_id);
    const byId = new Map(tasks.map((item) => [item.task_id, item]));
    for (const siblingId of siblingDependencyIds(task)) {
      const other = byId.get(siblingId);
      if (!other || other.status !== 'DONE') {
        throw new Error('Sibling dependencies must be DONE before this task can start.');
      }
    }
  }

  private async launchWithFirstMessage(task: ProjectTask, userMessage: string): Promise<ChatMessage> {
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
    lines.push(`Task title: ${task.title}`);
    const siblingIds = siblingDependencyIds(task);
    if (siblingIds.length > 0) {
      lines.push(`This task depends on these completed task ids: ${siblingIds.join(', ')}.`);
    }
    const dar = joinDarSections(await collectTaskDarSections(task, this.darLookup()));
    const firstChat = joinDarSections([dar, userMessage]);
    const created = await this.cursor.createAgent({
      prompt: joinDarSections([lines.join('\n\n'), firstChat]),
      name: task.title,
      mode: 'agent',
      repoUrl: project.repo_url,
      startingRef: base,
      autoCreatePr: true,
    });
    task.cursor_agent_id = created.agent.id;
    task.cursor_chat_link = created.agent.url;
    task.latest_run_id = created.run.id;
    task.status = 'DOING';
    task.updated_at = this.now();
    await this.repo.saveTask(task);
    return this.record({
      scope: 'task',
      project_id: task.project_id,
      task_id: task.task_id,
      role: 'user',
      content: userMessage,
      run_id: created.run.id,
      intent: 'chat',
    });
  }

  private darLookup() {
    return {
      getProject: (projectId: string) => this.repo.getProject(projectId),
      getTask: (taskId: string) => this.repo.getTask(taskId),
      listTasks: (projectId: string) => this.repo.listTasks(projectId),
    };
  }

  private async createNestedProject(
    rootProjectId: string,
    input: { title: string; parentTaskId?: string },
  ): Promise<Project> {
    const root = await this.requireProject(rootProjectId);
    const timestamp = this.now();
    const nested: Project = {
      project_id: this.newId(),
      title: input.title,
      initial_prompt: '',
      cursor_chat_link: '',
      parent_project_id: rootProjectId,
      parent_task_id: input.parentTaskId,
      subproject_ids: [],
      repo_url: root.repo_url,
      starting_ref: root.starting_ref,
      created_at: timestamp,
      updated_at: timestamp,
    };
    await this.repo.saveProject(nested);
    return nested;
  }

  private async attachSubproject(
    parentProjectId: string,
    subprojectId: string,
    attachTo: { kind: 'project' } | { kind: 'task'; taskId: string },
  ): Promise<void> {
    const parentProject = await this.requireProject(parentProjectId);
    const projectIds = new Set(parentProject.subproject_ids ?? []);
    projectIds.add(subprojectId);
    parentProject.subproject_ids = [...projectIds];
    parentProject.updated_at = this.now();
    await this.repo.saveProject(parentProject);
    if (attachTo.kind === 'task') {
      const parentTask = await this.requireTask(parentProjectId, attachTo.taskId);
      const taskIds = new Set(parentTask.subproject_ids ?? []);
      taskIds.add(subprojectId);
      parentTask.subproject_ids = [...taskIds];
      parentTask.updated_at = this.now();
      await this.repo.saveTask(parentTask);
    }
  }

  private async cascadeAbandonChildren(projectId: string, parent: ProjectTask): Promise<void> {
    const tasks = await this.repo.listTasks(projectId);
    const byId = new Map(tasks.map((item) => [item.task_id, item]));
    for (const childId of normalChildIds(parent, byId)) {
      const child = byId.get(childId);
      if (!child || child.status === 'ABANDONED') continue;
      child.status = 'ABANDONED';
      child.pending_action = undefined;
      child.updated_at = this.now();
      await this.repo.saveTask(child);
      await this.repo.saveMessage(this.taskNote(child, 'Status: ABANDONED (parent task abandoned).'));
      await this.cascadeAbandonChildren(projectId, child);
    }
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

  private async resolveTerminalRun(agentId: string, summary: CursorRun): Promise<CursorRun> {
    if (!TERMINAL_RUN.has(summary.status)) return summary;
    const detailed = summary.result?.trim() ? summary : await this.cursor.getRun(agentId, summary.id);
    if (detailed.result?.trim()) return detailed;
    const streamed = await this.cursor.streamRunText(agentId, summary.id);
    return streamed ? { ...detailed, result: streamed } : detailed;
  }

  private async assistantText(agentId: string, run: CursorRun): Promise<string> {
    const result = run.result?.trim();
    if (result) return result;
    if (run.status === 'FINISHED') return ASSISTANT_PLACEHOLDER;
    return `The agent run ended (${run.status}).`;
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
  const byId = new Map([...existing, ...created].map((task) => [task.task_id, task]));
  created.forEach((task) => {
    task.dependencies = [];
  });
  created.forEach((task, index) => {
    for (const title of drafts[index].depends_on) {
      const matches = titles.get(title) ?? [];
      if (matches.length === 0) throw new Error(`Unknown dependency "${title}".`);
      if (matches.length > 1) throw new Error(`Dependency "${title}" matches more than one task.`);
      const parent = byId.get(matches[0]);
      if (!parent) throw new Error(`Unknown dependency "${title}".`);
      parent.dependencies = [...new Set([...parent.dependencies, task.task_id])];
    }
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

function shouldReplaceAssistantText(previous: string, next: string): boolean {
  if (previous === next) return false;
  if (previous === ASSISTANT_PLACEHOLDER) return true;
  return !previous.trim() && Boolean(next.trim());
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
