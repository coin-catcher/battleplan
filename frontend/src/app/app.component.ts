import { Component, computed, effect, ElementRef, inject, NgZone, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ChatArtifact, ChatMessage, OutputType, ProjectTask, TaskStatus } from './core/models';
import { TASK_STATUSES } from './core/models';
import { isMarkdownPath, prepareMarkdown } from './core/markdown';
import { applyTheme, readTheme, THEMES, type ThemeId } from './core/themes';
import { CursorKey } from './data/cursor-key.service';
import { layoutMindmap, type MindmapNode } from './core/mindmap';
import { MarkdownComponent } from 'ngx-markdown';
import { WarplanStore } from './state/warplan-store.service';

@Component({
  selector: 'app-root',
  imports: [FormsModule, MarkdownComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {
  readonly store = inject(WarplanStore);
  readonly cursorKey = inject(CursorKey);
  readonly themes = THEMES;
  private readonly zone = inject(NgZone);
  readonly statuses = TASK_STATUSES;
  readonly signingOpen = signal(false);
  readonly zoom = signal(1);
  readonly dragPins = signal<Record<string, { x: number; y: number }>>({});
  readonly mapStage = viewChild<ElementRef<HTMLElement>>('mapStage');
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
  readonly themeId = signal(readTheme());
  readonly paneWidth = signal(readPaneWidth());

  title = '';
  initialPrompt = '';
  repoUrl = '';
  startingRef = 'main';
  projectRepo = '';
  projectBranch = 'main';
  chatDraft = '';
  taskTitle = '';
  taskPrompt = '';
  outputType: OutputType = 'code';
  dependencies: string[] = [];
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
  private taskSignature = '';
  private outputSignature = '';
  private readonly onMapWheelCapture = (event: WheelEvent): void => {
    this.onMapWheel(event);
  };

  constructor() {
    effect((onCleanup) => {
      const stage = this.mapStage()?.nativeElement;
      if (!stage) return;
      stage.addEventListener('wheel', this.onMapWheelCapture, { passive: false });
      onCleanup(() => stage.removeEventListener('wheel', this.onMapWheelCapture));
    });
    effect(() => {
      const project = this.store.project();
      const signature = project ? `${project.project_id}:${project.title}:${project.repo_url ?? ''}:${project.starting_ref ?? ''}` : '';
      if (signature === this.titleSignature) return;
      this.titleSignature = signature;
      this.title = project?.title ?? '';
      this.projectRepo = project?.repo_url ?? '';
      this.projectBranch = project?.starting_ref || 'main';
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
      const task = this.store.selectedTask();
      if (!task || this.store.selection().kind !== 'task') return;
      const signature = `${task.task_id}:${task.status}:${task.title}:${task.prompt}:${task.output_type}:${task.dependencies.join(',')}`;
      if (signature === this.taskSignature) return;
      this.taskSignature = signature;
      this.taskTitle = task.title;
      this.taskPrompt = task.prompt;
      this.outputType = task.output_type;
      this.dependencies = [...task.dependencies];
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
    applyTheme(this.themeId());
    this.cursorKey.restore();
    if (this.cursorKey.ready()) await this.store.loadProjects();
  }

  chooseTheme(event: Event): void {
    const theme = (event.target as HTMLSelectElement).value as ThemeId;
    this.themeId.set(theme);
    applyTheme(theme);
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
      localStorage.setItem('warplan-pane-width', String(this.paneWidth()));
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
    try {
      this.cursorKey.save(this.apiKey);
      this.apiKey = '';
      this.replacingKey = false;
      this.signingOpen.set(false);
      if (this.store.projects().length === 0) void this.store.loadProjects();
    } catch (error) {
      this.keyError = error instanceof Error ? error.message : 'Could not save that key.';
    }
  }

  clearCursorKey(): void {
    this.cursorKey.clear();
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

  isMapSelected(node: MindmapNode): boolean {
    const selection = this.store.selection();
    if (node.kind === 'project') return selection.kind === 'project';
    return (selection.kind === 'task' || selection.kind === 'code' || selection.kind === 'research')
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
    });
  }

  deleteProject(): void {
    const project = this.store.project();
    if (project && confirm(`Delete "${project.title}"?`)) void this.store.deleteProject();
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
    if (target.closest('.map-node, .zoom-controls')) return;
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
    if ((event.target as HTMLElement).closest('.plus')) return;
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
      this.dragPins.update((pins) => ({ ...pins, [node.id]: { x: originX + dx, y: originY + dy } }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
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
    if (node.kind === 'project') void this.store.openProjectChat();
    else void this.store.openTask(node.id);
  }

  addMapTask(node: MindmapNode, event: Event): void {
    event.stopPropagation();
    void this.store.addTask(node.kind === 'task' ? node.id : undefined);
  }

  openCode(taskId: string): void {
    void this.store.openOutput(taskId, 'code');
  }

  openResearch(taskId: string): void {
    void this.store.openOutput(taskId, 'research');
  }

  start(taskId: string): void {
    void this.store.transition(taskId, 'DOING', false);
  }

  toggleDependency(taskId: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.dependencies = checked
      ? [...this.dependencies, taskId]
      : this.dependencies.filter((id) => id !== taskId);
  }

  async onProjectChange(event: Event): Promise<void> {
    const projectId = (event.target as HTMLSelectElement).value;
    if (projectId) await this.store.selectProject(projectId);
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
    const selection = this.store.selection();
    if (selection.kind === 'task') await this.store.sendTaskMessage(message);
    else await this.store.sendProjectMessage(message);
    if (!this.store.error()) this.chatDraft = '';
  }

  async saveTask(): Promise<void> {
    await this.store.saveTask({
      title: this.taskTitle,
      prompt: this.taskPrompt,
      output_type: this.outputType,
      dependencies: this.dependencies,
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

function readPaneWidth(): number {
  const stored = Number(localStorage.getItem('warplan-pane-width'));
  return Number.isFinite(stored) && stored >= 320 ? stored : 640;
}
