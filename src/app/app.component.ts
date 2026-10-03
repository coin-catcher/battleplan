import { Component, computed, effect, ElementRef, HostListener, inject, NgZone, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ChatArtifact, ChatMessage, OutputType, ProjectTask, TaskStatus } from './core/models';
import { TASK_STATUSES } from './core/models';
import { isMarkdownPath, prepareMarkdown } from './core/markdown';
import { applyTheme, THEMES, type ThemeId } from './core/themes';
import { AppPreferences } from './data/app-preferences.service';
import { electronBridge, isElectronApp } from './data/electron-bridge';
import { CursorKey } from './data/cursor-key.service';
import { ProjectPortability } from './data/project-portability.service';
import {
  cardinalAnchor,
  layoutMindmap,
  pickCardinalEdge,
  pickNorthWestCorner,
  pointerToWorld,
  type CardinalDirection,
  type MindmapNode,
} from './core/mindmap';
import { MarkdownComponent } from 'ngx-markdown';
import { editorPanelDirty } from './core/editor-dirty';
import { taskDar, taskInitialPrompt } from './core/task-fields';
import { normalChildIds } from './core/dependencies';
import { BattleplanStore } from './state/battleplan-store.service';

@Component({
  selector: 'app-root',
  imports: [FormsModule, MarkdownComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {
  readonly store = inject(BattleplanStore);
  readonly cursorKey = inject(CursorKey);
  readonly preferences = inject(AppPreferences);
  readonly portability = inject(ProjectPortability);
  readonly desktop = isElectronApp();
  readonly themes = THEMES;
  private readonly zone = inject(NgZone);
  readonly statuses = TASK_STATUSES;
  readonly signingOpen = signal(false);
  readonly zoom = signal(1);
  readonly dragPins = signal<Record<string, { x: number; y: number }>>({});
  readonly hoveredConnect = signal<{ nodeId: string; direction: CardinalDirection } | null>(null);
  readonly connectPanel = signal<{ sourceId: string; sourceKind: 'project' | 'task'; direction: CardinalDirection } | null>(null);
  readonly convertPanel = signal<{ taskId: string } | null>(null);
  readonly hoveredConvert = signal<string | null>(null);
  readonly editingNodeId = signal<string | null>(null);
  readonly editDraft = signal('');
  readonly mapDraggingNodeId = signal<string | null>(null);
  readonly mapStage = viewChild<ElementRef<HTMLElement>>('mapStage');
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
    return layoutMindmap(project?.title ?? 'Project', tasks, projectPin);
  });

  apiKey = '';
  keyError = '';
  replacingKey = false;
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
  projectDar = '';
  chatDraft = '';
  taskTitle = '';
  taskDar = '';
  taskInitialPrompt = '';
  subprojectInitialPrompt = '';
  outputType: OutputType = 'code';
  dependencies: string[] = [];
  siblingDependencies: string[] = [];
  readonly executeChildrenPrompt = signal<string | null>(null);
  codeRepo = '';
  codeBranch = '';
  codeMessage = '';
  codeLink = '';
  researchRepo = '';
  researchBranch = '';
  researchMessage = '';
  researchLink = '';
  researchPath = '';

  private centeredProject = '';
  private titleSignature = '';
  private boundTaskFormId = '';
  private outputSignature = '';
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
        ? `${project.project_id}:${project.title}:${project.repo_url ?? ''}:${project.starting_ref ?? ''}:${project.dar ?? ''}:${project.initial_prompt}:${project.cursor_agent_id ?? ''}:${selection.kind}`
        : '';
      if (signature === this.titleSignature) return;
      this.titleSignature = signature;
      this.title = project?.title ?? '';
      this.projectRepo = project?.repo_url ?? '';
      this.projectBranch = project?.starting_ref || 'main';
      this.projectDar = project?.dar ?? '';
      if (selection.kind === 'subproject') {
        this.subprojectInitialPrompt = project?.initial_prompt ?? '';
      }
    });
    effect(() => {
      const projectId = this.store.project()?.project_id;
      const stage = this.mapStage()?.nativeElement;
      if (!projectId || !stage || this.centeredProject === projectId) return;
      const center = (): void => {
        if (this.centeredProject === projectId) return;
        if (stage.clientWidth === 0) {
          requestAnimationFrame(center);
          return;
        }
        this.centeredProject = projectId;
        this.centerMap();
      };
      requestAnimationFrame(center);
    });

    effect(() => {
      const selection = this.store.selection();
      const task = this.store.selectedTask();
      if (selection.kind !== 'task' || !task) {
        this.boundTaskFormId = '';
        return;
      }
      if (this.boundTaskFormId === task.task_id) return;
      this.boundTaskFormId = task.task_id;
      this.taskTitle = task.title;
      this.taskDar = taskDar(task);
      this.taskInitialPrompt = taskInitialPrompt(task);
      this.outputType = task.output_type;
      this.dependencies = [...task.dependencies];
      this.siblingDependencies = [...(task.sibling_dependencies ?? [])];
    });

    effect(() => {
      if (!this.desktop) return;
      const selection = this.store.selection();
      const exportEnabled = Boolean(this.store.project());
      const saveEnabled = this.editorIsDirty()
        || ((selection.kind === 'project' && Boolean(this.title.trim()))
        || (selection.kind === 'subproject' && Boolean(this.title.trim()))
        || selection.kind === 'task');
      void electronBridge()?.invoke('menu:sync-state', { exportEnabled, saveEnabled });
    });
    effect((onCleanup) => {
      if (!this.convertPanel()) return;
      window.addEventListener('pointerdown', this.onMapDismissCapture, true);
      onCleanup(() => window.removeEventListener('pointerdown', this.onMapDismissCapture, true));
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
    if (this.cursorKey.ready()) await this.store.loadProjects();
    electronBridge()?.on('update:available', (payload) => {
      const info = payload as { version?: string; releaseNotes?: string | null };
      const version = info.version ?? 'new';
      const notes = typeof info.releaseNotes === 'string' ? info.releaseNotes : 'A newer Battleplan release is available.';
      this.zone.run(() => this.updatePrompt.set({ version, notes }));
    });
    electronBridge()?.on('menu:action', (action) => {
      this.zone.run(() => this.handleMenuAction(String(action)));
    });
    electronBridge()?.on('update:status', (payload) => {
      const info = payload as { upToDate?: boolean; current?: string };
      if (info.upToDate) this.zone.run(() => this.store.notice.set(`Battleplan ${info.current ?? ''} is up to date.`));
    });
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.saveCurrent();
    }
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
        dar: this.projectDar,
        initial_prompt: selection.kind === 'subproject' ? this.subprojectInitialPrompt : undefined,
      },
      {
        title: this.taskTitle,
        dar: this.taskDar,
        initial_prompt: this.taskInitialPrompt,
        output_type: this.outputType,
        dependencies: this.dependencies,
        sibling_dependencies: this.siblingDependencies,
      },
      project,
      this.store.selectedTask(),
    );
  }

  onEditorFieldBlur(): void {
    if (!this.autoSaveEnabled() || !this.editorIsDirty()) return;
    void this.persistEditorChanges();
  }

  onEditorFieldAutoSave(): void {
    this.onEditorFieldBlur();
  }

  private async persistEditorChanges(): Promise<boolean> {
    const selection = this.store.selection();
    if (selection.kind === 'project') {
      await this.store.saveProject({
        title: this.title.trim(),
        repo_url: this.projectRepo.trim(),
        starting_ref: this.projectBranch.trim() || 'main',
        dar: this.projectDar,
      });
    } else if (selection.kind === 'subproject') {
      await this.store.saveEditorProject({
        title: this.title.trim(),
        repo_url: this.projectRepo.trim(),
        starting_ref: this.projectBranch.trim() || 'main',
        dar: this.projectDar,
        initial_prompt: this.subprojectInitialPrompt,
      });
    } else if (selection.kind === 'task') {
      await this.store.saveTask({
        title: this.taskTitle,
        dar: this.taskDar,
        initial_prompt: this.taskInitialPrompt,
        output_type: this.outputType,
        dependencies: this.dependencies,
        sibling_dependencies: this.siblingDependencies,
      });
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
    const theme = (event.target as HTMLSelectElement).value as ThemeId;
    this.themeId.set(theme);
    applyTheme(theme, !this.desktop);
    void this.preferences.saveTheme(theme);
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
      void this.preferences.savePaneWidth(this.paneWidth());
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  private centerMap(): void {
    const stage = this.mapStage()?.nativeElement;
    const project = this.map().nodes.find((node) => node.id === 'project');
    if (!stage || !project) return;
    const zoom = this.zoom();
    stage.scrollLeft = project.x * zoom - stage.clientWidth / 2;
    stage.scrollTop = project.y * zoom - stage.clientHeight / 2;
  }

  private zoomAt(offsetX: number, offsetY: number, factor: number): void {
    const stage = this.mapStage()?.nativeElement;
    const previous = this.zoom();
    const next = clampZoom(previous * factor);
    if (!stage || next === previous) {
      this.zoom.set(next);
      return;
    }
    const worldX = (stage.scrollLeft + offsetX) / previous;
    const worldY = (stage.scrollTop + offsetY) / previous;
    this.zoom.set(next);
    queueMicrotask(() => {
      stage.scrollLeft = worldX * next - offsetX;
      stage.scrollTop = worldY * next - offsetY;
    });
  }

  showCursorKey(): boolean {
    return !this.cursorKey.ready() || this.signingOpen();
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
      dar: this.projectDar,
    });
  }

  saveSubproject(): void {
    void this.store.saveEditorProject({
      title: this.title.trim(),
      repo_url: this.projectRepo.trim(),
      starting_ref: this.projectBranch.trim() || 'main',
      dar: this.projectDar,
      initial_prompt: this.subprojectInitialPrompt,
    });
  }

  taskAgentStarted(task: ProjectTask): boolean {
    return Boolean(task.cursor_agent_id);
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
        dar: this.projectDar,
        initial_prompt: this.subprojectInitialPrompt,
      });
      if (!this.store.error()) await this.store.executeSubprojectChat();
    } finally {
      this.store.chatActionPending.set(null);
    }
  }

  approveTask(): void {
    this.store.chatActionPending.set('merge');
    void this.store.approve().finally(() => this.store.chatActionPending.set(null));
  }

  chatActionsLocked(): boolean {
    return this.store.chatActionPending() !== null || this.store.busy();
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
    void electronBridge()?.invoke<{ ok: boolean }>('update:install').then((result) => {
      if (!result.ok) this.store.error.set('Could not install the update.');
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
    if (target.closest('.map-node, .map-edge-arrow, .map-connect-panel, .map-convert-panel, .map-convert-handle, .map-play-children, .zoom-controls')) return;
    if (this.connectPanel()) {
      this.dismissConnectPanel();
      return;
    }
    const stage = this.mapStage()?.nativeElement;
    if (!stage) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const scrollLeft = stage.scrollLeft;
    const scrollTop = stage.scrollTop;
    const move = (ev: PointerEvent) => {
      stage.scrollLeft = scrollLeft - (ev.clientX - startX);
      stage.scrollTop = scrollTop - (ev.clientY - startY);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  onNodePointerDown(node: MindmapNode, event: PointerEvent): void {
    if (this.editingNodeId() === node.id) return;
    if ((event.target as HTMLElement).closest('.map-edge-arrow, .map-connect-panel, .map-play-children')) return;
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = node.x;
    const originY = node.y;
    let dragged = false;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / this.zoom();
      const dy = (ev.clientY - startY) / this.zoom();
      if (!dragged && Math.hypot(dx, dy) < 4) return;
      dragged = true;
      this.mapDraggingNodeId.set(node.id);
      this.hoveredConnect.set(null);
      this.dragPins.update((pins) => ({ ...pins, [node.id]: { x: originX + dx, y: originY + dy } }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.mapDraggingNodeId.set(null);
      const pin = this.dragPins()[node.id];
      if (dragged && pin) {
        void this.store.placeNode(node.id, pin.x, pin.y);
      } else if (!dragged) {
        this.selectMapNode(node);
      }
      this.dragPins.update((pins) => {
        const next = { ...pins };
        delete next[node.id];
        return next;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
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
    if (target.closest('.map-connect-panel, .map-convert-panel, .map-edge-arrow, .map-convert-handle, .map-play-children')) return;
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

  openCode(taskId: string): void {
    void this.store.openOutput(taskId, 'code');
  }

  openResearch(taskId: string): void {
    void this.store.openOutput(taskId, 'research');
  }

  toggleSiblingDependency(taskId: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.siblingDependencies = checked
      ? [...this.siblingDependencies, taskId]
      : this.siblingDependencies.filter((id) => id !== taskId);
    this.onEditorFieldAutoSave();
  }

  async onProjectChange(event: Event): Promise<void> {
    const select = event.target as HTMLSelectElement;
    const projectId = select.value;
    const current = this.store.projectId() ?? '';
    if (!projectId || projectId === current) return;
    select.value = current;
    await this.guardUnsavedChanges(async () => {
      await this.store.selectProject(projectId);
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
    await this.store.saveTask({
      title: this.taskTitle,
      dar: this.taskDar,
      initial_prompt: this.taskInitialPrompt,
      output_type: this.outputType,
      dependencies: this.dependencies,
      sibling_dependencies: this.siblingDependencies,
    });
  }

  deleteTask(task: ProjectTask): void {
    if (confirm(`Delete "${task.title}"?`)) {
      void this.store.deleteTask(task.task_id);
    }
  }
}

function clampZoom(value: number): number {
  return Math.min(2.4, Math.max(0.45, value));
}

