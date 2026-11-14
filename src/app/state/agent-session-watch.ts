import type { ChatMessage, ProjectTask } from '../core/models';
import { agentTurnMayCompleteWorkflow } from '../core/agent-run-completion';
import type { AgentRunTextSource } from '../core/agent-run-response';
import { taskChatAwaitingWorkflowReply } from '../core/task-status-coalesce';
import { taskNeedsDoingBackgroundPoll } from '../core/task-state-machine';

/** Whether this task should keep an background agent session poll active. */
export function taskNeedsAgentSessionWatch(
  task: ProjectTask,
  messages: ChatMessage[],
  subprojectCursorAgentId: string | undefined,
  options?: { forcePending?: boolean; latestRun?: AgentRunTextSource },
): boolean {
  if (options?.forcePending) return true;
  if (task.pending_action === 'merge') return true;
  if (taskNeedsDoingBackgroundPoll(task, subprojectCursorAgentId)) return true;
  return taskChatAwaitingWorkflowReply(
    messages,
    task.task_id,
    task.latest_run_id,
    options?.latestRun,
  );
}

export function agentSessionWatchTaskIds(
  tasks: ProjectTask[],
  subprojectAgentId: (subprojectId: string) => string | undefined,
  extraTaskIds: Iterable<string> = [],
  messagesForTask?: (taskId: string) => ChatMessage[],
): string[] {
  const ids = new Set<string>();
  for (const task of tasks) {
    const subprojectAgent = task.subproject_id ? subprojectAgentId(task.subproject_id) : undefined;
    const messages = messagesForTask?.(task.task_id) ?? [];
    if (taskNeedsAgentSessionWatch(task, messages, subprojectAgent)) {
      ids.add(task.task_id);
    }
  }
  for (const taskId of extraTaskIds) ids.add(taskId);
  return [...ids];
}

/** True when the latest user run now has a workflow-terminal assistant reply. */
export function runReceivedWorkflowTerminalReply(
  messages: ChatMessage[],
  taskId: string,
  latestRunId: string | undefined,
  run?: AgentRunTextSource,
): boolean {
  if (!latestRunId) return false;
  const assistant = messages.find((message) => (
    message.scope === 'task'
    && message.task_id === taskId
    && message.role === 'assistant'
    && message.run_id === latestRunId
  ));
  if (!assistant) {
    return agentTurnMayCompleteWorkflow('', run);
  }
  return agentTurnMayCompleteWorkflow(assistant.content, run);
}