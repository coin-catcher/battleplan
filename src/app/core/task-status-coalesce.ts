import type { ChatMessage, ProjectTask, TaskStatus } from './models';
import { isWorkflowTerminalAgentReply } from './agent-run-response';
import { taskNeedsDoingBackgroundPoll } from './task-state-machine';

const TERMINAL_WHILE_POLLING: TaskStatus[] = ['TODO', 'REVIEW', 'DONE', 'BLOCKED', 'ABANDONED'];

/** Shallow clone so task rows in the store and chat cache do not share one object. */
export function cloneProjectTask(task: ProjectTask): ProjectTask {
  return {
    ...task,
    dependencies: [...task.dependencies],
    sibling_dependencies: [...(task.sibling_dependencies ?? [])],
    subproject_ids: task.subproject_ids ? [...task.subproject_ids] : undefined,
  };
}

/**
 * When opening a cached task panel, do not let an older snapshot clobber a live DOING task
 * that is still polling for the backend agent.
 */
export function coalesceCachedTaskStatus(
  live: ProjectTask | undefined,
  cached: ProjectTask,
  backgroundPollActive: boolean,
): ProjectTask {
  const next = cloneProjectTask(cached);
  if (!live || !backgroundPollActive) return next;
  if (live.status !== 'DOING') return next;
  if (!TERMINAL_WHILE_POLLING.includes(next.status)) return next;
  return {
    ...next,
    status: 'DOING',
    latest_run_id: live.latest_run_id ?? next.latest_run_id,
    pending_action: live.pending_action ?? next.pending_action,
  };
}

export function taskBackgroundPollActive(
  task: ProjectTask | undefined,
  subprojectCursorAgentId: string | undefined,
  doingBackgroundGenerationHasTask: boolean,
): boolean {
  if (!task) return doingBackgroundGenerationHasTask;
  return doingBackgroundGenerationHasTask
    || taskNeedsDoingBackgroundPoll(task, subprojectCursorAgentId);
}

/** True while the latest run has a user message but no workflow-terminal assistant reply yet. */
export function taskChatAwaitingWorkflowReply(
  messages: ChatMessage[],
  taskId: string,
  latestRunId?: string,
): boolean {
  if (!latestRunId) return false;
  const scoped = messages.filter((message) => message.scope === 'task' && message.task_id === taskId);
  const userSent = scoped.some((message) => message.role === 'user' && message.run_id === latestRunId);
  if (!userSent) return false;
  const assistant = scoped.find((message) => message.role === 'assistant' && message.run_id === latestRunId);
  if (!assistant) return true;
  return !isWorkflowTerminalAgentReply(assistant.content);
}

export function shouldCoalesceInboundTaskStatus(
  live: ProjectTask | undefined,
  inbound: ProjectTask,
  messages: ChatMessage[],
  backgroundPollActive: boolean,
): boolean {
  if (!live || live.status !== 'DOING') return backgroundPollActive;
  if (!TERMINAL_WHILE_POLLING.includes(inbound.status)) return backgroundPollActive;
  return backgroundPollActive
    || taskChatAwaitingWorkflowReply(messages, inbound.task_id, live.latest_run_id ?? inbound.latest_run_id);
}
