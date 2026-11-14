import { inject, Injectable, signal } from '@angular/core';
import type { ChatArtifact, ChatMessage, Project, ProjectTask } from '../core/models';
import { BattleplanApi } from '../api/battleplan-api.service';
import type { AgentCommunicationsBridge } from './agent-communications-bridge';
import {
  agentSessionWatchTaskIds,
  runReceivedWorkflowTerminalReply,
  taskNeedsAgentSessionWatch,
} from './agent-session-watch';

const POLL_INTERVAL_MS = 3000;
const POLL_ATTEMPTS = 300;

export type AgentSessionKind = 'cursor' | 'openai' | 'hermes' | 'research';

export interface AgentSessionRef {
  taskId: string;
  kind: AgentSessionKind;
  latestRunId?: string;
  pendingReply: boolean;
}

export type TaskConversationUpdate = {
  messages: ChatMessage[];
  task: ProjectTask;
  artifacts: ChatArtifact[];
};

export type TaskConversationObserver = (update: TaskConversationUpdate) => void;

/**
 * Async coordinator for external agent sessions (Cursor today; OpenAI / Hermes later).
 * Polls and broadcasts conversation updates while the user works on other tasks.
 *
 * Alias: treat this as the Battleplan **AgentService** in product docs.
 */
@Injectable({ providedIn: 'root' })
export class AgentCommunicationsService {
  private readonly api = inject(BattleplanApi);
  private bridge: AgentCommunicationsBridge | null = null;

  readonly activeTaskSessions = signal<AgentSessionRef[]>([]);

  private readonly taskGeneration = new Map<string, number>();
  private readonly taskTimer = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly taskInflight = new Set<string>();
  /** Tasks with an outbound message not yet workflow-complete (survives unfocus). */
  private readonly pendingReply = new Set<string>();
  private readonly taskObservers = new Map<string, Set<TaskConversationObserver>>();

  private projectGeneration = 0;
  private projectActive = false;
  private projectTimer: ReturnType<typeof setTimeout> | undefined;
  private projectInflight = false;

  attachBridge(bridge: AgentCommunicationsBridge): void {
    this.bridge = bridge;
  }

  isTaskPolling(taskId: string): boolean {
    return this.taskGeneration.has(taskId);
  }

  hasPendingReply(taskId: string): boolean {
    return this.pendingReply.has(taskId);
  }

  /** Call when the user sends / executes before the agent finishes (registers background watch). */
  registerPendingReply(taskId: string): void {
    this.pendingReply.add(taskId);
    this.ensureTaskWatch(taskId);
    const bridge = this.bridge;
    if (bridge) this.refreshActiveSessionSignal(bridge.tasks());
  }

  clearPendingReply(taskId: string): void {
    if (!this.pendingReply.delete(taskId)) return;
    const bridge = this.bridge;
    if (bridge) this.refreshActiveSessionSignal(bridge.tasks());
  }

  /** Per-task observers receive every broadcast while registered (e.g. open task panel). */
  observeTask(taskId: string, observer: TaskConversationObserver): () => void {
    let set = this.taskObservers.get(taskId);
    if (!set) {
      set = new Set();
      this.taskObservers.set(taskId, set);
    }
    set.add(observer);
    return () => {
      set?.delete(observer);
      if (set && set.size === 0) this.taskObservers.delete(taskId);
    };
  }

  syncTaskWatches(
    tasks: ProjectTask[],
    subprojectAgentId: (id: string) => string | undefined,
    messagesForTask?: (taskId: string) => ChatMessage[],
  ): void {
    const wanted = new Set(agentSessionWatchTaskIds(
      tasks,
      subprojectAgentId,
      this.pendingReply,
      messagesForTask,
    ));
    for (const taskId of wanted) this.ensureTaskWatch(taskId);
    for (const taskId of [...this.taskGeneration.keys()]) {
      if (!wanted.has(taskId)) this.stopTaskWatch(taskId);
    }
    this.refreshActiveSessionSignal(tasks);
    this.syncProjectWatch();
  }

  ensureTaskWatch(taskId: string): void {
    const bridge = this.bridge;
    if (!bridge) return;
    const task = bridge.tasks().find((item) => item.task_id === taskId);
    const subprojectAgent = task?.subproject_id ? bridge.subprojectCursorAgentId(task.subproject_id) : undefined;
    const forced = this.pendingReply.has(taskId);
    if (!forced && (!task || !taskNeedsAgentSessionWatch(task, [], subprojectAgent))) {
      this.stopTaskWatch(taskId);
      return;
    }
    if (this.taskGeneration.has(taskId)) return;
    const generation = (this.taskGeneration.get(taskId) ?? 0) + 1;
    this.taskGeneration.set(taskId, generation);
    this.scheduleTaskTick(taskId, generation, 0);
    this.refreshActiveSessionSignal(bridge.tasks());
  }

  stopTaskWatch(taskId: string): void {
    this.taskGeneration.set(taskId, (this.taskGeneration.get(taskId) ?? 0) + 1);
    this.taskGeneration.delete(taskId);
    const timer = this.taskTimer.get(taskId);
    if (timer) clearTimeout(timer);
    this.taskTimer.delete(taskId);
    this.taskInflight.delete(taskId);
    const bridge = this.bridge;
    if (bridge) this.refreshActiveSessionSignal(bridge.tasks());
  }

  private broadcastTaskUpdate(update: TaskConversationUpdate): void {
    const bridge = this.bridge;
    bridge?.onTaskConversation(update);
    bridge?.onTaskConversationBroadcast?.(update);
    const observers = this.taskObservers.get(update.task.task_id);
    if (observers) {
      for (const observer of observers) observer(update);
    }
  }

  private syncProjectWatch(): void {
    const bridge = this.bridge;
    if (!bridge) return;
    const project = bridge.rootProject();
    const root = project && !project.parent_task_id && !project.parent_project_id ? project : null;
    const needsWatch = Boolean(root && (root.status ?? 'TODO') === 'DOING' && root.cursor_agent_id);
    if (needsWatch && root) {
      this.ensureProjectWatch(root.project_id);
    } else {
      this.stopProjectWatch();
    }
  }

  ensureProjectWatch(projectId: string): void {
    if (this.projectActive) return;
    this.projectActive = true;
    const generation = ++this.projectGeneration;
    this.scheduleProjectTick(projectId, generation, 0);
  }

  stopProjectWatch(): void {
    if (!this.projectActive && !this.projectTimer) return;
    this.projectActive = false;
    this.projectGeneration += 1;
    if (this.projectTimer) clearTimeout(this.projectTimer);
    this.projectTimer = undefined;
    this.projectInflight = false;
  }

  private scheduleTaskTick(taskId: string, generation: number, attempt: number): void {
    if (this.taskGeneration.get(taskId) !== generation) return;
    if (attempt >= POLL_ATTEMPTS) return;
    const timer = setTimeout(() => {
      void this.runTaskTick(taskId, generation, attempt);
    }, attempt === 0 ? 0 : POLL_INTERVAL_MS);
    this.taskTimer.set(taskId, timer);
  }

  private async runTaskTick(taskId: string, generation: number, attempt: number): Promise<void> {
    const bridge = this.bridge;
    if (!bridge || this.taskGeneration.get(taskId) !== generation) return;
    if (this.taskInflight.has(taskId)) {
      this.scheduleTaskTick(taskId, generation, attempt + 1);
      return;
    }
    this.taskInflight.add(taskId);
    try {
      const task = bridge.tasks().find((item) => item.task_id === taskId);
      const subprojectAgent = task?.subproject_id ? bridge.subprojectCursorAgentId(task.subproject_id) : undefined;
      const forced = this.pendingReply.has(taskId);
      if (!forced && (!task || !taskNeedsAgentSessionWatch(task, [], subprojectAgent))) {
        this.stopTaskWatch(taskId);
        return;
      }
      if (task?.output_type === 'subproject' && task.subproject_id) {
        const page = await this.api.listProjectMessages(task.subproject_id);
        if (this.taskGeneration.get(taskId) !== generation || !this.bridge) return;
        await bridge.reloadProjects();
        const freshTask = bridge.tasks().find((item) => item.task_id === taskId) ?? task;
        bridge.onSubprojectTaskBundle(taskId, page, freshTask);
        if (bridge.isWatchingTaskChat(taskId)) bridge.onProjectConversation(page);
        const refreshed = await this.api.listTaskMessages(taskId);
        if (this.taskGeneration.get(taskId) !== generation) return;
        this.broadcastTaskUpdate(refreshed);
        this.maybeStopTaskWatch(taskId, refreshed.task, refreshed.messages, generation);
      } else {
        const result = await this.api.listTaskMessages(taskId);
        if (this.taskGeneration.get(taskId) !== generation) return;
        this.broadcastTaskUpdate(result);
        if (!this.watchingNeedsContinue(result.task, result.messages, forced)) {
          if (bridge.isWatchingTaskChat(taskId)) await bridge.refreshOutput(result.task);
        }
        this.maybeStopTaskWatch(taskId, result.task, result.messages, generation);
      }
    } catch {
      // Keep polling through transient failures.
    } finally {
      this.taskInflight.delete(taskId);
    }
    if (this.taskGeneration.get(taskId) === generation) {
      this.scheduleTaskTick(taskId, generation, attempt + 1);
    }
  }

  private watchingNeedsContinue(
    task: ProjectTask,
    messages: ChatMessage[],
    forced: boolean,
  ): boolean {
    const bridge = this.bridge;
    if (!bridge) return false;
    const subprojectAgent = task.subproject_id ? bridge.subprojectCursorAgentId(task.subproject_id) : undefined;
    return taskNeedsAgentSessionWatch(task, messages, subprojectAgent, { forcePending: forced });
  }

  private maybeStopTaskWatch(
    taskId: string,
    task: ProjectTask,
    messages: ChatMessage[],
    generation: number,
  ): void {
    if (this.taskGeneration.get(taskId) !== generation) return;
    const bridge = this.bridge;
    const subprojectAgent = task.subproject_id && bridge
      ? bridge.subprojectCursorAgentId(task.subproject_id)
      : undefined;
    const forced = this.pendingReply.has(taskId);
    if (runReceivedWorkflowTerminalReply(messages, taskId, task.latest_run_id)) {
      this.clearPendingReply(taskId);
    }
    if (!taskNeedsAgentSessionWatch(task, messages, subprojectAgent, { forcePending: forced })) {
      this.stopTaskWatch(taskId);
    }
  }

  private scheduleProjectTick(projectId: string, generation: number, attempt: number): void {
    if (this.projectGeneration !== generation) return;
    if (attempt >= POLL_ATTEMPTS) return;
    this.projectTimer = setTimeout(() => {
      void this.runProjectTick(projectId, generation, attempt);
    }, attempt === 0 ? 0 : POLL_INTERVAL_MS);
  }

  private async runProjectTick(projectId: string, generation: number, attempt: number): Promise<void> {
    const bridge = this.bridge;
    if (!bridge || this.projectGeneration !== generation || this.projectInflight) {
      this.scheduleProjectTick(projectId, generation, attempt + 1);
      return;
    }
    this.projectInflight = true;
    try {
      const page = await this.api.listProjectMessages(projectId);
      if (this.projectGeneration !== generation || !this.bridge) return;
      bridge.onProjectConversation(page);
      const project = bridge.rootProject();
      const status = project?.status ?? 'TODO';
      if (status !== 'DOING') {
        this.stopProjectWatch();
        return;
      }
    } catch {
      // Keep polling.
    } finally {
      this.projectInflight = false;
    }
    if (this.projectGeneration === generation) {
      this.scheduleProjectTick(projectId, generation, attempt + 1);
    }
  }

  private refreshActiveSessionSignal(tasks: ProjectTask[]): void {
    const refs: AgentSessionRef[] = [];
    for (const taskId of this.taskGeneration.keys()) {
      const task = tasks.find((item) => item.task_id === taskId);
      if (!task) continue;
      refs.push({
        taskId,
        kind: sessionKindForTask(task),
        latestRunId: task.latest_run_id,
        pendingReply: this.pendingReply.has(taskId),
      });
    }
    this.activeTaskSessions.set(refs);
  }
}

export function sessionKindForTask(task: ProjectTask): AgentSessionKind {
  if (task.output_type === 'subproject') return 'cursor';
  if (task.output_type === 'research' && task.research_agent_id) return 'research';
  return 'cursor';
}

/** Product name alias for AgentCommunicationsService. */
export type AgentService = AgentCommunicationsService;