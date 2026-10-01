import { Component, computed, effect, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { OutputType, ProjectTask, TaskStatus } from './core/models';
import { TASK_STATUSES } from './core/models';
import { layoutMindmap, type MindmapNode } from './core/mindmap';
import { RequestSigner } from './api/request-signer.service';
import { WarplanStore } from './state/warplan-store.service';

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {
  readonly store = inject(WarplanStore);
  readonly signer = inject(RequestSigner);
  readonly statuses = TASK_STATUSES;
  readonly signingOpen = signal(false);
  readonly map = computed(() => layoutMindmap(this.store.project()?.title ?? 'Project', this.store.tasks()));

  keyPem = '';
  keyError = '';
  replacingKey = false;

  title = '';
  initialPrompt = '';
  repoUrl = '';
  startingRef = 'main';
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

  private titleSignature = '';
  private taskSignature = '';
  private outputSignature = '';

  constructor() {
    effect(() => {
      const project = this.store.project();
      const signature = project ? `${project.project_id}:${project.title}` : '';
      if (signature === this.titleSignature) return;
      this.titleSignature = signature;
      this.title = project?.title ?? '';
    });

    effect(() => {
      const task = this.store.selectedTask();
      if (!task || this.store.selection().kind !== 'task') return;
      const signature = `${task.task_id}:${task.updated_at}:${task.status}:${task.dependencies.join(',')}`;
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
    await this.signer.restore();
    if (this.signer.ready()) await this.store.loadProjects();
  }

  showSigning(): boolean {
    return !this.signer.ready() || this.signingOpen();
  }

  openSigning(): void {
    this.keyError = '';
    this.replacingKey = false;
    this.signingOpen.set(true);
  }

  closeSigning(): void {
    this.keyPem = '';
    this.keyError = '';
    this.replacingKey = false;
    this.signingOpen.set(false);
  }

  async onKeyFile(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.keyPem = await file.text();
  }

  async importKey(): Promise<void> {
    this.keyError = '';
    try {
      await this.signer.importPem(this.keyPem);
      this.keyPem = '';
      this.replacingKey = false;
      this.signingOpen.set(false);
      if (this.store.projects().length === 0) await this.store.loadProjects();
    } catch (error) {
      this.keyError = error instanceof Error ? error.message : 'Could not import that key.';
    }
  }

  clearKey(): void {
    this.signer.clear();
    this.keyPem = '';
    this.replacingKey = false;
    this.signingOpen.set(true);
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
