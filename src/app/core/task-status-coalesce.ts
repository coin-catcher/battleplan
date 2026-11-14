import type { ChatMessage, ProjectTask, TaskStatus } from './models';
import { agentTurnMayCompleteWorkflow, taskTurnAwaitingCompletion } from './agent-run-completion';
import { isSubstantiveAgentResponse, type AgentRunTextSource } from './agent-run-response';
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
  latestRun?: AgentRunTextSource,
): boolean {
  return taskTurnAwaitingCompletion(messages, taskId, latestRunId, latestRun);
}

function latestRunAssistantMessage(
  messages: ChatMessage[],
  taskId: string,
  latestRunId?: string,
): ChatMessage | undefined {
  if (!latestRunId) return undefined;
  return messages.find((message) => (
    message.scope === 'task'
    && message.task_id === taskId
    && message.role === 'assistant'
    && message.run_id === latestRunId
  ));
}

export function shouldCoalesceInboundTaskStatus(
  live: ProjectTask | undefined,
  inbound: ProjectTask,
  messages: ChatMessage[],
  backgroundPollActive: boolean,
  latestRun?: AgentRunTextSource,
): boolean {
  if (!live || live.status !== 'DOING') return backgroundPollActive;
  if (!TERMINAL_WHILE_POLLING.includes(inbound.status)) return backgroundPollActive;

  const runId = live.latest_run_id ?? inbound.latest_run_id;
  const assistant = latestRunAssistantMessage(messages, inbound.task_id, runId);
  if (
    inbound.status === 'REVIEW'
    && assistant
    && agentTurnMayCompleteWorkflow(assistant.content, latestRun ?? { result: assistant.content })
  ) {
    return false;
  }

  return backgroundPollActive
    || taskChatAwaitingWorkflowReply(messages, inbound.task_id, runId, latestRun);
}
