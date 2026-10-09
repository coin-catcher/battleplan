import { Injectable, computed, inject, signal } from '@angular/core';
import { BattleplanApi } from '../api/battleplan-api.service';
import { AppPreferences } from '../data/app-preferences.service';
import type {
  AgentKind,
  AgentOptionValue,
  AgentType,
  ChatArtifact,
  ChatMessage,
  ConversationPage,
  OutputType,
  PendingChange,
  Project,
  ProjectAgent,
  ProjectTask,
  Selection,
  TaskCodeOutput,
  TaskResearchOutput,
  TaskStatus,
} from '../core/models';
import { defaultOptionValues, getAgentTypeDefinition } from '../core/agent-types';
import { isAgentDraftId, newDraftAgentId } from '../core/agent-id';
import type { AgentEditorSaveInput } from '../api/battleplan-api.service';
import { layoutMindmap, positionConnectedNode, type CardinalDirection } from '../core/mindmap';
import { anchorDraftsUnderParentTask } from '../core/generate-tasks';
import { parseGeneratedTaskListFromSources } from '../core/parse-tasks';
import { buildTaskForest, reorderTaskIds, type TaskNode } from '../core/task-tree';
import { MERGE_CONFLICT_AGENT_RECOVERY_SENTINEL } from '../core/github-client';
import { doingBackgroundWatchTaskIds, taskNeedsDoingBackgroundPoll } from './doing-background-watch';

const POLL_INTERVAL_MS = 3000;
const POLL_ATTEMPTS = 300;

export interface ProjectTabSnapshot {
  selection: Selection;
  tasks: ProjectTask[];
  messages: ChatMessage[];
  artifacts: ChatArtifact[];
  agents: ProjectAgent[];
  codeOutputs: Record<string, TaskCodeOutput | null>;
  researchOutputs: Record<string, TaskResearchOutput | null>;
  pendingChanges: PendingChange[];
  paneWidth: number;
}

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
  readonly editorLoading = signal(false);
  readonly chatActionPending = signal<'send' | 'execute' | 'merge' | null>(null);
  readonly pendingChanges = signal<PendingChange[]>([]);
  readonly agents = signal<ProjectAgent[]>([]);
  readonly openTabs = signal<string[]>([]);

  readonly project = computed(() => this.projects().find((item) => item.project_id === this.projectId()) ?? null);
  readonly rootProjects = computed(() => this.projects().filter((item) => !item.parent_project_id));
  readonly editorProject = computed(() => {
    const selection = this.selection();
    if (selection.kind === 'subproject') {
      const task = this.tasks().find((item) => item.task_id === selection.taskId);
      if (task?.subproject_id) {
        return this.projects().find((item) => item.project_id === task.subproject_id) ?? null;
      }
    }
    return this.project();
  });
  readonly forest = computed(() => buildTaskForest(this.tasks()));
  readonly selectedTask = computed(() => {
    const selection = this.selection();
    if (selection.kind !== 'task' && selection.kind !== 'subproject' && selection.kind !== 'code' && selection.kind !== 'research') {
      return null;
    }
    return this.tasks().find((task) => task.task_id === selection.taskId) ?? null;
  });
  readonly toolboxAgents = computed(() =>
    [...this.agents()]
      .filter((agent) => !isAgentDraftId(agent.agent_id))
      .sort((left, right) => left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name)),
  );
  readonly selectedAgent = computed(() => {
    const selection = this.selection();
    if (selection.kind !== 'agent') return null;
    return this.agents().find((agent) => agent.agent_id === selection.agentId) ?? null;
  });

  private foregroundWatchGeneration = 0;
  private editorLoadGeneration = 0;
  private foregroundWatchTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly tabSnapshots = new Map<string, ProjectTabSnapshot>();
  private readonly taskChatCache = new Map<string, { messages: ChatMessage[]; artifacts: ChatArtifact[]; task: ProjectTask }>();
  private readonly doingBackgroundGeneration = new Map<string, number>();
  private readonly doingBackgroundTimer = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly doingBackgroundInflight = new Set<string>();

  async loadProjects(): Promise<void> {
    await this.run(async () => {
      const projects = await this.api.listProjects();
      this.projects.set(projects);
      const preferred = this.preferences.currentProjectId();
      const initial = preferred && projects.some((item) => item.project_id === preferred)
        ? preferred
        : projects[0]?.project_id;
      if (!this.projectId() && initial) {
        await this.openProjectTab(initial, this.preferences.paneWidth());
      }
      if (projects.length === 0) this.selection.set({ kind: 'create' });
    });
  }

  snapshotWorkspace(paneWidth: number): ProjectTabSnapshot {
    return {
      selection: this.selection(),
      tasks: this.tasks(),
      messages: this.messages(),
      artifacts: this.artifacts(),
      agents: this.agents(),
      codeOutputs: this.codeOutputs(),
      researchOutputs: this.researchOutputs(),
      pendingChanges: this.pendingChanges(),
      paneWidth,
    };
  }

  restoreWorkspace(snapshot: ProjectTabSnapshot): void {
    this.selection.set(snapshot.selection);
    this.tasks.set(snapshot.tasks);
    this.messages.set(snapshot.messages);
    this.artifacts.set(snapshot.artifacts);
    this.agents.set(snapshot.agents ?? []);
    this.codeOutputs.set(snapshot.codeOutputs);
    this.researchOutputs.set(snapshot.researchOutputs);
    this.pendingChanges.set(snapshot.pendingChanges);
  }

  async openProjectTab(projectId: string, paneWidth: number): Promise<number> {
    const currentId = this.projectId();
    if (currentId && currentId !== projectId) {
      this.tabSnapshots.set(currentId, this.snapshotWorkspace(paneWidth));
    }
    this.openTabs.update((tabs) => tabs.includes(projectId) ? tabs : [...tabs, projectId]);
    const cached = this.tabSnapshots.get(projectId);
    if (cached) {
      this.cancelEditorLoading();
      this.stopWatch();
      this.projectId.set(projectId);
      await this.preferences.setCurrentProjectId(projectId);
      this.restoreWorkspace(cached);
      void this.refreshPendingChanges();
      this.resumeWatchForSelection();
      return cached.paneWidth;
    }
    await this.selectProject(projectId);
    this.tabSnapshots.set(projectId, this.snapshotWorkspace(paneWidth));
    return paneWidth;
  }

  async switchProjectTab(projectId: string, paneWidth: number): Promise<number> {
    return this.openProjectTab(projectId, paneWidth);
  }

  async selectProject(projectId: string): Promise<void> {
    await this.withEditorLoading(async () => {
      this.stopWatch();
      this.projectId.set(projectId);
      await this.preferences.setCurrentProjectId(projectId);
      this.selection.set({ kind: 'project' });
      await this.run(async () => {
        await this.reloadTasks();
        await this.reloadAgents(projectId);
        this.applyConversation(await this.api.listProjectMessages(projectId));
        await this.refreshPendingChanges();
      });
      this.openTabs.update((tabs) => tabs.includes(projectId) ? tabs : [...tabs, projectId]);
      this.continueProjectWatch(projectId);
    });
  }

  async refreshPendingChanges(): Promise<void> {
    const projectId = this.projectId();
    if (!projectId) {
      this.pendingChanges.set([]);
      return;
    }
    this.pendingChanges.set(await this.api.listPendingChanges(projectId));
  }

  async reloadAgents(projectId: string): Promise<void> {
    this.agents.set(await this.api.listProjectAgents(projectId));
  }

  selectAgent(agentId: string): void {
    this.selection.set({ kind: 'agent', agentId });
  }

  selectAgentCreate(role: 'research' | 'code'): void {
    this.selection.set({ kind: 'agent-create', role });
  }

  createAgentDraft(role: AgentKind): ProjectAgent {
    const type: AgentType = role === 'code' ? 'Cursor Agent' : 'OpenAI';
    const definition = getAgentTypeDefinition(type);
    const now = new Date().toISOString();
    const draft: ProjectAgent = {
      agent_id: newDraftAgentId(),
      kind: role,
      type,
      name: definition.defaultName,
      url: definition.defaultUrl,
      options: defaultOptionValues(type),
      created_at: now,
      updated_at: now,
    };
    this.agents.update((agents) => [...agents, draft]);
    this.selection.set({ kind: 'agent', agentId: draft.agent_id });
    return draft;
  }

  async saveAgentFromEditor(input: AgentEditorSaveInput): Promise<void> {
    const selection = this.selection();
    if (selection.kind !== 'agent' && selection.kind !== 'agent-create') return;
    await this.run(async () => {
      const projectId = this.projectId();
      if (!projectId) return;
      const now = new Date().toISOString();
      let agents = [...this.agents()];

      if (selection.kind === 'agent-create') {
        const agent: ProjectAgent = {
          agent_id: crypto.randomUUID(),
          kind: selection.role,
          type: input.type,
          name: input.name.trim(),
          url: input.url.trim(),
          options: { ...input.options },
          created_at: now,
          updated_at: now,
        };
        if (input.apiKeyEdited && input.api_key?.trim()) {
          agent.api_key = input.api_key.trim();
        }
        agents.push(agent);
        await this.persistAgentList(projectId, agents);
        this.selection.set({ kind: 'agent', agentId: agent.agent_id });
        this.notice.set('Agent saved.');
        return;
      }

      const agentId = selection.agentId;
      const index = agents.findIndex((item) => item.agent_id === agentId);
      if (index < 0) {
        this.error.set('Agent not found.');
        return;
      }
      const previous = agents[index];
      const wasDraft = isAgentDraftId(agentId);
      const nextId = wasDraft ? crypto.randomUUID() : agentId;
      const updated: ProjectAgent = {
        ...previous,
        agent_id: nextId,
        type: input.type,
        name: input.name.trim(),
        url: input.url.trim(),
        options: { ...input.options },
        updated_at: now,
      };
      if (input.apiKeyEdited) {
        updated.api_key = input.api_key?.trim() || undefined;
      }
      if (wasDraft) {
        agents = agents.filter((item) => item.agent_id !== agentId);
        agents.push(updated);
      } else {
        agents[index] = updated;
      }
      await this.persistAgentList(projectId, agents);
      this.selection.set({ kind: 'agent', agentId: nextId });
      this.notice.set(wasDraft ? 'Agent saved.' : 'Agent updated.');
    });
  }

  async deleteAgent(agentId: string): Promise<void> {
    if (isAgentDraftId(agentId)) {
      this.agents.update((agents) => agents.filter((item) => item.agent_id !== agentId));
      this.selection.set({ kind: 'project' });
      return;
    }
    await this.run(async () => {
      const projectId = this.projectId();
      if (!projectId) return;
      const agents = this.agents().filter((item) => item.agent_id !== agentId);
      await this.persistAgentList(projectId, agents);
      this.selection.set({ kind: 'project' });
      this.notice.set('Agent deleted.');
    });
  }

  private async persistAgentList(projectId: string, agents: ProjectAgent[]): Promise<void> {
    const persisted = agents.filter((agent) => !isAgentDraftId(agent.agent_id));
    await this.api.saveProjectAgents(projectId, persisted);
    this.agents.set(agents);
  }

  async releasePendingChanges(): Promise<void> {
    const projectId = this.projectId();
    if (!projectId) return;
    let runId: string | undefined;
    await this.run(async () => {
      const message = await this.api.releaseProjectChanges(projectId);
      runId = message.run_id ?? undefined;
      this.pendingChanges.set([]);
      this.applyConversation(await this.api.listProjectMessages(projectId));
      this.notice.set('Released pending changes to main.');
    });
    if (runId && !this.error()) {
      await this.syncProjectUserRun(projectId, runId);
      void this.watchProject(projectId, runId);
    }
  }

  showCreate(): void {
    this.cancelEditorLoading();
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
      this.agents.set([]);
      this.selection.set({ kind: 'project' });
      this.applyConversation(await this.api.listProjectMessages(project.project_id));
      await this.refreshPendingChanges();
    });
    if (projectId && !this.error()) {
      this.openTabs.update((tabs) => tabs.includes(projectId) ? tabs : [...tabs, projectId]);
      this.continueProjectWatch(projectId);
    }
  }

  async saveProject(patch: { title: string; repo_url: string; starting_ref: string; github_pat: string; dar: string; initial_prompt?: string }): Promise<void> {
    const project = this.project();
    if (!project) return;
    await this.run(async () => {
      const updated = await this.api.updateProject(project.project_id, patch);
      this.projects.update((projects) => projects.map((item) => item.project_id === updated.project_id ? updated : item));
      this.applyConversation(await this.api.listProjectMessages(project.project_id));
      this.notice.set('Project saved.');
    });
  }

  async saveEditorProject(patch: {
    title: string;
    repo_url: string;
    starting_ref: string;
    github_pat: string;
    dar: string;
    initial_prompt?: string;
  }): Promise<void> {
    const editor = this.editorProject();
    if (!editor) return;
    await this.run(async () => {
      const updated = await this.api.updateProject(editor.project_id, patch);
      this.projects.update((projects) => projects.map((item) => item.project_id === updated.project_id ? updated : item));
      const task = this.selectedTask();
      if (task?.subproject_id === editor.project_id && patch.title.trim() !== task.title) {
        this.replaceTask(await this.api.updateTask(task.project_id, task.task_id, { title: patch.title.trim() }));
      }
      this.applyConversation(await this.api.listProjectMessages(editor.project_id));
      this.notice.set('Subproject saved.');
    });
  }

  async deleteProject(): Promise<void> {
    const project = this.project();
    if (!project) return;
    this.cancelEditorLoading();
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
      this.agents.set([]);
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
    await this.withEditorLoading(async () => {
      this.stopWatch();
      this.selection.set({ kind: 'project' });
      await this.run(async () => {
        this.applyConversation(await this.api.listProjectMessages(projectId));
        await this.refreshPendingChanges();
      });
      this.continueProjectWatch(projectId);
    });
  }

  async sendProjectMessage(message: string): Promise<void> {
    const projectId = this.projectId();
    if (!projectId) return;
    let runId: string | undefined;
    await this.run(async () => {
      const sent = await this.api.sendProjectMessage(projectId, message);
      runId = sent.run_id;
      this.rememberMessage(sent);
      await this.reloadProjects();
    });
    if (runId && !this.error()) {
      await this.syncProjectUserRun(projectId, runId);
      void this.watchProject(projectId, runId);
    }
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
    await this.run(async () => {
      if (taskId) {
        const refreshed = await this.api.listTaskMessages(taskId);
        this.applyTaskConversation(refreshed);
      } else {
        this.applyConversation(await this.api.listProjectMessages(projectId));
      }
    });
    const reply = this.messages().find((message) => message.run_id === runId && message.role === 'assistant');
    if (!reply) {
      this.error.set('The Cursor agent has not replied yet.');
      return;
    }
    await this.run(async () => {
      let drafts = parseGeneratedTaskListFromSources(reply.content, this.artifacts());
      const sourceTask = taskId ? this.tasks().find((item) => item.task_id === taskId) : undefined;
      if (sourceTask) {
        drafts = anchorDraftsUnderParentTask(drafts, sourceTask.title);
      }
      await this.api.createTasks(projectId, drafts);
      await this.reloadTasks();
      const note = `Created ${drafts.length} task${drafts.length === 1 ? '' : 's'} from this conversation.`;
      const saved = taskId ? await this.api.noteTask(taskId, note) : await this.api.noteProject(projectId, note);
      this.rememberMessage(saved);
      this.notice.set(note);
    });
  }

  async openTask(taskId: string): Promise<void> {
    await this.withEditorLoading(async () => {
      this.stopWatch();
      const existing = this.tasks().find((item) => item.task_id === taskId);
      const kind = existing?.output_type === 'subproject' ? 'subproject' : 'task';
      this.selection.set({ kind, taskId });
      const cached = this.taskChatCache.get(taskId);
      if (cached) {
        this.messages.set(cached.messages);
        this.artifacts.set(cached.artifacts);
        this.replaceTask(cached.task);
      }
      await this.run(async () => {
        if (kind === 'subproject' && existing?.subproject_id) {
          const page = await this.api.listProjectMessages(existing.subproject_id);
          this.cacheSubprojectTaskChat(taskId, page, existing);
          this.applyConversation(page);
          return;
        }
        const result = await this.api.listTaskMessages(taskId);
        this.applyTaskConversation(result);
        await this.refreshOutput(result.task);
      });
      if (kind === 'task') this.continueTaskWatch(taskId);
      else if (existing?.subproject_id) this.continueProjectWatch(existing.subproject_id);
    });
  }

  async convertTask(taskId: string, to: 'code' | 'subproject'): Promise<void> {
    const projectId = this.projectId();
    if (!projectId) return;
    await this.withEditorLoading(async () => {
      await this.run(async () => {
        const updated = await this.api.convertTask(projectId, taskId, to);
        await this.reloadProjects();
        this.replaceTask(updated);
        if (to === 'subproject') {
          this.selection.set({ kind: 'subproject', taskId });
          if (updated.subproject_id) {
            this.applyConversation(await this.api.listProjectMessages(updated.subproject_id));
          }
        } else {
          this.selection.set({ kind: 'task', taskId });
          this.applyTaskConversation(await this.api.listTaskMessages(taskId));
        }
        this.notice.set(`Converted to ${to} task.`);
      });
    });
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
    output_type?: OutputType;
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
      project.status,
    );
    const source = layout.nodes.find((node) => node.id === input.sourceId);
    if (!source) return null;
    const placement = positionConnectedNode(source, input.direction);
    const map_x = Math.round(placement.x);
    const map_y = Math.round(placement.y);
    const depends_on = input.sourceKind === 'task' ? input.sourceId : undefined;
    this.stopWatch();
    let taskId = '';
    await this.withEditorLoading(async () => {
      await this.run(async () => {
        const task = await this.api.createTask(projectId, {
          depends_on,
          map_x,
          map_y,
          output_type: input.output_type ?? 'research',
        });
        taskId = task.task_id;
        await this.reloadProjects();
        await this.reloadTasks();
        const kind = task.output_type === 'subproject' ? 'subproject' : 'task';
        this.selection.set({ kind, taskId: task.task_id });
        if (kind === 'subproject' && task.subproject_id) {
          this.applyConversation(await this.api.listProjectMessages(task.subproject_id));
        }
        const result = await this.api.listTaskMessages(task.task_id);
        this.applyTaskConversation(result);
        this.notice.set('Task added. Fill in the details.');
      });
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
    await this.withEditorLoading(async () => {
      this.stopWatch();
      this.selection.set({ kind, taskId });
      await this.run(async () => {
        const task = this.tasks().find((item) => item.task_id === taskId);
        if (task) await this.refreshOutput(task);
      });
    });
  }

  async saveTask(patch: {
    title: string;
    dar: string;
    initial_prompt: string;
    output_type: OutputType;
    dependencies: string[];
    sibling_dependencies: string[];
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
    this.syncDoingBackgroundWatches();
  }

  async executeTask(): Promise<void> {
    const task = this.selectedTask();
    if (!task) return;
    let runId: string | undefined;
    await this.run(async () => {
      const sent = await this.api.executeTask(task.task_id);
      runId = sent.run_id;
      this.rememberMessage(sent);
      this.applyTaskConversation(await this.api.listTaskMessages(task.task_id));
    });
    if (runId && !this.error()) {
      await this.syncTaskUserRun(task.task_id, runId);
      void this.watchTask(task.task_id, runId);
      this.ensureDoingBackgroundWatch(task.task_id);
    }
  }

  async executeChildren(parentTaskId: string): Promise<void> {
    const projectId = this.projectId();
    if (!projectId) return;
    await this.run(async () => {
      const started = await this.api.executeChildren(projectId, parentTaskId);
      await this.reloadTasks();
      if (started.length === 0) {
        this.notice.set('No child tasks are ready to execute.');
      } else {
        this.notice.set(`Started ${started.length} child task${started.length === 1 ? '' : 's'}.`);
      }
      const selection = this.selection();
      if (selection.kind === 'task' || selection.kind === 'subproject') {
        this.applyTaskConversation(await this.api.listTaskMessages(selection.taskId));
      }
      this.syncDoingBackgroundWatches();
    });
  }

  async executeSubprojectChat(): Promise<void> {
    const editor = this.editorProject();
    if (!editor) return;
    let runId: string | undefined;
    let projectId = editor.project_id;
    await this.run(async () => {
      const result = await this.api.executeProjectChat(editor.project_id);
      runId = result.message.run_id;
      projectId = result.project.project_id;
      this.rememberMessage(result.message);
      this.projects.update((projects) => projects.map((item) => (
        item.project_id === result.project.project_id ? result.project : item
      )));
      this.applyConversation(await this.api.listProjectMessages(editor.project_id));
    });
    if (runId && !this.error()) {
      await this.syncProjectUserRun(projectId, runId);
      void this.watchProject(projectId, runId);
      const task = this.selectedTask();
      if (task?.output_type === 'subproject') this.ensureDoingBackgroundWatch(task.task_id);
    }
  }

  async sendTaskMessage(message: string): Promise<void> {
    const task = this.selectedTask();
    if (!task) return;
    let runId: string | undefined;
    let watchProjectId: string | undefined;
    await this.run(async () => {
      const sent = await this.api.sendTaskMessage(task.task_id, message);
      runId = sent.run_id;
      this.rememberMessage(sent);
      if (task.output_type === 'subproject' && task.subproject_id) {
        watchProjectId = task.subproject_id;
        await this.reloadTasks();
        this.applyConversation(await this.api.listProjectMessages(task.subproject_id));
      } else {
        this.applyTaskConversation(await this.api.listTaskMessages(task.task_id));
      }
    });
    if (runId && !this.error()) {
      if (watchProjectId) {
        await this.syncProjectUserRun(watchProjectId, runId);
        void this.watchProject(watchProjectId, runId);
        this.ensureDoingBackgroundWatch(task.task_id);
      } else {
        await this.syncTaskUserRun(task.task_id, runId);
        void this.watchTask(task.task_id, runId);
        this.ensureDoingBackgroundWatch(task.task_id);
      }
    }
  }

  async approve(): Promise<void> {
    const task = this.selectedTask();
    if (!task) return;
    const taskId = task.task_id;
    await this.run(async () => {
      try {
        const merged = await this.api.approve(taskId);
        this.replaceTask(merged);
        const refreshed = await this.api.listTaskMessages(taskId);
        this.applyTaskConversation(refreshed);
        await this.refreshPendingChanges();
        this.notice.set('Pull request merged. Task is DONE.');
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message.includes(MERGE_CONFLICT_AGENT_RECOVERY_SENTINEL)) {
          const refreshed = await this.api.listTaskMessages(taskId);
          this.applyTaskConversation(refreshed);
        }
        throw error;
      }
    });
    if (this.error()?.includes(MERGE_CONFLICT_AGENT_RECOVERY_SENTINEL)) {
      this.continueTaskWatch(taskId);
    }
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
    this.stopDoingBackgroundWatch(taskId);
    this.taskChatCache.delete(taskId);
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

  private syncProjectUserRun(projectId: string, runId: string): Promise<void> {
    return this.pollSync(async () => {
      if (!this.watchingProjectChat(projectId)) return true;
      const page = await this.api.listProjectMessages(projectId);
      if (!this.watchingProjectChat(projectId)) return true;
      this.applyConversation(page);
      return hasUserRun(page.messages, runId);
    });
  }

  private syncTaskUserRun(taskId: string, runId: string): Promise<void> {
    return this.pollSync(async () => {
      const selection = this.selection();
      if (!this.watchingTaskChat(taskId, selection)) return true;
      const result = await this.api.listTaskMessages(taskId);
      const current = this.selection();
      if (!this.watchingTaskChat(taskId, current)) return true;
      this.applyTaskConversation(result);
      return hasUserRun(result.messages, runId);
    });
  }

  private pollSync(load: () => Promise<boolean>): Promise<void> {
    return new Promise((resolve) => {
      const tick = (attempt: number) => {
        void (async () => {
          let done = false;
          try {
            done = await load();
          } catch {
            resolve();
            return;
          }
          if (done || attempt + 1 >= POLL_ATTEMPTS) {
            resolve();
            return;
          }
          setTimeout(() => tick(attempt + 1), POLL_INTERVAL_MS);
        })();
      };
      tick(0);
    });
  }

  private subprojectCursorAgentId(subprojectId: string): string | undefined {
    return this.projects().find((item) => item.project_id === subprojectId)?.cursor_agent_id;
  }

  private syncDoingBackgroundWatches(): void {
    const wanted = new Set(doingBackgroundWatchTaskIds(this.tasks(), (id) => this.subprojectCursorAgentId(id)));
    for (const taskId of wanted) this.ensureDoingBackgroundWatch(taskId);
    for (const taskId of [...this.doingBackgroundGeneration.keys()]) {
      if (!wanted.has(taskId)) this.stopDoingBackgroundWatch(taskId);
    }
  }

  private ensureDoingBackgroundWatch(taskId: string): void {
    const task = this.tasks().find((item) => item.task_id === taskId);
    if (!task || !taskNeedsDoingBackgroundPoll(task, task.subproject_id ? this.subprojectCursorAgentId(task.subproject_id) : undefined)) {
      this.stopDoingBackgroundWatch(taskId);
      return;
    }
    if (this.doingBackgroundGeneration.has(taskId)) return;
    const generation = (this.doingBackgroundGeneration.get(taskId) ?? 0) + 1;
    this.doingBackgroundGeneration.set(taskId, generation);
    this.scheduleDoingBackgroundTick(taskId, generation, 0);
  }

  private stopDoingBackgroundWatch(taskId: string): void {
    this.doingBackgroundGeneration.set(taskId, (this.doingBackgroundGeneration.get(taskId) ?? 0) + 1);
    this.doingBackgroundGeneration.delete(taskId);
    const timer = this.doingBackgroundTimer.get(taskId);
    if (timer) clearTimeout(timer);
    this.doingBackgroundTimer.delete(taskId);
    this.doingBackgroundInflight.delete(taskId);
  }

  private scheduleDoingBackgroundTick(taskId: string, generation: number, attempt: number): void {
    if (this.doingBackgroundGeneration.get(taskId) !== generation) return;
    if (attempt >= POLL_ATTEMPTS) return;
    const timer = setTimeout(() => {
      void this.runDoingBackgroundTick(taskId, generation, attempt);
    }, attempt === 0 ? 0 : POLL_INTERVAL_MS);
    this.doingBackgroundTimer.set(taskId, timer);
  }

  private async runDoingBackgroundTick(taskId: string, generation: number, attempt: number): Promise<void> {
    if (this.doingBackgroundGeneration.get(taskId) !== generation) return;
    if (this.doingBackgroundInflight.has(taskId)) {
      this.scheduleDoingBackgroundTick(taskId, generation, attempt + 1);
      return;
    }
    this.doingBackgroundInflight.add(taskId);
    try {
      const task = this.tasks().find((item) => item.task_id === taskId);
      if (!task || !taskNeedsDoingBackgroundPoll(task, task.subproject_id ? this.subprojectCursorAgentId(task.subproject_id) : undefined)) {
        this.stopDoingBackgroundWatch(taskId);
        return;
      }
      if (task.output_type === 'subproject' && task.subproject_id) {
        const page = await this.api.listProjectMessages(task.subproject_id);
        if (this.doingBackgroundGeneration.get(taskId) !== generation) return;
        await this.reloadProjects();
        const freshTask = this.tasks().find((item) => item.task_id === taskId) ?? task;
        this.cacheSubprojectTaskChat(taskId, page, freshTask);
        if (this.watchingTaskChat(taskId, this.selection())) this.applyConversation(page);
        const refreshed = await this.api.listTaskMessages(taskId);
        if (this.doingBackgroundGeneration.get(taskId) !== generation) return;
        this.cacheTaskConversation(refreshed);
        this.replaceTask(refreshed.task);
        if (refreshed.task.status !== 'DOING') {
          this.stopDoingBackgroundWatch(taskId);
          return;
        }
      } else {
        const result = await this.api.listTaskMessages(taskId);
        if (this.doingBackgroundGeneration.get(taskId) !== generation) return;
        this.applyTaskConversation(result);
        if (result.task.status !== 'DOING') {
          if (this.watchingTaskChat(taskId, this.selection())) await this.refreshOutput(result.task);
          this.stopDoingBackgroundWatch(taskId);
          return;
        }
      }
    } catch {
      // Keep polling; transient failures should not stop background sync.
    } finally {
      this.doingBackgroundInflight.delete(taskId);
    }
    if (this.doingBackgroundGeneration.get(taskId) === generation) {
      this.scheduleDoingBackgroundTick(taskId, generation, attempt + 1);
    }
  }

  private cacheTaskConversation(result: { messages: ChatMessage[]; task: ProjectTask; artifacts: ChatArtifact[] }): void {
    this.taskChatCache.set(result.task.task_id, {
      messages: result.messages,
      artifacts: result.artifacts ?? [],
      task: result.task,
    });
  }

  private cacheSubprojectTaskChat(taskId: string, page: ConversationPage, task: ProjectTask): void {
    this.taskChatCache.set(taskId, {
      messages: page.messages,
      artifacts: page.artifacts ?? [],
      task,
    });
  }

  private watchProject(projectId: string, runId: string): Promise<void> {
    return this.poll(async (generation) => {
      if (!this.stillWatching(generation) || !this.watchingProjectChat(projectId)) return true;
      const page = await this.api.listProjectMessages(projectId);
      if (!this.stillWatching(generation) || !this.watchingProjectChat(projectId)) return true;
      this.applyConversation(page);
      return hasAssistant(page.messages, runId);
    });
  }

  private watchingTaskChat(taskId: string, selection: Selection): boolean {
    if (selection.kind === 'task' || selection.kind === 'subproject') return selection.taskId === taskId;
    return false;
  }

  private watchingProjectChat(projectId: string): boolean {
    const selection = this.selection();
    if (selection.kind === 'project') return this.projectId() === projectId;
    if (selection.kind === 'subproject') {
      const task = this.selectedTask();
      return task?.subproject_id === projectId;
    }
    return false;
  }

  private watchTask(taskId: string, runId: string): Promise<void> {
    return this.poll(async (generation) => {
      const selection = this.selection();
      if (!this.stillWatching(generation) || !this.watchingTaskChat(taskId, selection)) return true;
      const result = await this.api.listTaskMessages(taskId);
      const current = this.selection();
      if (!this.stillWatching(generation) || !this.watchingTaskChat(taskId, current)) return true;
      this.applyTaskConversation(result);
      await this.refreshOutput(result.task);
      return hasAssistant(result.messages, runId);
    });
  }

  private poll(load: (generation: number) => Promise<boolean>): Promise<void> {
    this.stopWatch();
    const generation = ++this.foregroundWatchGeneration;
    this.pendingReply.set(true);
    return new Promise((resolve) => {
      const finish = (done: boolean, timedOut: boolean) => {
        if (generation !== this.foregroundWatchGeneration) {
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
          this.foregroundWatchTimer = setTimeout(() => tick(attempt + 1), POLL_INTERVAL_MS);
        })();
      };
      tick(0);
    });
  }

  private stillWatching(generation: number): boolean {
    return generation === this.foregroundWatchGeneration;
  }

  private stopWatch(): void {
    this.foregroundWatchGeneration += 1;
    if (this.foregroundWatchTimer) clearTimeout(this.foregroundWatchTimer);
    this.foregroundWatchTimer = undefined;
    this.pendingReply.set(false);
  }

  private applyConversation(page: ConversationPage): void {
    this.messages.set(page.messages);
    this.artifacts.set(page.artifacts ?? []);
  }

  private applyTaskConversation(result: { messages: ChatMessage[]; task: ProjectTask; artifacts: ChatArtifact[] }): void {
    this.cacheTaskConversation(result);
    this.replaceTask(result.task);
    if (this.watchingTaskChat(result.task.task_id, this.selection())) {
      this.messages.set(result.messages);
      this.artifacts.set(result.artifacts ?? []);
    }
  }

  private rememberMessage(message: ChatMessage): void {
    this.messages.update((messages) => messages.some((item) => item.message_id === message.message_id)
      ? messages
      : [...messages, message]);
  }

  private async reloadProjects(): Promise<void> {
    this.projects.set(await this.api.listProjects());
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
      else if (task.output_type === 'research') research[task.task_id] = await this.api.getResearchOutput(task.task_id);
    }));
    this.codeOutputs.set(code);
    this.researchOutputs.set(research);
    await this.refreshPendingChanges();
    this.syncDoingBackgroundWatches();
  }

  private resumeWatchForSelection(): void {
    const projectId = this.projectId();
    if (!projectId) return;
    const selection = this.selection();
    if (selection.kind === 'project') this.continueProjectWatch(projectId);
    else if (selection.kind === 'task' || selection.kind === 'subproject') this.continueTaskWatch(selection.taskId);
    this.syncDoingBackgroundWatches();
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

  private cancelEditorLoading(): void {
    this.editorLoadGeneration++;
    this.editorLoading.set(false);
  }

  private async withEditorLoading(work: () => Promise<void>): Promise<void> {
    const generation = ++this.editorLoadGeneration;
    this.editorLoading.set(true);
    try {
      await work();
    } finally {
      if (generation === this.editorLoadGeneration) {
        this.editorLoading.set(false);
      }
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

function hasUserRun(messages: ChatMessage[], runId: string): boolean {
  return messages.some((message) => message.run_id === runId && message.role === 'user');
}

export type { TaskNode };
