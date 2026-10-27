import { Component, computed, effect, ElementRef, HostListener, inject, NgZone, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type {
  AgentKind,
  AgentOptionValue,
  AgentType,
  ChatArtifact,
  ChatMessage,
  OutputType,
  ProjectAgent,
  ProjectTask,
  TaskStatus,
} from './core/models';
import { TASK_STATUSES } from './core/models';
import {
  fieldsFromTaskEditorKind,
  taskEditorKindFromTask,
  type TaskEditorKind,
} from './core/task-editor-kind';
import {
  agentLogoPublicPath,
  agentModelOptionDefinition,
  agentOptionRows,
  agentTypesForKind,
  applyAgentTypeChange,
  defaultOptionValues,
  getAgentTypeDefinition,
  isAgentOptionVisible,
  mergeAgentOptions,
} from './core/agent-types';
import { agentCredentialFieldLabel, agentUsesServiceAccountJson } from './core/agent-api-key';
import { applyDynamicModelsToOptions, selectChoicesForOption } from './core/agent-connection';
import type { AgentOptionDefinition } from './core/agent-types';
import { isAgentDraftId } from './core/agent-id';
import { AgentStatsComponent } from './components/agent-stats/agent-stats.component';
import { AgentConnectionService } from './data/agent-connection.service';
import { isMarkdownPath, prepareMarkdown } from './core/markdown';
import { applyTheme, THEMES, type ThemeId } from './core/themes';
import { AppPreferences } from './data/app-preferences.service';
import { electronBridge, isElectronApp } from './data/electron-bridge';
import { CursorKey } from './data/cursor-key.service';
import { ProjectPortability } from './data/project-portability.service';
import {
  cardinalAnchor,
  layoutMindmap,
  mindmapNodesInWorldRect,
  normalizeWorldRect,
  pickCardinalEdge,
  pickNorthWestCorner,
  pointerToWorld,
  type CardinalDirection,
  type MindmapEdge,
  type MindmapNode,
  mindmapNodeAtPoint,
  type WorldRect,
} from './core/mindmap';
import { linkKey, type MindmapLinkRef } from './core/link-relocation';
import {
  clampMindmapZoom,
  mindmapScrollFromView,
  mindmapViewFromScroll,
  type MindmapViewState,
} from './core/project-ui-state';
import { MarkdownComponent } from 'ngx-markdown';
import { editorPanelDirty } from './core/editor-dirty';
import { taskDar, taskInitialPrompt } from './core/task-fields';
import {
  buildDefaultTaskBrief,
  emptyTaskBrief,
  mergeTaskBriefWithDefaults,
  TASK_BRIEF_FIELDS,
  type TaskBrief,
} from './core/task-brief';
import { applyTaskBriefDefaults } from './core/task-lifecycle';
import { workflowHintForTask } from './core/task-workflow-lifecycle';
import {
  buildKanbanBoard,
  listKanbanScopeOptions,
  type KanbanScopeId,
} from './core/kanban-board';
import {
  edgeKey,
  incomingEdges,
  outgoingEdges,
  taskEdgeKindLabel,
  TASK_EDGE_KINDS,
  validateTaskGraphEdges,
  type TaskEdgeKind,
  type TaskGraphEdge,
} from './core/task-graph';
import { normalChildIds } from './core/dependencies';
import { libraryAgentsForKind, taskResearchChatStarted } from './core/agent-bindings';
import { BattleplanStore } from './state/battleplan-store.service';

@Component({
  selector: 'app-root',
  imports: [FormsModule, MarkdownComponent, AgentStatsComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {
  readonly store = inject(BattleplanStore);
  private readonly agentConnections = inject(AgentConnectionService);
  readonly cursorKey = inject(CursorKey);
  readonly preferences = inject(AppPreferences);
  readonly portability = inject(ProjectPortability);
  readonly desktop = isElectronApp();
  readonly themes = THEMES;
  private readonly zone = inject(NgZone);
  readonly statuses = TASK_STATUSES;
  readonly signingOpen = signal(false);
  readonly githubPatOpen = signal(false);
  readonly zoom = signal(1);
  readonly dragPins = signal<Record<string, { x: number; y: number }>>({});
  readonly hoveredConnect = signal<{ nodeId: string; direction: CardinalDirection } | null>(null);
  readonly connectPanel = signal<{ sourceId: string; sourceKind: 'project' | 'task'; direction: CardinalDirection } | null>(null);
  readonly convertPanel = signal<{ taskId: string } | null>(null);
  readonly hoveredConvert = signal<string | null>(null);
  readonly editingNodeId = signal<string | null>(null);
  readonly editDraft = signal('');
  readonly mapDraggingNodeId = signal<string | null>(null);
  readonly mapGroupSelection = signal<readonly string[]>([]);
  readonly mapMarquee = signal<WorldRect | null>(null);
  readonly mapStage = viewChild<ElementRef<HTMLElement>>('mapStage');
  readonly chatTranscript = viewChild<ElementRef<HTMLElement>>('chatTranscript');
  private mapGroupProjectId: string | undefined;
  private edgeHoldTimer: ReturnType<typeof setTimeout> | undefined;
  private convertHoldTimer: ReturnType<typeof setTimeout> | undefined;
  private edgeLongPressFired = false;
  private mapHoverFrame = 0;
  private readonly connectHoldMs = 250;
  private readonly onMapPointerMoveCapture = (event: PointerEvent): void => {
    this.onMapPointerMove(event);
  };
  private readonly onMapDismissCapture = (event: PointerEvent): void => {
    this.onMapDismissPointerDown(event);
  };
  readonly map = computed(() => {
    const project = this.store.project();
    const pins = this.dragPins();
    const tasks = this.store.tasks().map((task) => {
      const pin = pins[task.task_id];
      return pin ? { ...task, map_x: pin.x, map_y: pin.y } : task;
    });
    const projectDrag = pins['project'];
    const projectPin = projectDrag
      ?? (project && Number.isFinite(project.map_x) && Number.isFinite(project.map_y)
        ? { x: project.map_x as number, y: project.map_y as number }
        : undefined);
    return layoutMindmap(
      project?.title ?? 'Project',
      tasks,
      projectPin,
      project?.status,
      project?.task_graph_edges,
    );
  });

  apiKey = '';
  keyError = '';
  replacingKey = false;
  githubPatDraft = '';
  githubPatError = '';
  replacingGithubPat = false;
  readonly themeId = signal<ThemeId>('harbor');
  readonly paneWidth = signal(640);
  readonly updatePrompt = signal<{ version: string; notes: string } | null>(null);
  readonly unsavedPromptOpen = signal(false);
  readonly autoSaveEnabled = signal(false);
  private pendingNavigation: (() => Promise<void>) | null = null;

  title = '';
  initialPrompt = '';
  repoUrl = '';
  startingRef = 'main';
  projectRepo = '';
  projectBranch = 'main';
  projectGithubPat = '';
  projectDar = '';
  defaultResearchAgentId = '';
  defaultCodeAgentId = '';
  taskResearchAgentId = '';
  taskCodeAgentId = '';
  chatDraft = '';
  taskTitle = '';
  taskInitialPrompt = '';
  readonly taskPageTab = signal<'chat' | 'details' | 'graph'>('chat');
  taskBriefForm: TaskBrief = emptyTaskBrief();
  readonly taskBriefFields = TASK_BRIEF_FIELDS;
  readonly projectViewMode = signal<'mindmap' | 'kanban'>('mindmap');
  readonly kanbanScopeId = signal<KanbanScopeId>('main');
  private kanbanScopeProjectId = '';
  graphHierarchyChildId = '';
  graphOrderFromId = '';
  graphFlowFromId = '';
  graphFlowKind: TaskEdgeKind = 'fork';
  graphFlowBreakCondition = '';
  readonly taskEdgeKinds = TASK_EDGE_KINDS;
  readonly taskEdgeKindLabel = taskEdgeKindLabel;
  private taskLinkSyncKey = '';

  readonly kanbanScopeOptions = computed(() => listKanbanScopeOptions(this.store.tasks()));

  readonly kanbanBoard = computed(() => {
    const project = this.store.project();
    if (!project) return [];
    return buildKanbanBoard(this.store.tasks(), project, this.store.agents(), this.kanbanScopeId());
  });
  subprojectInitialPrompt = '';
  outputType: OutputType = 'code';
  taskEditorKind: TaskEditorKind = 'code';
  taskRepoPath = '';
  taskExecuteMode: 'script' | 'workflow' = 'script';
  taskExecuteScript = '';
  taskExecuteWorkflowId = '';
  dependencies: string[] = [];
  siblingDependencies: string[] = [];
  readonly executeChildrenPrompt = signal<string | null>(null);
  readonly selectedMindmapLink = signal<MindmapLinkRef | null>(null);
  readonly linkEndpointDrag = signal<{ link: MindmapLinkRef; end: 'from' | 'to'; x: number; y: number } | null>(null);
  readonly mindmapLinkKey = linkKey;
  readonly displayMindmapEdges = computed(() => {
    const edges = this.map().edges;
    const drag = this.linkEndpointDrag();
    if (!drag) return edges;
    const key = linkKey(drag.link);
    return edges.map((edge) => {
      if (linkKey(edge) !== key) return edge;
      if (drag.end === 'from') return { ...edge, x1: drag.x, y1: drag.y };
      return { ...edge, x2: drag.x, y2: drag.y };
    });
  });
  codeRepo = '';
  codeBranch = '';
  codeMessage = '';
  codeLink = '';
  researchRepo = '';
  researchBranch = '';
  researchMessage = '';
  researchLink = '';
  researchPath = '';

  agentType: AgentType = 'OpenAI';
  agentName = '';
  agentUrl = '';
  agentApiKey = '';
  agentAdminApiKey = '';
  agentOptions: Record<string, AgentOptionValue> = {};
  agentDynamicModelChoices: string[] = [];
  agentNameTouched = false;
  agentUrlTouched = false;
  agentApiKeyEdited = false;
  agentApiKeyFocused = false;
  agentAdminApiKeyEdited = false;
  agentAdminApiKeyFocused = false;
  readonly agentTestMessage = signal<string | null>(null);
  readonly agentTestSuccess = signal(false);
  private agentTestFadeTimer: ReturnType<typeof setTimeout> | undefined;

  private mapViewProjectId = '';
  private pendingMapView: MindmapViewState | null | undefined;
  private uiPersistTimer: ReturnType<typeof setTimeout> | undefined;
  private titleSignature = '';
  private boundTaskFormId = '';
  private boundAgentFormId = '';
  private outputSignature = '';
  private chatTranscriptScrollObserver: ResizeObserver | undefined;
  private chatTranscriptScrollTimer: ReturnType<typeof setTimeout> | undefined;
  private lastChatPanelScrollKey = '';
  private chatScrollSignature = '';
  private readonly onMapWheelCapture = (event: WheelEvent): void => {
    this.onMapWheel(event);
  };

  constructor() {
    effect((onCleanup) => {
      const stage = this.mapStage()?.nativeElement;
      if (!stage) return;
      stage.addEventListener('wheel', this.onMapWheelCapture, { passive: false });
      stage.addEventListener('pointermove', this.onMapPointerMoveCapture);
      onCleanup(() => stage.removeEventListener('wheel', this.onMapWheelCapture));
      onCleanup(() => stage.removeEventListener('pointermove', this.onMapPointerMoveCapture));
    });
    effect((onCleanup) => {
      if (!this.connectPanel()) return;
      window.addEventListener('pointerdown', this.onMapDismissCapture, true);
      onCleanup(() => window.removeEventListener('pointerdown', this.onMapDismissCapture, true));
    });
    effect(() => {
      const selection = this.store.selection();
      const project = selection.kind === 'subproject' ? this.store.editorProject() : this.store.project();
      const signature = project
        ? `${project.project_id}:${project.title}:${project.repo_url ?? ''}:${project.starting_ref ?? ''}:${project.github_pat ?? ''}:${project.dar ?? ''}:${project.initial_prompt}:${project.cursor_agent_id ?? ''}:${selection.kind}`
        : '';
      if (signature === this.titleSignature) return;
      this.titleSignature = signature;
      this.title = project?.title ?? '';
      this.projectRepo = project?.repo_url ?? '';
      this.projectBranch = project?.starting_ref || 'main';
      this.projectGithubPat = project?.github_pat ?? '';
      this.projectDar = project?.dar ?? '';
      this.defaultResearchAgentId = project?.default_research_agent_id ?? '';
      this.defaultCodeAgentId = project?.default_code_agent_id ?? '';
      if (selection.kind === 'subproject') {
        this.subprojectInitialPrompt = project?.initial_prompt ?? '';
      }
    });
    effect(() => {
      const projectId = this.store.project()?.project_id;
      if (projectId === this.mapGroupProjectId) return;
      this.mapGroupProjectId = projectId;
      this.clearMapGroupSelection();
    });

    effect(() => {
      const projectId = this.store.project()?.project_id;
      const stage = this.mapStage()?.nativeElement;
      if (!projectId || !stage || this.mapViewProjectId === projectId) return;
      const view = this.pendingMapView;
      this.pendingMapView = undefined;
      const apply = (): void => {
        if (this.mapViewProjectId === projectId) return;
        if (stage.clientWidth === 0) {
          requestAnimationFrame(apply);
          return;
        }
        this.mapViewProjectId = projectId;
        this.applyMindmapView(view ?? null);
      };
      requestAnimationFrame(apply);
    });

    effect(() => {
      const selection = this.store.selection();
      const task = this.store.selectedTask();
      if (selection.kind !== 'task' || !task) {
        this.boundTaskFormId = '';
        return;
      }
      const linkSyncKey = `${task.dependencies.join('|')}|${(task.sibling_dependencies ?? []).join('|')}`;
      if (this.boundTaskFormId === task.task_id) {
        if (this.taskLinkSyncKey === linkSyncKey) return;
        this.taskLinkSyncKey = linkSyncKey;
        this.dependencies = [...task.dependencies];
        this.siblingDependencies = [...(task.sibling_dependencies ?? [])];
        return;
      }
      this.boundTaskFormId = task.task_id;
      this.taskLinkSyncKey = linkSyncKey;
      this.taskPageTab.set('chat');
      this.taskTitle = task.title;
      this.taskInitialPrompt = taskInitialPrompt(task);
      this.outputType = task.output_type;
      this.taskEditorKind = taskEditorKindFromTask(task);
      this.taskRepoPath = task.repo_path ?? `battleplan/projects/${task.project_id}/tasks/${task.task_id}/outputs/`;
      this.taskExecuteMode = task.execute_config?.mode ?? 'script';
      this.taskExecuteScript = task.execute_config?.script ?? '';
      this.taskExecuteWorkflowId = task.execute_config?.workflow_id ?? '';
      this.dependencies = [...task.dependencies];
      this.siblingDependencies = [...(task.sibling_dependencies ?? [])];
      this.taskResearchAgentId = task.research_agent_id ?? '';
      this.taskCodeAgentId = task.code_agent_id ?? '';
      const project = this.store.project();
      const briefInput = {
        title: task.title,
        initialPrompt: taskInitialPrompt(task),
        dar: taskDar(task),
        outputType: task.output_type,
        nodeKind: task.node_kind,
        projectDar: project?.dar,
        repoUrl: project?.repo_url,
        lifecyclePhase: task.lifecycle_phase,
      };
      this.taskBriefForm = mergeTaskBriefWithDefaults(
        task.brief,
        applyTaskBriefDefaults(briefInput, {
          lifecyclePhase: task.lifecycle_phase,
          nodeKind: task.node_kind,
        }),
      );
    });

    effect(() => {
      const selection = this.store.selection();
      if (selection.kind === 'agent') {
        const agent = this.store.selectedAgent();
        if (!agent || this.boundAgentFormId === agent.agent_id) return;
        this.bindAgentForm(agent);
        return;
      }
      if (selection.kind === 'agent-create') {
        const key = `create:${selection.role}`;
        if (this.boundAgentFormId === key) return;
        this.boundAgentFormId = key;
        this.resetAgentFormForRole(selection.role);
        return;
      }
      this.boundAgentFormId = '';
    });

    effect(() => {
      if (!this.desktop) return;
      const selection = this.store.selection();
      const exportEnabled = Boolean(this.store.project());
      const saveEnabled = this.editorIsDirty()
        || ((selection.kind === 'project' && Boolean(this.title.trim()))
        || (selection.kind === 'subproject' && Boolean(this.title.trim()))
        || selection.kind === 'task'
        || selection.kind === 'agent'
        || selection.kind === 'agent-create');
      void electronBridge()?.invoke('menu:sync-state', { exportEnabled, saveEnabled });
    });
    effect(() => {
      if (!this.desktop) return;
      const projects = this.store.rootProjects().map((project) => ({
        id: project.project_id,
        title: project.title,
      }));
      void electronBridge()?.invoke('menu:rebuild', {
        projects,
        themeId: this.themeId(),
      });
    });

    effect(() => {
      const projectId = this.store.projectId();
      if (!projectId) return;
      if (this.kanbanScopeProjectId === projectId) return;
      this.kanbanScopeProjectId = projectId;
      this.kanbanScopeId.set('main');
    });

    effect(() => {
      const options = this.kanbanScopeOptions();
      const current = this.kanbanScopeId();
      if (options.some((option) => option.id === current)) return;
      this.kanbanScopeId.set(options[0]?.id ?? 'main');
    });
    effect((onCleanup) => {
      if (!this.convertPanel()) return;
      window.addEventListener('pointerdown', this.onMapDismissCapture, true);
      onCleanup(() => window.removeEventListener('pointerdown', this.onMapDismissCapture, true));
    });

    effect((onCleanup) => {
      const key = this.chatPanelScrollKey();
      if (!key) {
        this.lastChatPanelScrollKey = '';
        this.chatScrollSignature = '';
        return;
      }
      if (key !== this.lastChatPanelScrollKey) {
        this.lastChatPanelScrollKey = key;
        this.chatScrollSignature = '';
      }
      if (this.store.editorLoading()) return;
      const signature = `${key}:${this.store.messages().length}:${this.store.artifacts().length}`;
      if (signature === this.chatScrollSignature) return;
      this.chatScrollSignature = signature;
      onCleanup(() => this.clearChatTranscriptInitialScroll());
      queueMicrotask(() => this.scheduleChatTranscriptScrollToBottom());
    });

    effect(() => {
      const task = this.store.selectedTask();
      const selection = this.store.selection();
      if (!task || (selection.kind !== 'code' && selection.kind !== 'research')) return;
      const output = selection.kind === 'code'
        ? this.store.codeOutput(task.task_id)
        : this.store.researchOutput(task.task_id);
      const signature = `${selection.kind}:${task.task_id}:${output?.pr_link ?? ''}:${output?.branch ?? ''}:${output && 'path' in output ? output.path : ''}`;
      if (signature === this.outputSignature) return;
      this.outputSignature = signature;
      if (selection.kind === 'code') {
        this.codeRepo = output?.repo ?? '';
        this.codeBranch = output?.branch ?? '';
        this.codeMessage = output?.pr_message ?? '';
        this.codeLink = output?.pr_link ?? '';
        return;
      }
      const research = this.store.researchOutput(task.task_id);
      this.researchRepo = research?.repo ?? '';
      this.researchBranch = research?.branch ?? '';
      this.researchMessage = research?.pr_message ?? '';
      this.researchLink = research?.pr_link ?? '';
      this.researchPath = research?.path ?? `research/${task.project_id}/${task.task_id}/`;
    });
  }

  async ngOnInit(): Promise<void> {
    await this.preferences.restore();
    this.themeId.set(this.preferences.theme());
    this.paneWidth.set(this.preferences.paneWidth());
    this.autoSaveEnabled.set(this.preferences.autoSave());
    applyTheme(this.themeId(), !this.desktop);
    if (this.cursorKey.ready()) {
      const restored = await this.store.loadProjects();
      if (restored) {
        this.pendingMapView = restored.mindmapView;
        this.mapViewProjectId = '';
        this.paneWidth.set(restored.paneWidth);
      }
    }
    electronBridge()?.on('update:available', (payload) => {
      const info = payload as { version?: string; releaseNotes?: string | null };
      const version = info.version ?? 'new';
      const notes = typeof info.releaseNotes === 'string' ? info.releaseNotes : 'A newer Battleplan release is available.';
      this.zone.run(() => this.updatePrompt.set({ version, notes }));
    });
    electronBridge()?.on('menu:action', (action) => {
      this.zone.run(() => this.handleMenuAction(String(action)));
    });
    electronBridge()?.on('menu:open-project', (projectId) => {
      this.zone.run(() => {
        void this.guardUnsavedChanges(async () => {
          await this.activateProjectTab(String(projectId));
        });
      });
    });
    electronBridge()?.on('menu:theme', (themeId) => {
      this.zone.run(() => this.applyThemeChoice(themeId as ThemeId));
    });
    electronBridge()?.on('update:status', (payload) => {
      const info = payload as { upToDate?: boolean; current?: string };
      if (info.upToDate) this.zone.run(() => this.store.notice.set(`Battleplan ${info.current ?? ''} is up to date.`));
    });
  }

  @HostListener('window:beforeunload')
  onBeforeUnload(): void {
    void this.flushProjectUiPersist();
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.saveCurrent();
      return;
    }
    if (event.key !== 'Escape' || this.unsavedPromptOpen() || this.editingNodeId()) {
      return;
    }
    const selection = this.store.selection();
    const closingCreate =
      selection.kind === 'agent-create'
      || (selection.kind === 'agent' && isAgentDraftId(selection.agentId));
    if (!closingCreate) return;
    event.preventDefault();
    this.cancelAgentCreate();
  }

  private handleMenuAction(action: string): void {
    switch (action) {
      case 'new-project':
        void this.guardUnsavedChanges(async () => {
          this.store.showCreate();
        });
        break;
      case 'import-project':
        this.importProject();
        break;
      case 'export-project':
        this.exportProject();
        break;
      case 'save':
        this.saveCurrent();
        break;
      case 'check-for-updates':
        this.checkForUpdates();
        break;
      case 'cursor-api-key':
        this.openCursorKey();
        break;
      case 'github-pat':
        this.openGithubPat();
        break;
      default:
        break;
    }
  }

  saveCurrent(): void {
    void this.persistEditorChanges();
  }

  editorIsDirty(): boolean {
    const selection = this.store.selection();
    const project = selection.kind === 'subproject' ? this.store.editorProject() : this.store.project();
    return editorPanelDirty(
      selection.kind,
      {
        title: this.title,
        repo_url: this.projectRepo,
        starting_ref: this.projectBranch,
        github_pat: this.projectGithubPat,
        dar: this.projectDar,
        initial_prompt: selection.kind === 'subproject' ? this.subprojectInitialPrompt : undefined,
      },
      {
        title: this.taskTitle,
        brief: this.taskBriefForm,
        initial_prompt: this.taskInitialPrompt,
        output_type: this.outputType,
        dependencies: this.dependencies,
        sibling_dependencies: this.siblingDependencies,
      },
      project,
      this.store.selectedTask(),
      this.agentEditorForm(),
      this.store.selectedAgent(),
      selection.kind === 'agent-create' ? selection.role : undefined,
    );
  }

  private agentEditorForm() {
    return {
      type: this.agentType,
      name: this.agentName,
      url: this.agentUrl,
      api_key: this.agentApiKey,
      admin_api_key: this.agentAdminApiKey,
      options: this.agentOptions,
      apiKeyEdited: this.agentApiKeyEdited,
      adminApiKeyEdited: this.agentAdminApiKeyEdited,
    };
  }

  onEditorFieldBlur(): void {
    if (!this.autoSaveEnabled() || !this.editorIsDirty()) return;
    void this.persistEditorChanges();
  }

  onEditorFieldAutoSave(): void {
    this.onEditorFieldBlur();
  }

  onTaskKindChange(): void {
    const mapped = fieldsFromTaskEditorKind(this.taskEditorKind);
    this.outputType = mapped.output_type;
    const task = this.store.selectedTask();
    if (task && mapped.node_kind !== task.node_kind) {
      this.taskBriefForm = mergeTaskBriefWithDefaults(
        this.taskBriefForm,
        applyTaskBriefDefaults({
          title: this.taskTitle,
          initialPrompt: this.taskInitialPrompt,
          dar: task ? taskDar(task) : '',
          outputType: mapped.output_type,
          nodeKind: mapped.node_kind,
          projectDar: this.store.project()?.dar,
          repoUrl: this.store.project()?.repo_url,
          lifecyclePhase: mapped.lifecycle_phase ?? task.lifecycle_phase,
        }, {
          lifecyclePhase: mapped.lifecycle_phase ?? task.lifecycle_phase,
          nodeKind: mapped.node_kind,
        }),
      );
    }
    this.onEditorFieldAutoSave();
  }

  private taskKindPatch(): {
    output_type: OutputType;
    node_kind?: import('./core/task-node-kind').TaskNodeKind;
    lifecycle_phase?: import('./core/models').LifecyclePhase;
  } {
    return fieldsFromTaskEditorKind(this.taskEditorKind);
  }

  private taskExecuteConfigPatch(): import('./core/n8n-workflow').ExecuteTaskConfig | undefined {
    if (this.taskEditorKind !== 'execute') return undefined;
    return {
      mode: this.taskExecuteMode,
      script: this.taskExecuteMode === 'script' ? this.taskExecuteScript : undefined,
      workflow_id: this.taskExecuteMode === 'workflow' ? this.taskExecuteWorkflowId || undefined : undefined,
    };
  }

  private async persistEditorChanges(): Promise<boolean> {
    const selection = this.store.selection();
    if (selection.kind === 'project') {
      await this.store.saveProject({
        title: this.title.trim(),
        repo_url: this.projectRepo.trim(),
        starting_ref: this.projectBranch.trim() || 'main',
        github_pat: this.projectGithubPat.trim(),
        dar: this.projectDar,
        default_research_agent_id: this.defaultResearchAgentId,
        default_code_agent_id: this.defaultCodeAgentId,
      });
    } else if (selection.kind === 'subproject') {
      await this.store.saveEditorProject({
        title: this.title.trim(),
        repo_url: this.projectRepo.trim(),
        starting_ref: this.projectBranch.trim() || 'main',
        github_pat: this.projectGithubPat.trim(),
        dar: this.projectDar,
        initial_prompt: this.subprojectInitialPrompt,
      });
    } else if (selection.kind === 'task') {
      const kindFields = this.taskKindPatch();
      await this.store.saveTask({
        title: this.taskTitle,
        initial_prompt: this.taskInitialPrompt,
        output_type: kindFields.output_type,
        node_kind: kindFields.node_kind,
        lifecycle_phase: kindFields.lifecycle_phase,
        repo_path: this.taskRepoPath.trim() || undefined,
        execute_config: this.taskExecuteConfigPatch(),
        dependencies: this.dependencies,
        sibling_dependencies: this.siblingDependencies,
        research_agent_id: this.taskResearchAgentId,
        code_agent_id: this.taskCodeAgentId,
        brief: this.taskBriefForm,
      });
    } else if (selection.kind === 'agent' || selection.kind === 'agent-create') {
      await this.store.saveAgentFromEditor(this.agentEditorForm());
      this.agentApiKeyEdited = false;
      this.agentApiKeyFocused = false;
      this.agentAdminApiKeyEdited = false;
      this.agentAdminApiKeyFocused = false;
      const agent = this.store.selectedAgent();
      if (agent) this.bindAgentForm(agent);
    } else {
      return true;
    }
    return !this.store.error();
  }

  private async guardUnsavedChanges(navigate: () => Promise<void>): Promise<void> {
    if (!this.editorIsDirty()) {
      await navigate();
      return;
    }
    if (this.autoSaveEnabled()) {
      if (await this.persistEditorChanges()) await navigate();
      return;
    }
    this.pendingNavigation = navigate;
    this.unsavedPromptOpen.set(true);
  }

  unsavedChoice(choice: 'no' | 'yes' | 'yes-always'): void {
    void this.resolveUnsavedChoice(choice);
  }

  private async resolveUnsavedChoice(choice: 'no' | 'yes' | 'yes-always'): Promise<void> {
    const navigate = this.pendingNavigation;
    this.pendingNavigation = null;
    this.unsavedPromptOpen.set(false);
    if (!navigate) return;
    if (choice === 'no') {
      await navigate();
      return;
    }
    if (choice === 'yes-always') {
      this.autoSaveEnabled.set(true);
      await this.preferences.saveAutoSave(true);
    }
    if (await this.persistEditorChanges()) await navigate();
  }

  checkForUpdates(): void {
    if (!this.desktop) {
      this.store.notice.set('Updates are only available in the desktop app.');
      return;
    }
    void electronBridge()?.invoke<{ ok: boolean; upToDate?: boolean; message?: string; current?: string; latest?: string }>('update:check')
      .then((result) => {
        if (!result.ok) {
          this.store.error.set(result.message ?? 'Could not check for updates.');
          return;
        }
        if (result.upToDate) {
          this.store.notice.set(`Battleplan ${result.current ?? ''} is up to date.`);
        }
      });
  }

  chooseTheme(event: Event): void {
    this.applyThemeChoice((event.target as HTMLSelectElement).value as ThemeId);
  }

  applyThemeChoice(theme: ThemeId): void {
    this.themeId.set(theme);
    applyTheme(theme, !this.desktop);
    void this.preferences.saveTheme(theme);
  }

  projectTabTitle(projectId: string): string {
    return this.store.projects().find((project) => project.project_id === projectId)?.title ?? 'Project';
  }

  async activateProjectTab(projectId: string): Promise<void> {
    if (projectId === this.store.projectId()) return;
    await this.flushProjectUiPersist();
    const restored = await this.store.switchProjectTab(projectId, {
      paneWidth: this.paneWidth(),
      mindmapView: this.captureMindmapView(),
    });
    this.pendingMapView = restored.mindmapView;
    this.mapViewProjectId = '';
    this.paneWidth.set(restored.paneWidth);
  }

  releasePendingChanges(): void {
    void this.store.releasePendingChanges();
  }

  startResize(event: PointerEvent): void {
    event.preventDefault();
    const startX = event.clientX;
    const start = this.paneWidth();
    const move = (ev: PointerEvent) => {
      const next = Math.min(window.innerWidth - 360, Math.max(320, start + ev.clientX - startX));
      this.paneWidth.set(next);
    };
    const up = () => {
      this.scheduleProjectUiPersist();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  onMapStageScroll(): void {
    this.scheduleProjectUiPersist();
  }

  private captureMindmapView(): MindmapViewState | null {
    const stage = this.mapStage()?.nativeElement;
    if (!stage) return null;
    return mindmapViewFromScroll(stage.scrollLeft, stage.scrollTop, this.zoom());
  }

  private applyMindmapView(view: MindmapViewState | null): void {
    const stage = this.mapStage()?.nativeElement;
    if (!stage) return;
    if (!view) {
      this.centerMap();
      return;
    }
    const scroll = mindmapScrollFromView(view);
    this.zoom.set(scroll.zoom);
    queueMicrotask(() => {
      stage.scrollLeft = scroll.scrollLeft;
      stage.scrollTop = scroll.scrollTop;
    });
  }

  private scheduleProjectUiPersist(): void {
    if (this.uiPersistTimer) clearTimeout(this.uiPersistTimer);
    this.uiPersistTimer = setTimeout(() => {
      void this.flushProjectUiPersist();
    }, 400);
  }

  private async flushProjectUiPersist(): Promise<void> {
    const projectId = this.store.projectId();
    const mindmapView = this.captureMindmapView();
    if (!projectId || !mindmapView) return;
    await this.store.saveProjectWorkspaceUi(projectId, this.paneWidth(), mindmapView);
  }

  private centerMap(): void {
    const stage = this.mapStage()?.nativeElement;
    const project = this.map().nodes.find((node) => node.id === 'project');
    if (!stage || !project) return;
    const zoom = this.zoom();
    stage.scrollLeft = project.x * zoom - stage.clientWidth / 2;
    stage.scrollTop = project.y * zoom - stage.clientHeight / 2;
    this.scheduleProjectUiPersist();
  }

  private zoomAt(offsetX: number, offsetY: number, factor: number): void {
    const stage = this.mapStage()?.nativeElement;
    const previous = this.zoom();
    const next = clampZoom(previous * factor);
    if (!stage || next === previous) {
      this.zoom.set(next);
      this.scheduleProjectUiPersist();
      return;
    }
    const worldX = (stage.scrollLeft + offsetX) / previous;
    const worldY = (stage.scrollTop + offsetY) / previous;
    this.zoom.set(next);
    queueMicrotask(() => {
      stage.scrollLeft = worldX * next - offsetX;
      stage.scrollTop = worldY * next - offsetY;
      this.scheduleProjectUiPersist();
    });
  }

  showCursorKey(): boolean {
    return !this.cursorKey.ready() || this.signingOpen();
  }

  showGithubPat(): boolean {
    return this.githubPatOpen();
  }

  openCursorKey(): void {
    this.keyError = '';
    this.replacingKey = false;
    this.signingOpen.set(true);
  }

  closeCursorKey(): void {
    this.apiKey = '';
    this.keyError = '';
    this.replacingKey = false;
    this.signingOpen.set(false);
  }

  saveCursorKey(): void {
    this.keyError = '';
    void this.cursorKey.save(this.apiKey).then(() => {
      this.apiKey = '';
      this.replacingKey = false;
      this.signingOpen.set(false);
      if (this.store.projects().length === 0) void this.store.loadProjects();
    }).catch((error) => {
      this.keyError = error instanceof Error ? error.message : 'Could not save that key.';
    });
  }

  clearCursorKey(): void {
    void this.cursorKey.clear();
    this.apiKey = '';
    this.replacingKey = false;
    this.signingOpen.set(true);
  }

  openGithubPat(): void {
    this.githubPatError = '';
    this.githubPatDraft = this.preferences.githubPat();
    this.replacingGithubPat = false;
    this.githubPatOpen.set(true);
  }

  closeGithubPat(): void {
    this.githubPatDraft = '';
    this.githubPatError = '';
    this.replacingGithubPat = false;
    this.githubPatOpen.set(false);
  }

  saveGithubPat(): void {
    this.githubPatError = '';
    void this.preferences.saveGithubPat(this.githubPatDraft).then(() => {
      this.closeGithubPat();
      this.store.notice.set('GitHub token saved for desktop updates.');
    }).catch((error) => {
      this.githubPatError = error instanceof Error ? error.message : 'Could not save that token.';
    });
  }

  clearGithubPat(): void {
    void this.preferences.clearGithubPat();
    this.githubPatDraft = '';
    this.replacingGithubPat = true;
  }

  planMarkdown(value: string | undefined): string {
    return prepareMarkdown(value ?? '');
  }

  otherTasks(): ProjectTask[] {
    const current = this.store.selectedTask();
    return this.store.tasks().filter((task) => task.task_id !== current?.task_id);
  }

  taskHasChildren(taskId: string): boolean {
    const tasks = this.store.tasks();
    const task = tasks.find((item) => item.task_id === taskId);
    if (!task) return false;
    const byId = new Map(tasks.map((item) => [item.task_id, item]));
    return normalChildIds(task, byId).length > 0;
  }

  playChildrenPoint(node: MindmapNode): { x: number; y: number } {
    return { x: node.x + node.width / 2 - 10, y: node.y - node.height / 2 + 10 };
  }

  isMindmapLinkSelected(edge: MindmapEdge): boolean {
    const selected = this.selectedMindmapLink();
    return Boolean(selected && linkKey(selected) === linkKey(edge));
  }

  mindmapLinkHandleVisible(edge: MindmapEdge, end: 'from' | 'to'): boolean {
    return this.isMindmapLinkSelected(edge);
  }

  mindmapLinkHandlePoint(edge: MindmapEdge, end: 'from' | 'to'): { x: number; y: number } {
    const drag = this.linkEndpointDrag();
    if (drag && linkKey(drag.link) === linkKey(edge) && drag.end === end) {
      return { x: drag.x, y: drag.y };
    }
    return end === 'from' ? { x: edge.x1, y: edge.y1 } : { x: edge.x2, y: edge.y2 };
  }

  onMindmapLinkPointerDown(edge: MindmapEdge, event: PointerEvent): void {
    event.stopPropagation();
    event.preventDefault();
    this.selectedMindmapLink.set({ kind: edge.kind, from: edge.from, to: edge.to });
  }

  onMindmapLinkHandlePointerDown(edge: MindmapEdge, end: 'from' | 'to', event: PointerEvent): void {
    event.stopPropagation();
    event.preventDefault();
    const link: MindmapLinkRef = { kind: edge.kind, from: edge.from, to: edge.to };
    this.selectedMindmapLink.set(link);
    const start = this.mindmapLinkHandlePoint(edge, end);
    this.linkEndpointDrag.set({ link, end, x: start.x, y: start.y });
    const stage = this.mapStage()?.nativeElement;
    if (!stage) return;
    const move = (ev: PointerEvent): void => {
      const rect = stage.getBoundingClientRect();
      const world = pointerToWorld(ev.clientX, ev.clientY, rect, stage.scrollLeft, stage.scrollTop, this.zoom());
      this.linkEndpointDrag.set({ link, end, x: world.x, y: world.y });
    };
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.linkEndpointDrag.set(null);
      const rect = stage.getBoundingClientRect();
      const world = pointerToWorld(ev.clientX, ev.clientY, rect, stage.scrollLeft, stage.scrollTop, this.zoom());
      const target = mindmapNodeAtPoint(this.map().nodes, world.x, world.y);
      const anchorId = end === 'from' ? link.to : link.from;
      const originalEndId = end === 'from' ? link.from : link.to;
      if (target && target.id !== originalEndId && (target.id !== anchorId || target.id === 'project')) {
        if (link.kind === 'child' || link.kind === 'sibling' || link.kind === 'project-root') {
          void this.store.relocateMindmapLink(link, end, target.id);
        }
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  requestExecuteChildren(taskId: string, event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    this.executeChildrenPrompt.set(taskId);
  }

  answerExecuteChildren(yes: boolean): void {
    const taskId = this.executeChildrenPrompt();
    this.executeChildrenPrompt.set(null);
    if (!yes || !taskId) return;
    void this.store.executeChildren(taskId);
  }

  isMapSelected(node: MindmapNode): boolean {
    const selection = this.store.selection();
    if (node.kind === 'project') return selection.kind === 'project';
    return (selection.kind === 'task' || selection.kind === 'subproject' || selection.kind === 'code' || selection.kind === 'research')
      && selection.taskId === node.id;
  }

  isMapGroupSelected(node: MindmapNode): boolean {
    return this.mapGroupSelection().includes(node.id);
  }

  mapMarqueeStyle(rect: WorldRect): { left: string; top: string; width: string; height: string } {
    return {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.right - rect.left}px`,
      height: `${rect.bottom - rect.top}px`,
    };
  }

  clearMapGroupSelection(): void {
    this.mapGroupSelection.set([]);
    this.mapMarquee.set(null);
  }

  private worldPointFromPointer(event: PointerEvent): { x: number; y: number } | null {
    const stage = this.mapStage()?.nativeElement;
    if (!stage) return null;
    return pointerToWorld(
      event.clientX,
      event.clientY,
      stage.getBoundingClientRect(),
      stage.scrollLeft,
      stage.scrollTop,
      this.zoom(),
    );
  }

  private chatPanelScrollKey(): string | null {
    const selection = this.store.selection();
    const projectId = this.store.project()?.project_id;
    if (!projectId) return null;
    switch (selection.kind) {
      case 'project':
        return `${projectId}:project`;
      case 'task':
        return selection.taskId ? `${projectId}:task:${selection.taskId}` : null;
      case 'subproject':
        return selection.taskId ? `${projectId}:subproject:${selection.taskId}` : null;
      default:
        return null;
    }
  }

  private clearChatTranscriptInitialScroll(): void {
    this.chatTranscriptScrollObserver?.disconnect();
    this.chatTranscriptScrollObserver = undefined;
    if (this.chatTranscriptScrollTimer) {
      clearTimeout(this.chatTranscriptScrollTimer);
      this.chatTranscriptScrollTimer = undefined;
    }
  }

  private scheduleChatTranscriptScrollToBottom(attempt = 0): void {
    const element = this.chatTranscript()?.nativeElement;
    if (!element) {
      if (attempt < 30) {
        requestAnimationFrame(() => this.scheduleChatTranscriptScrollToBottom(attempt + 1));
      }
      return;
    }
    this.clearChatTranscriptInitialScroll();
    const scrollToBottom = (): void => {
      element.scrollTop = element.scrollHeight;
    };
    scrollToBottom();
    requestAnimationFrame(scrollToBottom);
    this.chatTranscriptScrollObserver = new ResizeObserver(scrollToBottom);
    this.chatTranscriptScrollObserver.observe(element);
    this.chatTranscriptScrollTimer = setTimeout(() => {
      scrollToBottom();
      this.clearChatTranscriptInitialScroll();
    }, 3000);
  }

  timeline(): Array<
    | { id: string; kind: 'message'; message: ChatMessage }
    | { id: string; kind: 'artifact'; artifact: ChatArtifact }
  > {
    return [
      ...this.store.messages().map((message) => ({ id: message.message_id, at: message.created_at, kind: 'message' as const, message })),
      ...this.store.artifacts().map((artifact) => ({ id: artifact.path, at: artifact.updated_at, kind: 'artifact' as const, artifact })),
    ].sort((left, right) => left.at.localeCompare(right.at));
  }

  speaker(message: ChatMessage): string {
    if (message.role === 'change') return 'Update';
    return message.role === 'user' ? 'You' : 'Cursor';
  }

  markdownArtifact(artifact: ChatArtifact): boolean {
    return artifact.content_type === 'text' && isMarkdownPath(artifact.path);
  }

  saveProject(): void {
    void this.store.saveProject({
      title: this.title.trim(),
      repo_url: this.projectRepo.trim(),
      starting_ref: this.projectBranch.trim() || 'main',
      github_pat: this.projectGithubPat.trim(),
      dar: this.projectDar,
      default_research_agent_id: this.defaultResearchAgentId,
      default_code_agent_id: this.defaultCodeAgentId,
    });
  }

  saveSubproject(): void {
    void this.store.saveEditorProject({
      title: this.title.trim(),
      repo_url: this.projectRepo.trim(),
      starting_ref: this.projectBranch.trim() || 'main',
      github_pat: this.projectGithubPat.trim(),
      dar: this.projectDar,
      initial_prompt: this.subprojectInitialPrompt,
    });
  }

  taskWorkflowHint(task: ProjectTask): string | undefined {
    return workflowHintForTask(task);
  }

  taskAgentStarted(task: ProjectTask): boolean {
    const project = this.store.project();
    if (!project) return Boolean(task.cursor_agent_id);
    return taskResearchChatStarted(task, project, this.store.agents());
  }

  libraryAgents(kind: AgentKind): ProjectAgent[] {
    return libraryAgentsForKind(this.store.agents(), kind);
  }

  subprojectAgentStarted(): boolean {
    return Boolean(this.store.editorProject()?.cursor_agent_id);
  }

  async executeTask(): Promise<void> {
    this.store.chatActionPending.set('execute');
    try {
      await this.saveTask();
      if (!this.store.error()) await this.store.executeTask();
    } finally {
      this.store.chatActionPending.set(null);
    }
  }

  async executeSubproject(): Promise<void> {
    this.store.chatActionPending.set('execute');
    try {
      await this.store.saveEditorProject({
        title: this.title.trim(),
        repo_url: this.projectRepo.trim(),
        starting_ref: this.projectBranch.trim() || 'main',
        github_pat: this.projectGithubPat.trim(),
        dar: this.projectDar,
        initial_prompt: this.subprojectInitialPrompt,
      });
      if (!this.store.error()) await this.store.executeSubprojectChat();
    } finally {
      this.store.chatActionPending.set(null);
    }
  }

  approveTask(): void {
    void this.store.approve();
  }

  approveProjectRelease(): void {
    void this.store.approveProjectRelease();
  }

  projectRootStatus(project: { status?: TaskStatus }): TaskStatus {
    return project.status ?? 'TODO';
  }

  onProjectStatusChange(event: Event): void {
    const status = (event.target as HTMLSelectElement).value as TaskStatus;
    void this.store.transitionProject(status, true);
  }

  chatActionsLocked(): boolean {
    return this.store.chatActionPending() !== null || this.store.busy();
  }

  chatSendDisabled(): boolean {
    return this.chatActionsLocked() || this.store.chatAgentSyncing();
  }

  taskPanelEditorActive(): boolean {
    const kind = this.store.selection().kind;
    return kind === 'task' || kind === 'subproject';
  }

  retryTaskConnection(taskId: string): void {
    void this.store.retryTaskAgentConnection(taskId);
  }

  deleteProject(): void {
    const project = this.store.project();
    if (project && confirm(`Delete "${project.title}"?`)) void this.store.deleteProject();
  }

  exportProject(): void {
    const project = this.store.project();
    if (!project || !this.portability.supported()) return;
    void this.portability.exportProject(project.project_id).then((result) => {
      if (!result.canceled && result.filePath) this.store.notice.set(`Exported to ${result.filePath}`);
    }).catch((error) => {
      this.store.error.set(error instanceof Error ? error.message : 'Export failed.');
    });
  }

  importProject(overwrite = false): void {
    if (!this.portability.supported()) return;
    void this.portability.importProject(overwrite).then(async (result) => {
      if (result.canceled) return;
      if (result.exists) {
        const ok = confirm('This project already exists. Do you want to overwrite your existing project?');
        if (ok) this.importProject(true);
        return;
      }
      if (result.project) {
        await this.store.loadProjects();
        await this.store.selectProject(result.project.project_id);
        this.store.notice.set(`Imported "${result.project.title}".`);
      }
    }).catch((error) => {
      this.store.error.set(error instanceof Error ? error.message : 'Import failed.');
    });
  }

  dismissUpdate(): void {
    this.updatePrompt.set(null);
  }

  installUpdate(): void {
    void electronBridge()?.invoke<{ ok: boolean; message?: string }>('update:install').then((result) => {
      if (!result.ok) this.store.error.set(result.message ?? 'Could not install the update.');
    });
  }

  zoomBy(factor: number): void {
    const stage = this.mapStage()?.nativeElement;
    if (!stage) {
      this.zoom.update((value) => clampZoom(value * factor));
      return;
    }
    this.zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, factor);
  }

  onMapWheel(event: WheelEvent): void {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const stage = this.mapStage()?.nativeElement;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.zone.run(() => this.zoomAt(event.clientX - rect.left, event.clientY - rect.top, factor));
  }

  onStagePointerDown(event: PointerEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest('.map-node, .map-edge-arrow, .map-connect-panel, .map-convert-panel, .map-convert-handle, .map-play-children, .map-link-handle, .map-link-hit, .zoom-controls, .agent-toolbox')) return;
    this.selectedMindmapLink.set(null);
    if (this.connectPanel()) {
      this.dismissConnectPanel();
      return;
    }
    const startWorld = this.worldPointFromPointer(event);
    if (!startWorld) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let marqueeActive = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!marqueeActive && Math.hypot(dx, dy) < 4) return;
      marqueeActive = true;
      const currentWorld = this.worldPointFromPointer(ev);
      if (!currentWorld) return;
      this.mapMarquee.set(normalizeWorldRect(startWorld.x, startWorld.y, currentWorld.x, currentWorld.y));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (marqueeActive) {
        const box = this.mapMarquee();
        if (box) {
          this.mapGroupSelection.set(mindmapNodesInWorldRect(this.map().nodes, box));
        }
        this.mapMarquee.set(null);
      } else {
        this.clearMapGroupSelection();
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  onNodePointerDown(node: MindmapNode, event: PointerEvent): void {
    if (this.editingNodeId() === node.id) return;
    if ((event.target as HTMLElement).closest('.map-edge-arrow, .map-connect-panel, .map-play-children')) return;
    event.stopPropagation();
    const group = this.mapGroupSelection();
    const inGroup = group.includes(node.id);
    if (group.length > 0 && !inGroup) {
      this.clearMapGroupSelection();
    }
    const dragIds = inGroup && group.length > 0 ? [...group] : [node.id];
    const origins = new Map<string, { x: number; y: number }>();
    for (const id of dragIds) {
      const layoutNode = this.map().nodes.find((item) => item.id === id);
      if (layoutNode) origins.set(id, { x: layoutNode.x, y: layoutNode.y });
    }
    const startX = event.clientX;
    const startY = event.clientY;
    let dragged = false;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / this.zoom();
      const dy = (ev.clientY - startY) / this.zoom();
      if (!dragged && Math.hypot(dx, dy) < 4) return;
      dragged = true;
      this.mapDraggingNodeId.set(node.id);
      this.hoveredConnect.set(null);
      this.dragPins.update((pins) => {
        const next = { ...pins };
        for (const [id, origin] of origins) {
          next[id] = { x: origin.x + dx, y: origin.y + dy };
        }
        return next;
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.mapDraggingNodeId.set(null);
      const pins = this.dragPins();
      if (dragged) {
        for (const id of dragIds) {
          const pin = pins[id];
          if (pin) void this.store.placeNode(id, pin.x, pin.y);
        }
      } else {
        this.selectMapNode(node);
      }
      this.dragPins.update((pins) => {
        const next = { ...pins };
        for (const id of dragIds) delete next[id];
        return next;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  selectMapNode(node: MindmapNode): void {
    if (this.isSameMapSelection(node)) return;
    void this.guardUnsavedChanges(async () => {
      if (node.kind === 'project') await this.store.openProjectChat();
      else await this.store.openTask(node.id);
    });
  }

  private isSameMapSelection(node: MindmapNode): boolean {
    const selection = this.store.selection();
    if (node.kind === 'project') return selection.kind === 'project';
    return (selection.kind === 'task' || selection.kind === 'subproject' || selection.kind === 'code' || selection.kind === 'research')
      && selection.taskId === node.id;
  }

  agentLogoFor(type: AgentType): string {
    return agentLogoPublicPath(type);
  }

  agentCredentialFieldLabel(): string {
    return agentCredentialFieldLabel(this.agentType);
  }

  agentUsesServiceAccountJson(): boolean {
    return agentUsesServiceAccountJson(this.agentType);
  }

  agentTypesForSelection(): AgentType[] {
    const selection = this.store.selection();
    const role: AgentKind = selection.kind === 'agent-create'
      ? selection.role
      : (this.store.selectedAgent()?.kind ?? 'research');
    return agentTypesForKind(role);
  }

  visibleAgentOptionRows() {
    return agentOptionRows(this.agentType).filter((row) => isAgentOptionVisible(row, this.agentOptions));
  }

  agentSelectChoices(row: AgentOptionDefinition): string[] {
    return selectChoicesForOption(this.agentType, row.key, row.choices, this.agentDynamicModelChoices);
  }

  agentLocalLlmBrowserNotice(): string | null {
    return this.agentConnections.browserLimitationMessage(this.agentType);
  }

  agentEditorHeaderName(): string {
    return this.agentName.trim() || 'Untitled agent';
  }

  agentShowSaveButton(): boolean {
    const selection = this.store.selection();
    if (selection.kind === 'agent-create') return true;
    if (selection.kind === 'agent') return isAgentDraftId(selection.agentId);
    return false;
  }

  agentShowDeleteButton(): boolean {
    const selection = this.store.selection();
    return selection.kind === 'agent' && !isAgentDraftId(selection.agentId);
  }

  agentStatsPreview(): ProjectAgent | null {
    const selection = this.store.selection();
    if (selection.kind === 'agent') {
      const saved = this.store.selectedAgent();
      if (!saved) return null;
      return {
        ...saved,
        type: this.agentType,
        admin_api_key: this.agentAdminApiKeyEdited
          ? this.agentAdminApiKey.trim() || undefined
          : saved.admin_api_key,
      };
    }
    if (selection.kind === 'agent-create') {
      const now = new Date().toISOString();
      return {
        agent_id: 'preview',
        kind: selection.role,
        type: this.agentType,
        name: this.agentName,
        url: this.agentUrl,
        admin_api_key: this.agentAdminApiKey.trim() || undefined,
        created_at: now,
        updated_at: now,
      };
    }
    return null;
  }

  agentApiKeyInputValue(): string {
    const agent = this.store.selectedAgent();
    if (!this.agentApiKeyEdited && !this.agentApiKeyFocused && agent?.api_key && !isAgentDraftId(agent.agent_id)) {
      return '********';
    }
    return this.agentApiKey;
  }

  onAgentApiKeyFocus(): void {
    this.agentApiKeyFocused = true;
    if (!this.agentApiKeyEdited && this.agentApiKey === '' && this.store.selectedAgent()?.api_key) {
      this.agentApiKey = '';
    }
  }

  onAgentApiKeyInput(value: string): void {
    this.agentApiKeyEdited = true;
    this.agentApiKey = value;
  }

  onAgentApiKeyBlur(): void {
    this.agentApiKeyFocused = false;
    void this.refreshDynamicModelChoices();
    this.onEditorFieldBlur();
  }

  onAgentTypeChange(type: AgentType): void {
    const changed = applyAgentTypeChange({
      previousType: this.agentType,
      nextType: type,
      name: this.agentName,
      url: this.agentUrl,
      options: this.agentOptions,
      nameTouched: this.agentNameTouched,
      urlTouched: this.agentUrlTouched,
    });
    this.agentType = changed.type;
    this.agentName = changed.name;
    this.agentUrl = changed.url;
    this.agentOptions = changed.options;
    this.agentDynamicModelChoices = [];
    void this.refreshDynamicModelChoices();
  }

  onAgentNameInput(value: string): void {
    this.agentNameTouched = true;
    this.agentName = value;
  }

  onAgentUrlInput(value: string): void {
    this.agentUrlTouched = true;
    this.agentUrl = value;
  }

  setAgentOption(key: string, value: AgentOptionValue): void {
    this.agentOptions = { ...this.agentOptions, [key]: value };
  }

  isToolboxAgentSelected(agentId: string): boolean {
    const selection = this.store.selection();
    return selection.kind === 'agent' && selection.agentId === agentId;
  }

  openAgent(agentId: string): void {
    void this.guardUnsavedChanges(async () => {
      this.store.selectAgent(agentId);
    });
  }

  openAgentCreate(role: 'research' | 'code'): void {
    void this.guardUnsavedChanges(async () => {
      this.store.selectAgentCreate(role);
    });
  }

  cancelAgentCreate(): void {
    void this.guardUnsavedChanges(async () => {
      await this.closeAgentCreateFlow();
    });
  }

  private async closeAgentCreateFlow(): Promise<void> {
    const selection = this.store.selection();
    if (selection.kind === 'agent-create') {
      this.boundAgentFormId = '';
      this.store.selection.set({ kind: 'project' });
      return;
    }
    if (selection.kind === 'agent' && isAgentDraftId(selection.agentId)) {
      await this.store.deleteAgent(selection.agentId);
    }
  }

  saveAgentExplicit(): void {
    void this.persistEditorChanges();
  }

  deleteSelectedAgent(): void {
    const selection = this.store.selection();
    if (selection.kind !== 'agent' || isAgentDraftId(selection.agentId)) return;
    const agent = this.store.selectedAgent();
    if (!agent || !confirm(`Delete agent "${agent.name}"?`)) return;
    void this.store.deleteAgent(agent.agent_id);
  }

  testAgentConnection(): void {
    void this.runAgentConnectionTest();
  }

  private agentApiKeyForModelFetch(): string {
    const saved = this.store.selectedAgent();
    return this.agentApiKeyEdited
      ? this.agentApiKey.trim()
      : (saved?.api_key ?? this.agentApiKey).trim();
  }

  private async refreshDynamicModelChoices(): Promise<void> {
    if (!agentModelOptionDefinition(this.agentType)?.dynamic) return;
    const apiKey = this.agentApiKeyForModelFetch();
    if (!apiKey && this.agentType !== 'LocalLLM') return;
    const models = await this.agentConnections.listModels({
      type: this.agentType,
      url: this.agentUrl.trim() || getAgentTypeDefinition(this.agentType).defaultUrl,
      apiKey,
    });
    if (!models.length) return;
    this.agentDynamicModelChoices = models;
    this.agentOptions = applyDynamicModelsToOptions(this.agentType, this.agentOptions, models);
  }

  private async runAgentConnectionTest(): Promise<void> {
    const saved = this.store.selectedAgent();
    const apiKey = this.agentApiKeyEdited
      ? this.agentApiKey.trim()
      : (saved?.api_key ?? this.agentApiKey).trim();
    const result = await this.agentConnections.testConnection({
      type: this.agentType,
      url: this.agentUrl.trim() || getAgentTypeDefinition(this.agentType).defaultUrl,
      apiKey,
    });
    if (this.agentTestFadeTimer) clearTimeout(this.agentTestFadeTimer);
    this.agentTestMessage.set(result.message);
    if (result.ok) {
      this.agentTestSuccess.set(true);
      if (result.models?.length) {
        this.agentDynamicModelChoices = result.models;
        this.agentOptions = applyDynamicModelsToOptions(this.agentType, this.agentOptions, result.models);
      }
      this.agentTestFadeTimer = setTimeout(() => {
        this.agentTestMessage.set(null);
        this.agentTestSuccess.set(false);
      }, 5000);
    } else {
      this.agentTestSuccess.set(false);
    }
    if (saved && !isAgentDraftId(saved.agent_id)) {
      await this.store.persistAgentTestResult(saved.agent_id, {
        last_test_at: new Date().toISOString(),
        last_test_status: result.ok ? 'success' : 'error',
        last_test_message: result.message,
      });
    }
  }

  private resetAgentFormForRole(role: AgentKind): void {
    const type: AgentType = role === 'code' ? 'Cursor Agent' : 'OpenAI';
    const definition = getAgentTypeDefinition(type);
    this.agentType = type;
    this.agentName = definition.defaultName;
    this.agentUrl = definition.defaultUrl;
    this.agentApiKey = '';
    this.agentAdminApiKey = '';
    this.agentOptions = defaultOptionValues(type);
    this.agentDynamicModelChoices = [];
    this.agentNameTouched = false;
    this.agentUrlTouched = false;
    this.agentApiKeyEdited = false;
    this.agentApiKeyFocused = false;
    this.agentAdminApiKeyEdited = false;
    this.agentAdminApiKeyFocused = false;
    this.agentTestMessage.set(null);
    this.agentTestSuccess.set(false);
  }

  private bindAgentForm(agent: ProjectAgent): void {
    this.boundAgentFormId = agent.agent_id;
    this.agentType = agent.type;
    this.agentName = agent.name;
    this.agentUrl = agent.url;
    this.agentApiKey = '';
    this.agentAdminApiKey = '';
    this.agentOptions = mergeAgentOptions(agent.type, agent.options);
    this.agentDynamicModelChoices = [];
    this.agentNameTouched = true;
    this.agentUrlTouched = true;
    this.agentApiKeyEdited = false;
    this.agentApiKeyFocused = false;
    this.agentAdminApiKeyEdited = false;
    this.agentAdminApiKeyFocused = false;
    this.agentTestMessage.set(agent.last_test_status === 'error' ? (agent.last_test_message ?? null) : null);
    this.agentTestSuccess.set(false);
    void this.refreshDynamicModelChoices();
  }

  agentAdminApiKeyInputValue(): string {
    const agent = this.store.selectedAgent();
    if (!this.agentAdminApiKeyEdited && !this.agentAdminApiKeyFocused && agent?.admin_api_key && !isAgentDraftId(agent.agent_id)) {
      return '********';
    }
    return this.agentAdminApiKey;
  }

  onAgentAdminApiKeyFocus(): void {
    this.agentAdminApiKeyFocused = true;
    if (!this.agentAdminApiKeyEdited && this.agentAdminApiKey === '' && this.store.selectedAgent()?.admin_api_key) {
      this.agentAdminApiKey = '';
    }
  }

  onAgentAdminApiKeyInput(value: string): void {
    this.agentAdminApiKeyEdited = true;
    this.agentAdminApiKey = value;
  }

  onAgentAdminApiKeyBlur(): void {
    this.agentAdminApiKeyFocused = false;
    this.onEditorFieldBlur();
  }

  connectArrowClass(direction: CardinalDirection): string {
    return `map-edge-arrow dir-${direction}`;
  }

  connectArrowPoint(nodeId: string, direction: CardinalDirection): { x: number; y: number } {
    const node = this.map().nodes.find((item) => item.id === nodeId);
    if (!node) return { x: 0, y: 0 };
    return cardinalAnchor(node, direction);
  }

  visibleConnectDirection(nodeId: string): CardinalDirection | null {
    const panel = this.connectPanel();
    if (panel?.sourceId === nodeId) return panel.direction;
    const hover = this.hoveredConnect();
    if (hover?.nodeId === nodeId) return hover.direction;
    return null;
  }

  onMapPointerMove(event: PointerEvent): void {
    if (this.connectPanel() || this.convertPanel() || this.editingNodeId() || this.mapDraggingNodeId()) return;
    const target = event.target as HTMLElement;
    if (target.closest('.map-connect-panel')) return;
    cancelAnimationFrame(this.mapHoverFrame);
    this.mapHoverFrame = requestAnimationFrame(() => {
      const stage = this.mapStage()?.nativeElement;
      if (!stage) return;
      const world = pointerToWorld(
        event.clientX,
        event.clientY,
        stage.getBoundingClientRect(),
        stage.scrollLeft,
        stage.scrollTop,
        this.zoom(),
      );
      const threshold = 28 / this.zoom();
      let match: { nodeId: string; direction: CardinalDirection } | null = null;
      for (const node of [...this.map().nodes].reverse()) {
        const direction = pickCardinalEdge(node, world.x, world.y, threshold);
        if (direction) {
          match = { nodeId: node.id, direction };
          break;
        }
      }
      this.hoveredConnect.set(match);
      const selection = this.store.selection();
      const selected = this.map().nodes.find((item) => {
        if (selection.kind === 'project') return item.id === 'project';
        if ('taskId' in selection) return item.id === selection.taskId;
        return false;
      });
      if (selected?.shape === 'research') {
        this.hoveredConvert.set(pickNorthWestCorner(selected, world.x, world.y, threshold) ? selected.id : null);
      } else {
        this.hoveredConvert.set(null);
      }
    });
  }

  onEdgePointerDown(node: MindmapNode, direction: CardinalDirection, event: PointerEvent): void {
    event.stopPropagation();
    event.preventDefault();
    this.clearEdgeHoldTimer();
    this.edgeLongPressFired = false;
    this.edgeHoldTimer = setTimeout(() => {
      this.edgeLongPressFired = true;
      this.connectPanel.set({
        sourceId: node.id,
        sourceKind: node.kind,
        direction,
      });
      this.hoveredConnect.set({ nodeId: node.id, direction });
    }, this.connectHoldMs);
    const onUp = (): void => {
      this.clearEdgeHoldTimer();
      if (!this.edgeLongPressFired && !this.connectPanel()) {
        void this.quickAddResearchTask(node, direction);
      }
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  onConvertPointerDown(node: MindmapNode, event: PointerEvent): void {
    event.stopPropagation();
    event.preventDefault();
    this.clearConvertHoldTimer();
    this.convertHoldTimer = setTimeout(() => {
      this.convertPanel.set({ taskId: node.id });
    }, this.connectHoldMs);
    const onUp = (): void => {
      this.clearConvertHoldTimer();
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  convertHandlePoint(nodeId: string): { x: number; y: number } {
    const node = this.map().nodes.find((item) => item.id === nodeId);
    if (!node) return { x: 0, y: 0 };
    return { x: node.x - node.width / 2, y: node.y - node.height / 2 };
  }

  showConvertHandle(node: MindmapNode): boolean {
    if (node.shape !== 'research') return false;
    if (this.convertPanel()?.taskId === node.id) return true;
    return this.hoveredConvert() === node.id;
  }

  async confirmConvertTask(to: 'code' | 'subproject', event: Event): Promise<void> {
    event.stopPropagation();
    const panel = this.convertPanel();
    if (!panel) return;
    this.convertPanel.set(null);
    await this.guardUnsavedChanges(async () => {
      await this.store.convertTask(panel.taskId, to);
    });
  }

  private async quickAddResearchTask(node: MindmapNode, direction: CardinalDirection): Promise<void> {
    await this.guardUnsavedChanges(async () => {
      const taskId = await this.store.addConnectedTask({
        sourceId: node.id,
        sourceKind: node.kind,
        direction,
        output_type: 'research',
      });
      if (taskId) this.startInlineEdit(taskId, 'New research task');
    });
  }

  onMapDismissPointerDown(event: PointerEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest('.map-connect-panel, .map-convert-panel, .map-edge-arrow, .map-convert-handle, .map-play-children, .map-link-handle, .map-link-hit')) return;
    this.dismissConnectPanel();
    this.convertPanel.set(null);
  }

  dismissConnectPanel(): void {
    this.clearEdgeHoldTimer();
    this.connectPanel.set(null);
  }

  async confirmAddConnectedTask(outputType: 'code' | 'research' | 'subproject', event: Event): Promise<void> {
    event.stopPropagation();
    const panel = this.connectPanel();
    if (!panel) return;
    this.dismissConnectPanel();
    const labels: Record<typeof outputType, string> = {
      code: 'New code task',
      research: 'New research task',
      subproject: 'New subproject',
    };
    await this.guardUnsavedChanges(async () => {
      const taskId = await this.store.addConnectedTask({
        sourceId: panel.sourceId,
        sourceKind: panel.sourceKind,
        direction: panel.direction,
        output_type: outputType,
      });
      if (taskId) this.startInlineEdit(taskId, labels[outputType]);
    });
  }

  onNodeDblClick(node: MindmapNode, event: MouseEvent): void {
    event.stopPropagation();
    event.preventDefault();
    this.startInlineEdit(node.id, node.label);
  }

  startInlineEdit(nodeId: string, label: string): void {
    this.dismissConnectPanel();
    this.hoveredConnect.set(null);
    this.editingNodeId.set(nodeId);
    this.editDraft.set(label);
  }

  onTaskFieldFocus(): void {
    this.cancelInlineEdit();
  }

  commitInlineEdit(): void {
    const nodeId = this.editingNodeId();
    if (!nodeId) return;
    const draft = this.editDraft().trim();
    const node = this.map().nodes.find((item) => item.id === nodeId);
    const fallback = node?.label ?? '';
    const next = draft || fallback;
    this.editingNodeId.set(null);
    if (nodeId === 'project') this.title = next;
    else if (this.store.selectedTask()?.task_id === nodeId) this.taskTitle = next;
    void this.store.saveMapNodeTitle(nodeId, next);
  }

  cancelInlineEdit(): void {
    this.editingNodeId.set(null);
  }

  onEditKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.commitInlineEdit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelInlineEdit();
    }
  }

  private clearEdgeHoldTimer(): void {
    if (this.edgeHoldTimer) clearTimeout(this.edgeHoldTimer);
    this.edgeHoldTimer = undefined;
  }

  private clearConvertHoldTimer(): void {
    if (this.convertHoldTimer) clearTimeout(this.convertHoldTimer);
    this.convertHoldTimer = undefined;
  }

  async onProjectChange(event: Event): Promise<void> {
    const projectId = (event.target as HTMLSelectElement).value;
    if (!projectId || projectId === this.store.projectId()) return;
    await this.guardUnsavedChanges(async () => {
      await this.activateProjectTab(projectId);
    });
  }

  async onStatusChange(taskId: string, event: Event): Promise<void> {
    const status = (event.target as HTMLSelectElement).value as TaskStatus;
    await this.store.transition(taskId, status, true);
  }

  async createProject(): Promise<void> {
    await this.store.createProject({
      initial_prompt: this.initialPrompt,
      repo_url: this.repoUrl.trim() || undefined,
      starting_ref: this.startingRef.trim() || undefined,
    });
    if (!this.store.error()) {
      this.initialPrompt = '';
    }
  }

  async sendChat(): Promise<void> {
    const message = this.chatDraft.trim();
    if (!message) return;
    this.store.chatActionPending.set('send');
    try {
      const selection = this.store.selection();
      if (selection.kind === 'task' || selection.kind === 'subproject') await this.store.sendTaskMessage(message);
      else await this.store.sendProjectMessage(message);
      if (!this.store.error()) this.chatDraft = '';
    } finally {
      this.store.chatActionPending.set(null);
    }
  }

  async saveTask(): Promise<void> {
    const kindFields = this.taskKindPatch();
    await this.store.saveTask({
      title: this.taskTitle,
      initial_prompt: this.taskInitialPrompt,
      output_type: kindFields.output_type,
      node_kind: kindFields.node_kind,
      lifecycle_phase: kindFields.lifecycle_phase,
      repo_path: this.taskRepoPath.trim() || undefined,
      execute_config: this.taskExecuteConfigPatch(),
      dependencies: this.dependencies,
      sibling_dependencies: this.siblingDependencies,
      research_agent_id: this.taskResearchAgentId,
      code_agent_id: this.taskCodeAgentId,
      brief: this.taskBriefForm,
    });
  }

  regenerateTaskBrief(): void {
    const project = this.store.project();
    const task = this.store.selectedTask();
    this.taskBriefForm = applyTaskBriefDefaults({
      title: this.taskTitle,
      initialPrompt: this.taskInitialPrompt,
      dar: task ? taskDar(task) : '',
      outputType: this.outputType,
      nodeKind: task?.node_kind,
      projectDar: project?.dar,
      repoUrl: project?.repo_url,
      lifecyclePhase: task?.lifecycle_phase,
    }, {
      lifecyclePhase: task?.lifecycle_phase,
      nodeKind: task?.node_kind,
    });
    void this.onEditorFieldAutoSave();
  }

  setProjectViewMode(mode: 'mindmap' | 'kanban'): void {
    this.projectViewMode.set(mode);
  }

  setKanbanScope(scopeId: KanbanScopeId): void {
    this.kanbanScopeId.set(scopeId);
  }

  openKanbanTask(taskId: string): void {
    void this.store.openTask(taskId);
  }

  incomingGraphEdges(taskId: string): TaskGraphEdge[] {
    const edges = this.store.project()?.task_graph_edges ?? [];
    return incomingEdges(taskId, edges);
  }

  outgoingGraphEdges(taskId: string): TaskGraphEdge[] {
    const edges = this.store.project()?.task_graph_edges ?? [];
    return outgoingEdges(taskId, edges);
  }

  childGraphEdges(taskId: string): TaskGraphEdge[] {
    return this.outgoingGraphEdges(taskId).filter((edge) => edge.kind === 'tree');
  }

  parentGraphEdges(taskId: string): TaskGraphEdge[] {
    return this.incomingGraphEdges(taskId).filter((edge) => edge.kind === 'tree');
  }

  orderingGraphEdges(taskId: string): TaskGraphEdge[] {
    return this.incomingGraphEdges(taskId).filter((edge) => edge.kind === 'ordering');
  }

  flowGraphEdges(taskId: string): TaskGraphEdge[] {
    const kinds = new Set<TaskEdgeKind>(['fork', 'join', 'cycle']);
    return [
      ...this.incomingGraphEdges(taskId),
      ...this.outgoingGraphEdges(taskId),
    ].filter((edge) => kinds.has(edge.kind));
  }

  setTaskPageTab(tab: 'chat' | 'details' | 'graph'): void {
    this.taskPageTab.set(tab);
  }

  private async pushTaskGraphEdge(
    taskId: string,
    from: string,
    to: string,
    kind: TaskEdgeKind,
    breakCondition?: string,
  ): Promise<void> {
    if (!from || !to || from === to) return;
    const project = this.store.project();
    if (!project) return;
    const tasks = this.store.tasks();
    const edges = [...(project.task_graph_edges ?? [])];
    if (kind === 'cycle' && !breakCondition?.trim()) {
      this.store.error.set('Cycle edges require a break condition.');
      return;
    }
    const key = edgeKey(from, to, kind);
    if (edges.some((edge) => edge.edge_id === key)) return;
    edges.push({
      edge_id: key,
      from_task_id: from,
      to_task_id: to,
      kind,
      break_condition: breakCondition?.trim() || undefined,
    });
    try {
      validateTaskGraphEdges(edges, new Set(tasks.map((task) => task.task_id)));
    } catch (error) {
      this.store.error.set(error instanceof Error ? error.message : 'Invalid graph edge.');
      return;
    }
    await this.store.updateProjectTaskGraph(edges);
  }

  async addHierarchyChildLink(taskId: string): Promise<void> {
    const childId = this.graphHierarchyChildId.trim();
    await this.pushTaskGraphEdge(taskId, taskId, childId, 'tree');
    this.graphHierarchyChildId = '';
  }

  async addOrderingPrerequisite(taskId: string): Promise<void> {
    const fromId = this.graphOrderFromId.trim();
    await this.pushTaskGraphEdge(taskId, fromId, taskId, 'ordering');
    this.graphOrderFromId = '';
  }

  async addFlowGraphLink(taskId: string): Promise<void> {
    const fromId = this.graphFlowFromId.trim();
    await this.pushTaskGraphEdge(
      taskId,
      fromId,
      taskId,
      this.graphFlowKind,
      this.graphFlowBreakCondition,
    );
    this.graphFlowFromId = '';
    this.graphFlowBreakCondition = '';
  }

  resolveTaskTitle(taskId: string): string {
    return this.store.tasks().find((item) => item.task_id === taskId)?.title ?? taskId;
  }

  async removeTaskGraphEdge(edgeId: string): Promise<void> {
    const project = this.store.project();
    if (!project) return;
    const edges = (project.task_graph_edges ?? []).filter((edge) => edge.edge_id !== edgeId);
    await this.store.updateProjectTaskGraph(edges);
  }

  taskBriefLabel(field: (typeof TASK_BRIEF_FIELDS)[number]): string {
    return field.toUpperCase();
  }

  deleteTask(task: ProjectTask): void {
    if (confirm(`Delete "${task.title}"?`)) {
      void this.store.deleteTask(task.task_id);
    }
  }
}

function clampZoom(value: number): number {
  return clampMindmapZoom(value);
}

