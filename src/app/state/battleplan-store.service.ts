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
import { fieldsFromTaskEditorKind } from '../core/task-editor-kind';
import { layoutMindmap, positionConnectedNode, type CardinalDirection } from '../core/mindmap';
import {
  findLastAssistantTaskGraph,
  generateTasksSourceTaskId,
  prepareGeneratedDraftsForDiscovery,
} from '../core/generate-task-links';
import {
  buildDepthFirstDescentProposalMessage,
  buildDiscoveryArchitectureFanInMessage,
  buildDiscoveryClusterReviewMessage,
  buildPartitionProposalMessage,
  isGenerateTasksEndCommand,
  isGraphCompleteCommand,
  tryParseGeneratedTasksFromSources,
  type GenerateTasksSessionState,
} from '../core/generate-tasks-layered';
import { splitDiscoveryDrafts } from '../core/discovery-cross-graph';
import {
  canOfferDiscoveryJsonImport,
  pendingDiscoveryImportMessage,
  reconcileDiscoverySessionFromChat,
} from '../core/discovery-session-recovery';
import { discoverySessionAfterPartitionGraphImport } from '../core/discovery-session-advance';
import {
  buildDiscoveryCompleteSummary,
  type DiscoveryCompleteSummary,
} from '../core/discovery-summary';
import {
  describeDiscoveryNextAction,
  discoveryMessageKey,
  generateTasksSessionFromPersisted,
  persistedDiscoverySessionFromGenerateTasks,
} from '../core/discovery-session-persist';
import {
  canOfferLegacyDiscoveryResume,
  inferLegacyDiscoverySession,
} from '../core/discovery-legacy-resume';
import {
  appendGraphIndexEntry,
  newDiscoveryGraphId,
  type GraphDiscoveryIndexEntry,
} from '../core/graph-discovery';
import { canRunGenerateTasks } from '../core/task-generate-eligibility';
import { parseGeneratedTasksFromSources } from '../core/parse-tasks';
import {
  assertGeneratedTasksReady,
  validateAndRepairGeneratedTasks,
} from '../core/validate-generated-tasks';
import { buildTaskForest, reorderTaskIds, type TaskNode } from '../core/task-tree';
import { MERGE_CONFLICT_AGENT_RECOVERY_SENTINEL } from '../core/github-client';
import {
  cloneProjectTask,
  coalesceCachedTaskStatus,
  taskBackgroundPollActive,
} from '../core/task-status-coalesce';
import type { MindmapViewState, ProjectWorkspaceUiState } from '../core/project-ui-state';
import type { MindmapLinkRef } from '../core/link-relocation';
import { projectWorkspaceUiFromMindmap } from '../core/project-ui-state';
import { isSubstantiveAgentResponse } from '../core/agent-run-response';
import { doingBackgroundWatchTaskIds, taskNeedsDoingBackgroundPoll } from './doing-background-watch';

const POLL_INTERVAL_MS = 3000;
const POLL_ATTEMPTS = 300;
const GENERATE_TASKS_JSON_REPAIR_ATTEMPTS = 2;

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
  mindmapView: MindmapViewState | null;
}

export interface ProjectWorkspaceSnapshot {
  paneWidth: number;
  mindmapView: MindmapViewState | null;
}

export interface ProjectTabRestore {
  paneWidth: number;
  mindmapView: MindmapViewState | null;
}

export interface TaskPanelErrorState {
  message: string;
  connectionFailed: boolean;
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
  readonly chatAgentSyncing = signal(false);
  readonly chatActionPending = signal<'send' | 'execute' | 'merge' | null>(null);
  readonly pendingChanges = signal<PendingChange[]>([]);
  readonly agents = signal<ProjectAgent[]>([]);
  readonly openTabs = signal<string[]>([]);
  readonly taskPanelErrors = signal<Record<string, TaskPanelErrorState>>({});
  readonly generateTasksSession = signal<GenerateTasksSessionState | null>(null);
  readonly discoveryCompleteSummary = signal<DiscoveryCompleteSummary | null>(null);

  dismissDiscoveryCompleteSummary(): void {
    this.discoveryCompleteSummary.set(null);
  }

  hasActiveDiscoverySession(taskId: string): boolean {
    return Boolean(this.generateTasksSessionFor(taskId) ?? this.hydratedDiscoverySessionForTask(taskId));
  }

  canImportDiscoveryJsonFromChat(taskId: string): boolean {
    const session = this.generateTasksSessionFor(taskId) ?? this.hydratedDiscoverySessionForTask(taskId);
    if (!session) return this.canResumeStuckDiscovery(taskId);
    return canOfferDiscoveryJsonImport(
      session,
      this.messagesForDiscoveryResume(taskId),
      this.artifactsForDiscoveryResume(taskId),
    );
  }

  canResumeStuckDiscovery(taskId: string): boolean {
    if (this.hasActiveDiscoverySession(taskId)) return false;
    const task = this.tasks().find((item) => item.task_id === taskId);
    if (!task) return false;
    return canOfferLegacyDiscoveryResume(
      task,
      this.messagesForDiscoveryResume(taskId),
      this.artifactsForDiscoveryResume(taskId),
      this.project(),
      this.tasks(),
    );
  }

  /** Force Layer-1 partition import from the last assistant JSON (stuck legacy tasks). */
  async forceResumePartitionFromLastReply(): Promise<void> {
    const task = this.selectedTask();
    if (!task || !canRunGenerateTasks(task)) return;
    await this.resumeStuckDiscoveryForTask(task.project_id, task.task_id, { forcePartition: true });
  }

  async resumeStuckDiscovery(): Promise<void> {
    const task = this.selectedTask();
    if (!task) return;
    await this.resumeStuckDiscoveryForTask(task.project_id, task.task_id);
  }

  private messagesForDiscoveryResume(taskId: string): ChatMessage[] {
    const selection = this.selection();
    if (
      (selection.kind === 'task' || selection.kind === 'subproject')
      && selection.taskId === taskId
    ) {
      return this.messages();
    }
    return this.taskChatCache.get(taskId)?.messages ?? [];
  }

  private artifactsForDiscoveryResume(taskId: string): ChatArtifact[] {
    const selection = this.selection();
    if (
      (selection.kind === 'task' || selection.kind === 'subproject')
      && selection.taskId === taskId
    ) {
      return this.artifacts();
    }
    return this.taskChatCache.get(taskId)?.artifacts ?? [];
  }

  private async resumeStuckDiscoveryForTask(
    projectId: string,
    taskId: string,
    options?: { forcePartition?: boolean },
  ): Promise<void> {
    const task = this.tasks().find((item) => item.task_id === taskId);
    if (!task) return;
    let messages = this.messagesForDiscoveryResume(taskId);
    let artifacts = this.artifactsForDiscoveryResume(taskId);
    if (messages.length === 0) {
      const refreshed = await this.api.listTaskMessages(taskId, { syncAgent: false });
      messages = refreshed.messages;
      artifacts = refreshed.artifacts ?? [];
      this.cacheTaskConversation({ ...refreshed, task: refreshed.task });
      const selection = this.selection();
      if (
        (selection.kind === 'task' || selection.kind === 'subproject')
        && selection.taskId === taskId
      ) {
        this.applyTaskConversation(refreshed);
      }
    }
    const inferred = options?.forcePartition
      ? {
        sourceTaskId: taskId,
        phase: 'partition' as const,
        layer: 1,
        activeGraphId: newDiscoveryGraphId(),
        activeGraphGoal: task.title,
        partitionTitles: [],
        partitionIndex: 0,
      }
      : inferLegacyDiscoverySession(task, messages, artifacts, this.project(), this.tasks());
    if (!inferred) {
      this.error.set('Could not resume Start Discovery on this task.');
      this.adoptGlobalErrorAsTaskPanel(taskId);
      return;
    }
    this.clearTaskPanelError(taskId);
    const reconciled = reconcileDiscoverySessionFromChat(inferred, messages, artifacts);
    this.generateTasksSession.set(reconciled);
    await this.persistDiscoverySession(projectId, reconciled);
    await this.tryImportDiscoveryJson(projectId, taskId, undefined, { forcePartitionGraph: true, userInitiated: true });
    if (this.error()) this.adoptGlobalErrorAsTaskPanel(taskId);
    else this.notice.set('Start Discovery resumed from this task’s chat history.');
  }

  discoverySessionHint(taskId: string): string | null {
    const session = this.generateTasksSessionFor(taskId)
      ?? this.hydratedDiscoverySessionForTask(taskId);
    return session ? describeDiscoveryNextAction(session) : null;
  }

  private hydratedDiscoverySessionForTask(taskId: string): GenerateTasksSessionState | null {
    const persisted = this.project()?.discovery_session;
    if (!persisted || persisted.source_task_id !== taskId) return null;
    return generateTasksSessionFromPersisted(persisted);
  }

  private hydrateDiscoverySessionFromProject(taskId: string): void {
    const session = this.hydratedDiscoverySessionForTask(taskId);
    if (session) {
      this.generateTasksSession.set(session);
      return;
    }
    if (this.generateTasksSession()?.sourceTaskId === taskId) {
      this.generateTasksSession.set(null);
    }
  }

  private async recoverDiscoveryProgress(projectId: string, taskId: string): Promise<void> {
    this.hydrateDiscoverySessionFromProject(taskId);
    await this.reconcileDiscoverySessionForTask(projectId, taskId);
    if (!this.generateTasksSessionFor(taskId)) {
      if (!this.canResumeStuckDiscovery(taskId)) return;
      const previousError = this.error();
      await this.resumeStuckDiscoveryForTask(projectId, taskId);
      if (this.error() && !previousError) {
        this.error.set(null);
      }
      return;
    }
    if (this.busy()) return;
    await this.tryImportDiscoveryJson(projectId, taskId, undefined, { forcePartitionGraph: true });
  }

  private async reconcileDiscoverySessionForTask(projectId: string, taskId: string): Promise<void> {
    let session = this.generateTasksSessionFor(taskId) ?? this.hydratedDiscoverySessionForTask(taskId);
    if (!session) return;
    let messages = this.messagesForDiscoveryResume(taskId);
    let artifacts = this.artifactsForDiscoveryResume(taskId);
    if (messages.length === 0) {
      const refreshed = await this.api.listTaskMessages(taskId, { syncAgent: false });
      messages = refreshed.messages;
      artifacts = refreshed.artifacts ?? [];
    }
    const reconciled = reconcileDiscoverySessionFromChat(session, messages, artifacts);
    if (reconciled === session) return;
    this.generateTasksSession.set(reconciled);
    await this.persistDiscoverySession(projectId, reconciled);
  }

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
  private panelRefreshGeneration = 0;
  private foregroundWatchTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly tabSnapshots = new Map<string, ProjectTabSnapshot>();
  private readonly taskChatCache = new Map<string, { messages: ChatMessage[]; artifacts: ChatArtifact[]; task: ProjectTask }>();
  private readonly doingBackgroundGeneration = new Map<string, number>();
  private readonly doingBackgroundTimer = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly doingBackgroundInflight = new Set<string>();
  private projectBackgroundGeneration = 0;
  private projectBackgroundActive = false;
  private projectBackgroundTimer: ReturnType<typeof setTimeout> | undefined;
  private projectBackgroundInflight = false;

  async loadProjects(): Promise<ProjectTabRestore | null> {
    let restored: ProjectTabRestore | null = null;
    await this.run(async () => {
      const projects = await this.api.listProjects();
      this.projects.set(projects);
      const preferred = this.preferences.currentProjectId();
      const savedOpen = this.preferences.openProjectIds().filter((projectId) =>
        projects.some((item) => item.project_id === projectId),
      );
      let tabs = savedOpen.length > 0 ? savedOpen : [];
      const fallback = preferred && projects.some((item) => item.project_id === preferred)
        ? preferred
        : projects[0]?.project_id;
      if (tabs.length === 0 && fallback) tabs = [fallback];
      if (tabs.length > 0) this.openTabs.set(tabs);
      const active = preferred && tabs.includes(preferred) ? preferred : tabs[0] ?? null;
      if (!this.projectId() && active) {
        restored = await this.openProjectTab(active, {
          paneWidth: this.preferences.paneWidth(),
          mindmapView: null,
        });
      } else {
        await this.persistOpenSession();
      }
      if (projects.length === 0) this.selection.set({ kind: 'create' });
    });
    return restored;
  }

  snapshotWorkspace(workspace: ProjectWorkspaceSnapshot): ProjectTabSnapshot {
    return {
      selection: this.selection(),
      tasks: this.tasks(),
      messages: this.messages(),
      artifacts: this.artifacts(),
      agents: this.agents(),
      codeOutputs: this.codeOutputs(),
      researchOutputs: this.researchOutputs(),
      pendingChanges: this.pendingChanges(),
      paneWidth: workspace.paneWidth,
      mindmapView: workspace.mindmapView,
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

  async openProjectTab(projectId: string, workspace: ProjectWorkspaceSnapshot): Promise<ProjectTabRestore> {
    const currentId = this.projectId();
    if (currentId && currentId !== projectId) {
      this.tabSnapshots.set(currentId, this.snapshotWorkspace(workspace));
      void this.saveProjectWorkspaceUi(currentId, workspace.paneWidth, workspace.mindmapView);
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
      await this.persistOpenSession();
      return { paneWidth: cached.paneWidth, mindmapView: cached.mindmapView };
    }
    const persisted = await this.api.getProjectUiState(projectId);
    const paneWidth = persisted?.pane_width ?? workspace.paneWidth;
    const mindmapView = persisted
      ? {
        zoom: persisted.mindmap_zoom,
        origin_x: persisted.mindmap_origin_x,
        origin_y: persisted.mindmap_origin_y,
      }
      : null;
    await this.selectProject(projectId);
    this.tabSnapshots.set(projectId, this.snapshotWorkspace({ paneWidth, mindmapView }));
    await this.persistOpenSession();
    return { paneWidth, mindmapView };
  }

  async switchProjectTab(projectId: string, workspace: ProjectWorkspaceSnapshot): Promise<ProjectTabRestore> {
    return this.openProjectTab(projectId, workspace);
  }

  async saveProjectWorkspaceUi(
    projectId: string,
    paneWidth: number,
    mindmapView: MindmapViewState | null,
  ): Promise<void> {
    if (!mindmapView) return;
    const state: ProjectWorkspaceUiState = projectWorkspaceUiFromMindmap(paneWidth, mindmapView);
    await this.api.saveProjectUiState(projectId, state);
  }

  private async persistOpenSession(): Promise<void> {
    await this.preferences.saveOpenSession(this.openTabs(), this.projectId());
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
      await this.persistOpenSession();
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
    const project = await this.api.ensureAgentLibrary(projectId);
    this.projects.update((projects) => projects.map((item) => item.project_id === project.project_id ? project : item));
    this.agents.set(await this.api.listProjectAgents(projectId));
  }

  selectAgent(agentId: string): void {
    this.selection.set({ kind: 'agent', agentId });
  }

  selectAgentCreate(role: 'research' | 'code'): void {
    this.selection.set({ kind: 'agent-create', role });
  }

  discardAgentDraft(agentId: string): void {
    if (!isAgentDraftId(agentId)) return;
    this.agents.update((agents) => agents.filter((item) => item.agent_id !== agentId));
    this.selection.set({ kind: 'project' });
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
        if (input.adminApiKeyEdited && input.admin_api_key?.trim()) {
          agent.admin_api_key = input.admin_api_key.trim();
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
      if (input.adminApiKeyEdited) {
        updated.admin_api_key = input.admin_api_key?.trim() || undefined;
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

  async persistAgentTestResult(
    agentId: string,
    patch: Pick<ProjectAgent, 'last_test_at' | 'last_test_status' | 'last_test_message'>,
  ): Promise<void> {
    const projectId = this.projectId();
    if (!projectId) return;
    const agents = this.agents().map((item) => (item.agent_id === agentId ? { ...item, ...patch } : item));
    await this.persistAgentList(projectId, agents);
  }

  private async persistAgentList(projectId: string, agents: ProjectAgent[]): Promise<void> {
    const persisted = agents.filter((agent) => !isAgentDraftId(agent.agent_id));
    await this.api.saveProjectAgents(projectId, persisted);
    this.agents.set(agents);
  }

  async releasePendingChanges(): Promise<void> {
    const projectId = this.projectId();
    if (!projectId) return;
    try {
      const project = await this.api.prepareReleaseProjectChanges(projectId);
      this.projects.update((projects) => projects.map((item) => (
        item.project_id === project.project_id ? project : item
      )));
      const page = await this.api.listProjectMessages(projectId, { syncAgent: false });
      if (this.projectId() === projectId && this.watchingProjectChat(projectId)) {
        this.applyConversation(page);
      }
      this.notice.set('Release started. Merging to main in the background.');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not start release.');
      return;
    }
    void this.finishReleaseProjectChanges(projectId);
  }

  async transitionProject(status: TaskStatus, manual: boolean): Promise<void> {
    const project = this.project();
    if (!project) return;
    await this.run(async () => {
      const updated = await this.api.transitionProject(project.project_id, status, manual);
      this.projects.update((projects) => projects.map((item) => (
        item.project_id === updated.project_id ? updated : item
      )));
      this.applyConversation(await this.api.listProjectMessages(project.project_id));
    });
  }

  async approveProjectRelease(): Promise<void> {
    const project = this.project();
    if (!project) return;
    const projectId = project.project_id;
    await this.run(async () => {
      const updated = await this.api.approveProjectRelease(projectId);
      this.projects.update((projects) => projects.map((item) => (
        item.project_id === updated.project_id ? updated : item
      )));
      this.applyConversation(await this.api.listProjectMessages(projectId));
      this.notice.set('Version branch merged into develop.');
    });
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

  async saveProject(patch: {
    title: string;
    repo_url: string;
    starting_ref: string;
    github_pat: string;
    dar: string;
    initial_prompt?: string;
    default_research_agent_id?: string;
    default_code_agent_id?: string;
  }): Promise<void> {
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
    this.stopWatch();
    this.selection.set({ kind: 'project' });
    const generation = ++this.panelRefreshGeneration;
    try {
      const page = await this.api.listProjectMessages(projectId, { syncAgent: false });
      if (generation !== this.panelRefreshGeneration) return;
      this.applyConversation(page);
      await this.refreshPendingChanges();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not load project chat.');
    }
    void this.syncProjectPanelAfterOpen(projectId, generation);
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

  taskPanelError(taskId: string): TaskPanelErrorState | null {
    return this.taskPanelErrors()[taskId] ?? null;
  }

  async retryTaskAgentConnection(taskId: string): Promise<void> {
    const existing = this.tasks().find((item) => item.task_id === taskId);
    const kind = existing?.output_type === 'subproject' ? 'subproject' : 'task';
    await this.syncTaskPanelAfterOpen(taskId, kind, existing, this.panelRefreshGeneration);
  }

  generateTasksSessionFor(taskId: string): GenerateTasksSessionState | null {
    const session = this.generateTasksSession();
    return session?.sourceTaskId === taskId ? session : null;
  }

  canRunGenerateTasksOnSelectedTask(): boolean {
    return canRunGenerateTasks(this.selectedTask() ?? undefined);
  }

  async generateTasks(): Promise<void> {
    const projectId = this.projectId();
    if (!projectId) return;
    const selection = this.selection();
    const taskId = generateTasksSourceTaskId(selection);
    const sourceTask = taskId ? this.tasks().find((item) => item.task_id === taskId) : undefined;
    if (taskId && sourceTask && !canRunGenerateTasks(sourceTask)) {
      this.error.set('Start Discovery is only available on Brainstorm and Research discovery tasks.');
      this.adoptGlobalErrorAsTaskPanel(taskId);
      return;
    }
    const layered = Boolean(taskId && sourceTask && canRunGenerateTasks(sourceTask));
    const graphId = newDiscoveryGraphId();
    if (layered && taskId && sourceTask) {
      const session: GenerateTasksSessionState = {
        sourceTaskId: taskId,
        phase: 'partition',
        layer: 1,
        activeGraphId: graphId,
        activeGraphGoal: sourceTask.title,
        partitionTitles: [],
        partitionIndex: 0,
      };
      this.generateTasksSession.set(session);
      if (sourceTask.status !== 'DOING' && sourceTask.status !== 'DONE') {
        await this.run(async () => {
          this.replaceTask(await this.api.updateTask(projectId, taskId, { status: 'DOING', manual: true }));
        });
      }
      await this.persistDiscoverySession(projectId, session);
    }
    let runId: string | undefined;
    await this.run(async () => {
      if (layered && taskId && sourceTask) {
        const session = this.generateTasksSession()!;
        const text = buildPartitionProposalMessage(sourceTask, this.project(), session);
        const sent = await this.api.generateLayeredTaskTasks(taskId, 1, text);
        runId = sent.run_id;
        this.rememberMessage(sent);
      } else if (taskId) {
        this.error.set('Start Discovery is only available on Brainstorm and Research discovery tasks.');
      } else {
        this.error.set('Open a Brainstorm or Research discovery task to run Start Discovery.');
      }
    });
    if (this.error() && taskId) this.adoptGlobalErrorAsTaskPanel(taskId);
    if (!runId || this.error()) return;
    if (!layered) return;
    const generateRunId = runId;
    if (taskId) await this.watchTask(taskId, generateRunId);
    else await this.watchProject(projectId, generateRunId);
    await this.run(async () => {
      if (taskId) {
        const refreshed = await this.api.listTaskMessages(taskId);
        this.applyTaskConversation(refreshed);
      } else {
        this.applyConversation(await this.api.listProjectMessages(projectId));
      }
    });
    if (this.error() && taskId) this.adoptGlobalErrorAsTaskPanel(taskId);
    const reply = this.messages().find((message) => message.run_id === generateRunId && message.role === 'assistant');
    if (!reply) {
      const message = layered
        ? 'The Cursor agent has not replied yet. Reply in chat with approve, disapprove, change, or END.'
        : 'The Cursor agent has not replied yet.';
      if (taskId) {
        this.setTaskPanelError(taskId, { message, connectionFailed: false });
        this.error.set(null);
      } else {
        this.error.set(message);
      }
      return;
    }
    if (layered && taskId) {
      await this.tryImportDiscoveryJson(projectId, taskId, generateRunId);
    }
    if (this.error() && taskId) this.adoptGlobalErrorAsTaskPanel(taskId);
  }

  /** Recovery: scan the task chat for the latest assistant message containing task JSON. */
  async importDiscoveryJsonFromLastAssistant(): Promise<void> {
    const task = this.selectedTask();
    if (!task) return;
    this.hydrateDiscoverySessionFromProject(task.task_id);
    await this.run(async () => {
      const refreshed = await this.api.listTaskMessages(task.task_id, { syncAgent: false });
      this.cacheTaskConversation({ ...refreshed, task: refreshed.task });
      if (this.selection().taskId === task.task_id) {
        this.applyTaskConversation(refreshed);
      }
    });
    await this.reconcileDiscoverySessionForTask(task.project_id, task.task_id);
    if (!this.generateTasksSessionFor(task.task_id) && this.canResumeStuckDiscovery(task.task_id)) {
      await this.resumeStuckDiscoveryForTask(task.project_id, task.task_id);
      if (this.error()) {
        this.adoptGlobalErrorAsTaskPanel(task.task_id);
      }
      return;
    }
    const session = this.generateTasksSessionFor(task.task_id);
    if (!session) {
      this.error.set('No active Start Discovery session on this task.');
      this.adoptGlobalErrorAsTaskPanel(task.task_id);
      return;
    }
    this.clearTaskPanelError(task.task_id);
    await this.tryImportDiscoveryJson(task.project_id, task.task_id, undefined, {
      forcePartitionGraph: true,
      userInitiated: true,
    });
    if (this.error()) this.adoptGlobalErrorAsTaskPanel(task.task_id);
    else this.notice.set('Task graph imported from the last assistant reply.');
  }

  private findDiscoveryImportMessage(runId?: string): ChatMessage | null {
    if (runId) {
      const byRun = this.messages().find((message) => message.run_id === runId && message.role === 'assistant');
      if (byRun && tryParseGeneratedTasksFromSources(byRun.content, this.artifacts())) return byRun;
    }
    return findLastAssistantTaskGraph(this.messages(), this.artifacts());
  }

  private async persistDiscoverySession(projectId: string, session: GenerateTasksSessionState): Promise<void> {
    const payload = persistedDiscoverySessionFromGenerateTasks(session);
    await this.run(async () => {
      this.projects.update((projects) => projects.map((item) => item.project_id === projectId
        ? { ...item, discovery_session: payload }
        : item));
      await this.api.updateProject(projectId, { discovery_session: payload });
    });
  }

  private async tryImportDiscoveryJson(
    projectId: string,
    sourceTaskId: string,
    runId?: string,
    options?: { forcePartitionGraph?: boolean; userInitiated?: boolean },
  ): Promise<void> {
    const session = this.generateTasksSessionFor(sourceTaskId);
    if (!session) return;
    const reply = this.findDiscoveryImportMessage(runId);
    if (!reply) {
      if (options?.userInitiated) {
        this.error.set('No assistant message with task graph JSON found in this chat.');
      }
      return;
    }
    let parsed: ReturnType<typeof parseGeneratedTasksFromSources> | null = null;
    try {
      parsed = parseGeneratedTasksFromSources(reply.content, this.artifacts());
    } catch (error) {
      if (options?.userInitiated) {
        this.error.set(error instanceof Error ? error.message : 'Could not parse task graph JSON.');
      }
      return;
    }
    if (!parsed?.tasks.length) {
      if (options?.userInitiated) {
        this.error.set('The assistant reply did not contain any tasks.');
      }
      return;
    }

    const messageKey = discoveryMessageKey(reply);
    if (session.lastImportedMessageKey === messageKey) return;

    const importRunId = reply.run_id ?? runId ?? `discovery-recovery-${Date.now()}`;
    const phaseBefore = session.phase;
    const awaitingGraph = session.awaitingGraphJson || options?.forcePartitionGraph;
    const closingStep = session.closingStep;

    if (phaseBefore === 'depth_first' && !awaitingGraph && closingStep !== 'architecture') {
      if (options?.userInitiated) {
        this.error.set('Discovery is waiting for GRAPH DONE before importing partition graph JSON.');
      }
      return;
    }
    if (phaseBefore === 'cluster_review') {
      return;
    }

    await this.run(async () => {
      await this.importGeneratedTasksFromReply(projectId, sourceTaskId, importRunId, session.layer, reply);
    });
    if (this.error()) return;

    const sessionAfter = this.generateTasksSessionFor(sourceTaskId);
    if (!sessionAfter) return;

    const importedKeySession: GenerateTasksSessionState = {
      ...sessionAfter,
      lastImportedMessageKey: messageKey,
    };
    this.generateTasksSession.set(importedKeySession);
    await this.persistDiscoverySession(projectId, importedKeySession);

    const parsed = parseGeneratedTasksFromSources(reply.content, this.artifacts());
    const importedTitles = parsed.tasks.map((draft) => draft.title.trim()).filter(Boolean);

    if (phaseBefore === 'partition' && importedTitles.length > 0) {
      const nextGraphId = newDiscoveryGraphId();
      const focus = importedTitles[0];
      const nextSession: GenerateTasksSessionState = {
        ...importedKeySession,
        phase: 'depth_first',
        partitionTitles: importedTitles,
        partitionIndex: 0,
        focusPartitionTitle: focus,
        layer: 1,
        activeGraphId: nextGraphId,
        activeGraphGoal: focus,
        awaitingGraphJson: false,
      };
      this.generateTasksSession.set(nextSession);
      await this.persistDiscoverySession(projectId, nextSession);
      await this.run(async () => {
        const text = buildDepthFirstDescentProposalMessage(this.project(), nextSession);
        const sent = await this.api.generateLayeredTaskTasks(sourceTaskId, 1, text);
        this.rememberMessage(sent);
      });
      return;
    }

    if (phaseBefore === 'depth_first' && awaitingGraph) {
      await this.finalizePartitionGraph(projectId, sourceTaskId, {
        ...importedKeySession,
        awaitingGraphJson: false,
      });
      return;
    }

    if (closingStep === 'architecture' || phaseBefore === 'architecture_pass') {
      await this.finishDiscoveryProcess(projectId, sourceTaskId);
    }
  }

  private async onDiscoveryAssistantTurn(projectId: string, sourceTaskId: string): Promise<void> {
    const session = this.generateTasksSessionFor(sourceTaskId);
    if (!session || session.closingStep !== 'cluster_review' || session.architecturePromptSent) return;
    const lastAssistant = [...this.messages()].reverse().find((message) => message.role === 'assistant');
    if (!lastAssistant) return;

    const nextSession: GenerateTasksSessionState = {
      ...session,
      phase: 'architecture_pass',
      closingStep: 'architecture',
      architecturePromptSent: true,
    };
    this.generateTasksSession.set(nextSession);
    await this.persistDiscoverySession(projectId, nextSession);
    let archRunId: string | undefined;
    await this.run(async () => {
      const text = buildDiscoveryArchitectureFanInMessage(this.project());
      const sent = await this.api.generateLayeredTaskTasks(sourceTaskId, session.layer, text);
      archRunId = sent.run_id;
      this.rememberMessage(sent);
    });
    if (!archRunId || this.error()) return;
    await this.watchTask(sourceTaskId, archRunId);
    await this.run(async () => {
      this.applyTaskConversation(await this.api.listTaskMessages(sourceTaskId));
    });
    await this.tryImportDiscoveryJson(projectId, sourceTaskId, archRunId);
    if (this.generateTasksSessionFor(sourceTaskId)) {
      await this.finishDiscoveryProcess(projectId, sourceTaskId);
    }
  }

  private graphTasksForSession(session: GenerateTasksSessionState): ProjectTask[] {
    return this.tasks().filter((task) => task.graph_id === session.activeGraphId);
  }

  private async completeActiveDiscoveryGraph(
    projectId: string,
    session: GenerateTasksSessionState,
    extra?: Pick<GraphDiscoveryIndexEntry, 'partition_title' | 'task_count' | 'patterns_used'>,
  ): Promise<void> {
    const graphTasks = this.graphTasksForSession(session);
    const patterns = extra?.patterns_used ?? [
      ...new Set(graphTasks.map((task) => task.pattern_id).filter(Boolean) as string[]),
    ];
    const entry: GraphDiscoveryIndexEntry = {
      graph_id: session.activeGraphId,
      root_task_id: session.sourceTaskId,
      final_goal: session.activeGraphGoal,
      task_summary: graphTasks.map((t) => `${t.title} (${t.output_type})`).join('; ') || session.activeGraphGoal,
      completed_at: new Date().toISOString(),
      partition_title: extra?.partition_title ?? session.focusPartitionTitle,
      task_count: extra?.task_count ?? graphTasks.length,
      patterns_used: patterns,
    };
    const project = this.project();
    const index = appendGraphIndexEntry(project?.graph_discovery_index, entry);
    await this.run(async () => {
      const updated = await this.api.updateProject(projectId, { graph_discovery_index: index });
      this.projects.update((projects) => projects.map((p) => (p.project_id === updated.project_id ? updated : p)));
    });
  }

  private async finalizePartitionGraph(
    projectId: string,
    sourceTaskId: string,
    session: GenerateTasksSessionState,
  ): Promise<void> {
    await this.completeActiveDiscoveryGraph(projectId, session);
    const advanced = discoverySessionAfterPartitionGraphImport({
      ...session,
      awaitingGraphJson: false,
    });
    if (advanced.phase === 'cluster_review') {
      await this.startDiscoveryClosing(projectId, sourceTaskId, advanced);
      return;
    }
    this.generateTasksSession.set(advanced);
    await this.persistDiscoverySession(projectId, advanced);
    await this.run(async () => {
      const text = buildDepthFirstDescentProposalMessage(this.project(), advanced);
      const sent = await this.api.generateLayeredTaskTasks(sourceTaskId, 1, text);
      this.rememberMessage(sent);
    });
    this.notice.set(`Partition graph saved. Depth-first discovery for "${advanced.focusPartitionTitle}".`);
  }

  private async startDiscoveryClosing(
    projectId: string,
    sourceTaskId: string,
    session: GenerateTasksSessionState,
  ): Promise<void> {
    const sourceTask = this.tasks().find((item) => item.task_id === sourceTaskId);
    if (!sourceTask) return;
    const nextSession: GenerateTasksSessionState = {
      ...session,
      phase: 'cluster_review',
      closingStep: 'cluster_review',
      architecturePromptSent: false,
      awaitingGraphJson: false,
    };
    this.generateTasksSession.set(nextSession);
    await this.persistDiscoverySession(projectId, nextSession);
    let clusterRunId: string | undefined;
    await this.run(async () => {
      const text = buildDiscoveryClusterReviewMessage(this.project(), sourceTask);
      const sent = await this.api.generateLayeredTaskTasks(sourceTaskId, session.layer, text);
      clusterRunId = sent.run_id;
      this.rememberMessage(sent);
    });
    this.notice.set('All partition graphs indexed. Cluster review started.');
    if (!clusterRunId || this.error()) return;
    await this.watchTask(sourceTaskId, clusterRunId);
    await this.run(async () => {
      this.applyTaskConversation(await this.api.listTaskMessages(sourceTaskId));
    });
    await this.onDiscoveryAssistantTurn(projectId, sourceTaskId);
  }

  private async finishDiscoveryProcess(projectId: string, sourceTaskId: string): Promise<void> {
    const summary = buildDiscoveryCompleteSummary(this.project(), this.tasks(), sourceTaskId);
    this.discoveryCompleteSummary.set(summary);
    this.generateTasksSession.set(null);
    await this.run(async () => {
      await this.api.updateProject(projectId, { discovery_session: undefined });
    });
    const task = this.tasks().find((item) => item.task_id === sourceTaskId);
    if (task && canRunGenerateTasks(task) && task.status === 'DOING') {
      await this.run(async () => {
        this.replaceTask(await this.api.updateTask(task.project_id, sourceTaskId, { status: 'DONE', manual: true }));
      });
    }
    this.notice.set('Start Discovery finished.');
  }

  private async abortDiscoverySession(taskId: string, projectId: string): Promise<void> {
    const session = this.generateTasksSession();
    if (!session || session.sourceTaskId !== taskId) return;
    this.generateTasksSession.set(null);
    await this.run(async () => {
      await this.api.updateProject(projectId, { discovery_session: undefined });
    });
    this.notice.set('Start Discovery aborted.');
  }

  private async importGeneratedTasksFromReply(
    projectId: string,
    taskId: string | undefined,
    initialRunId: string,
    layer = 1,
    assistantOverride?: ChatMessage,
  ): Promise<void> {
    const sourceTask = taskId ? this.tasks().find((item) => item.task_id === taskId) : undefined;
    const existingTasks = this.tasks().filter((item) => item.project_id === projectId);
    let runId = initialRunId;
    let validation = this.validateGenerateTasksAssistantRun(
      runId,
      sourceTask,
      taskId,
      existingTasks,
      layer,
      assistantOverride,
    );

    for (let repair = 0; repair <= GENERATE_TASKS_JSON_REPAIR_ATTEMPTS && !validation.valid; repair++) {
      if (repair === GENERATE_TASKS_JSON_REPAIR_ATTEMPTS) {
        assertGeneratedTasksReady(validation);
        return;
      }
      let repairRunId: string | undefined;
      await this.run(async () => {
        const sent = taskId
          ? await this.api.repairGenerateTasksJson(taskId, validation.issues)
          : await this.api.repairGenerateTasksJsonForProject(projectId, validation.issues);
        repairRunId = sent.run_id;
        this.rememberMessage(sent);
      });
      if (!repairRunId || this.error()) return;
      if (taskId) await this.watchTask(taskId, repairRunId);
      else await this.watchProject(projectId, repairRunId);
      await this.run(async () => {
        if (taskId) {
          const refreshed = await this.api.listTaskMessages(taskId);
          this.applyTaskConversation(refreshed);
        } else {
          this.applyConversation(await this.api.listProjectMessages(projectId));
        }
      });
      runId = repairRunId;
      validation = this.validateGenerateTasksAssistantRun(runId, sourceTask, taskId, existingTasks, layer);
    }

    const session = taskId ? this.generateTasksSessionFor(taskId) : null;
    const discoverySession = session ?? {
      phase: 'partition' as const,
      layer,
      focusPartitionTitle: undefined,
    };
    const mappedDrafts = validation.payload.tasks.map((draft) => ({
      ...draft,
      graph_id: draft.graph_id ?? session?.activeGraphId,
    }));
    const { creates, updates } = splitDiscoveryDrafts(mappedDrafts, existingTasks);
    if (updates.length) {
      await this.run(async () => {
        for (const update of updates) {
          await this.api.updateTask(projectId, update.task_id, {
            title: update.title,
            initial_prompt: update.prompt,
            output_type: update.output_type,
            node_kind: update.node_kind,
            graph_id: update.graph_id,
            pattern_id: update.pattern_id,
            cross_graph_edit_rationale: update.cross_graph_edit_rationale,
          });
        }
      });
      await this.reloadTasks();
    }
    const drafts = prepareGeneratedDraftsForDiscovery(creates, sourceTask, discoverySession);
    const parentTaskId = session?.phase === 'partition' ? taskId : undefined;
    const importReply = assistantOverride
      ?? this.messages().find((message) => message.run_id === runId && message.role === 'assistant')
      ?? findLastAssistantTaskGraph(this.messages(), this.artifacts());
    if (drafts.length) {
      await this.api.createTasks(projectId, drafts, parentTaskId, validation.payload.edges, {
        sourceTaskId: taskId,
        agentBranchHint: taskId ? this.researchOutputs()[taskId]?.branch ?? undefined : undefined,
        assistantReplyText: importReply?.content,
      });
      await this.reloadTasks();
    }
    const createdCount = drafts.length;
    const updatedCount = updates.length;
    if (!createdCount && !updatedCount) return;
    const needsGitMirror = drafts.some((draft) => draft.brief_path || draft.repo_path || draft.git_paths?.length);
    const mirrorHint = needsGitMirror && !this.project()?.github_pat?.trim()
      ? ' Add a GitHub PAT on the project to mirror battleplan/ files from the agent branch into local storage.'
      : needsGitMirror
        ? ' Git collateral will mirror when paths match each task id under battleplan/projects/{project_id}/tasks/{id}/.'
        : '';
    const note = `Discovery import: ${createdCount} created${updatedCount ? `, ${updatedCount} updated` : ''}.${mirrorHint}`;
    const saved = taskId ? await this.api.noteTask(taskId, note) : await this.api.noteProject(projectId, note);
    this.rememberMessage(saved);
    this.notice.set(note);
  }

  private validateGenerateTasksAssistantRun(
    runId: string,
    sourceTask: ProjectTask | undefined,
    parentTaskId: string | undefined,
    existingTasks: ProjectTask[],
    layer = 1,
    assistantOverride?: ChatMessage,
  ) {
    const reply = assistantOverride
      ?? this.messages().find((message) => message.run_id === runId && message.role === 'assistant')
      ?? findLastAssistantTaskGraph(this.messages(), this.artifacts());
    if (!reply) {
      throw new Error('The Cursor agent has not replied yet.');
    }
    const session = parentTaskId ? this.generateTasksSessionFor(parentTaskId) : null;
    const discoverySession = session ?? {
      phase: 'partition' as const,
      layer,
      focusPartitionTitle: undefined,
    };
    const parsed = parseGeneratedTasksFromSources(reply.content, this.artifacts());
    const drafts = prepareGeneratedDraftsForDiscovery(parsed.tasks, sourceTask, discoverySession);
    const anchorParentId = session?.phase === 'partition' ? parentTaskId : undefined;
    const projectId = sourceTask?.project_id ?? existingTasks[0]?.project_id;
    return validateAndRepairGeneratedTasks(
      { tasks: drafts, edges: parsed.edges },
      { existingTasks, parentTaskId: anchorParentId, projectId },
    );
  }

  async openTask(taskId: string): Promise<void> {
    this.stopWatch();
    this.error.set(null);
    const existing = this.tasks().find((item) => item.task_id === taskId);
    const kind = existing?.output_type === 'subproject' ? 'subproject' : 'task';
    this.selection.set({ kind, taskId });
    this.hydrateDiscoverySessionFromProject(taskId);
    const generation = ++this.panelRefreshGeneration;
    const cached = this.taskChatCache.get(taskId);
    if (cached) {
      this.messages.set(cached.messages);
      this.artifacts.set(cached.artifacts);
      this.applyCachedTaskSnapshot(taskId, cached.task);
    } else {
      try {
        if (kind === 'subproject' && existing?.subproject_id) {
          const page = await this.api.listProjectMessages(existing.subproject_id, { syncAgent: false });
          if (generation !== this.panelRefreshGeneration) return;
          this.cacheSubprojectTaskChat(taskId, page, existing);
          this.applyConversation(page);
        } else {
          const result = await this.api.listTaskMessages(taskId, { syncAgent: false });
          if (generation !== this.panelRefreshGeneration) return;
          this.applyTaskConversation(result);
        }
      } catch (error) {
        this.setTaskPanelError(taskId, {
          message: error instanceof Error ? error.message : 'Could not load task chat.',
          connectionFailed: true,
        });
      }
    }
    void this.syncTaskPanelAfterOpen(taskId, kind, existing, generation);
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
    taskKind?: import('../core/task-editor-kind').MindmapConnectTaskKind;
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
      project.task_graph_edges,
    );
    const source = layout.nodes.find((node) => node.id === input.sourceId);
    if (!source) return null;
    const placement = positionConnectedNode(source, input.direction);
    const map_x = Math.round(placement.x);
    const map_y = Math.round(placement.y);
    const depends_on = input.sourceKind === 'task' ? input.sourceId : undefined;
    const taskFields = input.taskKind
      ? fieldsFromTaskEditorKind(input.taskKind)
      : { output_type: input.output_type ?? 'research' as OutputType };
    this.stopWatch();
    let taskId = '';
    await this.withEditorLoading(async () => {
      await this.run(async () => {
        const task = await this.api.createTask(projectId, {
          depends_on,
          map_x,
          map_y,
          output_type: taskFields.output_type,
          node_kind: taskFields.node_kind,
          lifecycle_phase: taskFields.lifecycle_phase,
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

  async updateProjectTaskGraph(edges: import('../core/task-graph').TaskGraphEdge[]): Promise<void> {
    const projectId = this.projectId();
    if (!projectId) return;
    await this.run(async () => {
      const tasks = await this.api.updateProjectTaskGraph(projectId, edges);
      for (const task of tasks) this.replaceTask(task);
      this.projects.set(await this.api.listProjects());
      this.notice.set('Task graph updated.');
    });
  }

  async saveTask(patch: {
    title: string;
    dar?: string;
    initial_prompt: string;
    output_type: OutputType;
    node_kind?: import('../core/task-node-kind').TaskNodeKind;
    lifecycle_phase?: import('../core/models').LifecyclePhase;
    repo_path?: string;
    execute_config?: import('../core/n8n-workflow').ExecuteTaskConfig;
    dependencies: string[];
    sibling_dependencies: string[];
    research_agent_id?: string;
    code_agent_id?: string;
    brief?: import('../core/task-brief').TaskBrief;
    regenerate_brief?: boolean;
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
    const taskId = task.task_id;
    const statusBeforeExecute = task.status;
    this.patchTaskStatus(taskId, 'DOING');
    this.syncDoingBackgroundWatches();
    let runId: string | undefined;
    await this.run(async () => {
      const sent = await this.api.executeTask(taskId);
      runId = sent.run_id;
      this.rememberMessage(sent);
      this.applyTaskConversation(await this.api.listTaskMessages(taskId, { syncAgent: false }));
    });
    if (this.error()) {
      this.adoptGlobalErrorAsTaskPanel(taskId);
      this.patchTaskStatus(taskId, statusBeforeExecute);
      this.syncDoingBackgroundWatches();
      return;
    }
    if (runId) {
      await this.syncTaskUserRun(taskId, runId);
      void this.watchTask(taskId, runId).finally(() => this.syncDoingBackgroundWatches());
      this.ensureDoingBackgroundWatch(taskId);
    }
  }

  async relocateMindmapLink(
    link: MindmapLinkRef,
    end: 'from' | 'to',
    dropNodeId: string,
  ): Promise<void> {
    const projectId = this.projectId();
    if (!projectId) return;
    await this.run(async () => {
      await this.api.relocateMindmapLink(projectId, link, end, dropNodeId);
      await this.reloadTasks();
      this.notice.set('Link updated.');
    });
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
    const taskId = task.task_id;
    const layeredSession = this.generateTasksSessionFor(taskId);
    if (layeredSession && isGenerateTasksEndCommand(message)) {
      await this.abortDiscoverySession(taskId, task.project_id);
    }
    if (layeredSession && isGraphCompleteCommand(message)) {
      const awaiting: GenerateTasksSessionState = {
        ...layeredSession,
        awaitingGraphJson: true,
      };
      this.generateTasksSession.set(awaiting);
      await this.persistDiscoverySession(task.project_id, awaiting);
    }
    this.clearTaskPanelError(taskId);
    this.patchTaskStatus(taskId, 'DOING');
    this.syncDoingBackgroundWatches();
    let runId: string | undefined;
    let watchProjectId: string | undefined;
    await this.run(async () => {
      const sent = await this.api.sendTaskMessage(taskId, message);
      runId = sent.run_id;
      this.rememberMessage(sent);
      if (task.output_type === 'subproject' && task.subproject_id) {
        watchProjectId = task.subproject_id;
        await this.reloadTasks();
        this.applyConversation(await this.api.listProjectMessages(task.subproject_id, { syncAgent: false }));
      } else {
        this.applyTaskConversation(await this.api.listTaskMessages(taskId, { syncAgent: false }));
      }
    });
    if (this.error()) {
      this.adoptGlobalErrorAsTaskPanel(taskId);
      this.patchTaskStatus(taskId, 'REVIEW');
      this.syncDoingBackgroundWatches();
      return;
    }
    if (runId) {
      if (watchProjectId) {
        await this.syncProjectUserRun(watchProjectId, runId);
        void this.watchProject(watchProjectId, runId);
        this.ensureDoingBackgroundWatch(taskId);
      } else {
        await this.syncTaskUserRun(taskId, runId);
        if (this.generateTasksSessionFor(taskId)) {
          await this.watchTask(taskId, runId);
          await this.run(async () => {
            this.applyTaskConversation(await this.api.listTaskMessages(taskId));
          });
          await this.tryImportDiscoveryJson(task.project_id, taskId, runId);
        } else {
          void this.watchTask(taskId, runId).finally(() => this.syncDoingBackgroundWatches());
        }
        this.ensureDoingBackgroundWatch(taskId);
      }
    } else {
      // Synchronous agent replies (e.g. library research) finish in the same request.
      this.syncDoingBackgroundWatches();
    }
    this.syncDoingBackgroundWatches();
  }

  async approve(): Promise<void> {
    const task = this.selectedTask();
    if (!task) return;
    const taskId = task.task_id;
    this.patchTaskStatus(taskId, 'DOING');
    this.syncDoingBackgroundWatches();
    try {
      const prepared = await this.api.prepareApprove(taskId);
      this.replaceTask(prepared.task);
      this.rememberMessage(prepared.message);
      const local = await this.api.listTaskMessages(taskId, { syncAgent: false });
      this.applyTaskConversation(local);
      this.notice.set('Merging pull request in the background.');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not start merge.');
      this.patchTaskStatus(taskId, 'REVIEW');
      this.syncDoingBackgroundWatches();
      return;
    }
    this.ensureDoingBackgroundWatch(taskId);
    void this.finishApproveMerge(taskId);
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
    await this.deleteTasks([taskId]);
  }

  async deleteTasks(taskIds: readonly string[]): Promise<void> {
    const projectId = this.projectId();
    if (!projectId) return;
    const unique = [...new Set(taskIds.map((id) => id.trim()).filter(Boolean))].filter((id) => id !== 'project');
    if (unique.length === 0) return;
    for (const taskId of unique) {
      this.stopDoingBackgroundWatch(taskId);
      this.taskChatCache.delete(taskId);
    }
    this.stopWatch();
    await this.run(async () => {
      for (const taskId of unique) {
        const task = this.tasks().find((item) => item.task_id === taskId);
        if (!task) continue;
        await this.api.deleteTask(task.project_id, taskId);
      }
      await this.reloadTasks();
      this.selection.set({ kind: 'project' });
      this.messages.set([]);
      this.artifacts.set([]);
      this.notice.set(unique.length === 1 ? 'Task deleted.' : `${unique.length} tasks deleted.`);
    });
    await this.run(async () => {
      this.applyConversation(await this.api.listProjectMessages(projectId));
    });
    this.continueProjectWatch(projectId);
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
    const runId = unansweredRunForTask(this.messages(), taskId);
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
    this.syncProjectBackgroundWatch();
  }

  private syncProjectBackgroundWatch(): void {
    const project = this.project();
    const root = project && !project.parent_task_id && !project.parent_project_id ? project : null;
    const needsWatch = Boolean(root && (root.status ?? 'TODO') === 'DOING' && root.cursor_agent_id);
    if (needsWatch && root) {
      this.ensureProjectBackgroundWatch(root.project_id);
    } else {
      this.stopProjectBackgroundWatch();
    }
  }

  private ensureProjectBackgroundWatch(projectId: string): void {
    if (this.projectBackgroundActive) return;
    this.projectBackgroundActive = true;
    const generation = ++this.projectBackgroundGeneration;
    this.scheduleProjectBackgroundTick(projectId, generation, 0);
  }

  private stopProjectBackgroundWatch(): void {
    if (!this.projectBackgroundActive && !this.projectBackgroundTimer) return;
    this.projectBackgroundActive = false;
    this.projectBackgroundGeneration += 1;
    if (this.projectBackgroundTimer) clearTimeout(this.projectBackgroundTimer);
    this.projectBackgroundTimer = undefined;
    this.projectBackgroundInflight = false;
  }

  private scheduleProjectBackgroundTick(projectId: string, generation: number, attempt: number): void {
    if (this.projectBackgroundGeneration !== generation) return;
    if (attempt >= POLL_ATTEMPTS) return;
    this.projectBackgroundTimer = setTimeout(() => {
      void this.runProjectBackgroundTick(projectId, generation, attempt);
    }, attempt === 0 ? 0 : POLL_INTERVAL_MS);
  }

  private async runProjectBackgroundTick(projectId: string, generation: number, attempt: number): Promise<void> {
    if (this.projectBackgroundGeneration !== generation || this.projectBackgroundInflight) {
      this.scheduleProjectBackgroundTick(projectId, generation, attempt + 1);
      return;
    }
    this.projectBackgroundInflight = true;
    try {
      const page = await this.api.listProjectMessages(projectId);
      if (this.projectBackgroundGeneration !== generation) return;
      this.projects.update((projects) => projects.map((item) => (
        item.project_id === page.project?.project_id && page.project ? page.project : item
      )));
      if (this.watchingProjectChat(projectId)) this.applyConversation(page);
      const project = this.projects().find((item) => item.project_id === projectId);
      const status = project?.status ?? 'TODO';
      if (status !== 'DOING') {
        this.stopProjectBackgroundWatch();
        return;
      }
    } catch {
      // Keep polling through transient failures.
    } finally {
      this.projectBackgroundInflight = false;
    }
    if (this.projectBackgroundGeneration === generation) {
      this.scheduleProjectBackgroundTick(projectId, generation, attempt + 1);
    }
  }

  private async syncTaskPanelAfterOpen(
    taskId: string,
    kind: 'task' | 'subproject',
    existing: ProjectTask | undefined,
    generation: number,
  ): Promise<void> {
    if (generation !== this.panelRefreshGeneration) return;
    this.chatAgentSyncing.set(true);
    try {
      if (kind === 'subproject' && existing?.subproject_id) {
        const page = await this.api.listProjectMessages(existing.subproject_id);
        if (generation !== this.panelRefreshGeneration) return;
        const freshTask = this.tasks().find((item) => item.task_id === taskId) ?? existing;
        this.cacheSubprojectTaskChat(taskId, page, freshTask);
        this.applyConversation(page);
        this.continueProjectWatch(existing.subproject_id);
      } else {
        const result = await this.api.listTaskMessages(taskId);
        if (generation !== this.panelRefreshGeneration) return;
        this.applyTaskConversation(result);
        await this.refreshOutput(result.task);
        this.continueTaskWatch(taskId);
        const projectId = this.projectId();
        if (projectId) {
          await this.recoverDiscoveryProgress(projectId, taskId);
        }
      }
      if (generation === this.panelRefreshGeneration) {
        this.clearTaskPanelError(taskId);
      }
    } catch (error) {
      if (generation === this.panelRefreshGeneration) {
        this.setTaskPanelError(taskId, {
          message: error instanceof Error ? error.message : 'This task could not connect to the backend agent.',
          connectionFailed: true,
        });
      }
    } finally {
      if (generation === this.panelRefreshGeneration) {
        this.chatAgentSyncing.set(false);
      }
    }
  }

  private async syncProjectPanelAfterOpen(projectId: string, generation: number): Promise<void> {
    if (generation !== this.panelRefreshGeneration) return;
    this.chatAgentSyncing.set(true);
    try {
      const page = await this.api.listProjectMessages(projectId);
      if (generation !== this.panelRefreshGeneration) return;
      this.applyConversation(page);
      await this.refreshPendingChanges();
      this.continueProjectWatch(projectId);
    } catch (error) {
      if (generation === this.panelRefreshGeneration) {
        this.error.set(error instanceof Error ? error.message : 'Could not sync project chat.');
      }
    } finally {
      if (generation === this.panelRefreshGeneration) {
        this.chatAgentSyncing.set(false);
      }
    }
  }

  private async finishApproveMerge(taskId: string): Promise<void> {
    try {
      const merged = await this.api.executeApproveMerge(taskId);
      this.replaceTask(merged);
      const refreshed = await this.api.listTaskMessages(taskId, { syncAgent: false });
      this.applyTaskConversation(refreshed);
      await this.reloadTasks();
      await this.refreshPendingChanges();
      if (merged.status === 'DONE') {
        this.notice.set('Pull request merged. Task is DONE.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Merge failed.';
      if (message.includes(MERGE_CONFLICT_AGENT_RECOVERY_SENTINEL)) {
        const refreshed = await this.api.listTaskMessages(taskId);
        this.applyTaskConversation(refreshed);
        this.continueTaskWatch(taskId);
        this.ensureDoingBackgroundWatch(taskId);
        this.notice.set('Merge conflict — the task agent is resolving it.');
      } else {
        this.setTaskPanelError(taskId, { message, connectionFailed: false });
        const refreshed = await this.api.listTaskMessages(taskId, { syncAgent: false });
        this.applyTaskConversation(refreshed);
        if (refreshed.task.status === 'REVIEW') {
          this.patchTaskStatus(taskId, 'REVIEW');
        }
      }
    } finally {
      this.syncDoingBackgroundWatches();
    }
  }

  private async finishReleaseProjectChanges(projectId: string): Promise<void> {
    let runId: string | undefined;
    try {
      const message = await this.api.executeReleaseProjectChanges(projectId);
      runId = message.run_id ?? undefined;
      this.pendingChanges.set([]);
      const page = await this.api.listProjectMessages(projectId, { syncAgent: false });
      this.projects.update((projects) => projects.map((item) => (
        item.project_id === page.project?.project_id && page.project ? page.project : item
      )));
      if (this.watchingProjectChat(projectId)) this.applyConversation(page);
      this.notice.set('Released to main. Version bump agent started.');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Release failed.');
      try {
        const page = await this.api.listProjectMessages(projectId, { syncAgent: false });
        this.applyConversation(page);
      } catch {
        // ignore secondary failure
      }
      return;
    }
    if (runId) {
      if (this.watchingProjectChat(projectId)) {
        await this.syncProjectUserRun(projectId, runId);
        void this.watchProject(projectId, runId);
      }
    }
    this.syncProjectBackgroundWatch();
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
        this.applyTaskConversation(refreshed);
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
      task: cloneProjectTask(result.task),
    });
  }

  private cacheSubprojectTaskChat(taskId: string, page: ConversationPage, task: ProjectTask): void {
    this.taskChatCache.set(taskId, {
      messages: page.messages,
      artifacts: page.artifacts ?? [],
      task: cloneProjectTask(task),
    });
  }

  private applyCachedTaskSnapshot(taskId: string, cachedTask: ProjectTask): void {
    const live = this.tasks().find((item) => item.task_id === taskId);
    const subprojectAgentId = live?.subproject_id ? this.subprojectCursorAgentId(live.subproject_id) : undefined;
    const pollActive = live
      ? taskBackgroundPollActive(live, subprojectAgentId, this.doingBackgroundGeneration.has(taskId))
      : this.doingBackgroundGeneration.has(taskId);
    const merged = coalesceCachedTaskStatus(live, { ...cachedTask, task_id: taskId }, pollActive);
    this.replaceTask(merged);
    this.taskChatCache.set(taskId, {
      messages: this.messages(),
      artifacts: this.artifacts(),
      task: cloneProjectTask(merged),
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
    if (page.project) {
      this.projects.update((projects) => projects.map((item) => (
        item.project_id === page.project!.project_id ? page.project! : item
      )));
    }
  }

  private applyTaskConversation(result: { messages: ChatMessage[]; task: ProjectTask; artifacts: ChatArtifact[] }): void {
    const taskId = result.task.task_id;
    const previous = this.tasks().find((item) => item.task_id === taskId)?.status;
    const task = cloneProjectTask({ ...result.task, task_id: taskId });
    this.cacheTaskConversation({ ...result, task });
    this.replaceTask(task);
    if (previous !== task.status) {
      this.syncDoingBackgroundWatches();
    }
    if (this.watchingTaskChat(taskId, this.selection())) {
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

  /** Optimistic status for mindmap/kanban before async engine calls complete. */
  private patchTaskStatus(taskId: string, status: TaskStatus): void {
    const current = this.tasks().find((item) => item.task_id === taskId);
    if (!current || current.status === status) return;
    const patched = cloneProjectTask({ ...current, status, updated_at: new Date().toISOString() });
    this.replaceTask(patched);
    const cached = this.taskChatCache.get(taskId);
    if (cached) {
      this.taskChatCache.set(taskId, {
        ...cached,
        task: cloneProjectTask(patched),
      });
    }
  }

  private setTaskPanelError(taskId: string, error: TaskPanelErrorState): void {
    this.taskPanelErrors.update((current) => ({ ...current, [taskId]: error }));
  }

  private clearTaskPanelError(taskId: string): void {
    this.taskPanelErrors.update((current) => {
      if (!(taskId in current)) return current;
      const next = { ...current };
      delete next[taskId];
      return next;
    });
  }

  private adoptGlobalErrorAsTaskPanel(taskId: string, connectionFailed = false): void {
    const message = this.error();
    if (!message) return;
    this.setTaskPanelError(taskId, { message, connectionFailed });
    this.error.set(null);
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
  const answered = new Set(
    messages
      .filter((message) => message.role === 'assistant' && message.run_id && isSubstantiveAgentResponse(message.content))
      .map((message) => message.run_id),
  );
  return [...messages].reverse().find((message) => message.role === 'user' && message.run_id && !answered.has(message.run_id))?.run_id;
}

function unansweredRunForTask(messages: ChatMessage[], taskId: string): string | undefined {
  const scoped = messages.filter((message) => message.scope === 'task' && message.task_id === taskId);
  return unansweredRun(scoped);
}

function hasAssistant(messages: ChatMessage[], runId: string): boolean {
  return messages.some((message) => (
    message.run_id === runId
    && message.role === 'assistant'
    && isSubstantiveAgentResponse(message.content)
  ));
}

function hasUserRun(messages: ChatMessage[], runId: string): boolean {
  return messages.some((message) => message.run_id === runId && message.role === 'user');
}

export type { TaskNode };
