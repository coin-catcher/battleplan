import {
  isSubstantiveAgentResponse,
  isTerminalAgentRunStatus,
  isWorkflowTerminalAgentReply,
  type AgentRunTextSource,
} from './agent-run-response';
import type { ChatMessage } from './models';

export function normalizeAgentRunStatus(status?: string): string {
  return (status ?? '').trim().toUpperCase();
}

/**
 * Whether this agent turn is complete enough to leave DOING (advance workflow).
 *
 * Policy (recommended permanent approach):
 * 1. **FINISHED run** from the agent backend + substantive transcript/result → complete (no length heuristics).
 * 2. **Other terminal run** (ERROR, etc.) + substantive content → complete (user can recover in REVIEW).
 * 3. **Non-terminal run** → fall back to transcript heuristics (ignore short in-flight acks).
 */
export function agentTurnMayCompleteWorkflow(
  content: string,
  run?: AgentRunTextSource,
): boolean {
  const status = normalizeAgentRunStatus(run?.status);
  const normalizedRun = run ? { ...run, status } : undefined;

  if (status === 'FINISHED') {
    return isSubstantiveAgentResponse(content, normalizedRun);
  }
  if (isTerminalAgentRunStatus(status)) {
    return isSubstantiveAgentResponse(content, normalizedRun);
  }
  return isWorkflowTerminalAgentReply(content, normalizedRun);
}

export function taskTurnAwaitingCompletion(
  messages: ChatMessage[],
  taskId: string,
  latestRunId: string | undefined,
  latestRun?: AgentRunTextSource,
): boolean {
  if (!latestRunId) return false;
  const scoped = messages.filter((message) => message.scope === 'task' && message.task_id === taskId);
  const userSent = scoped.some((message) => message.role === 'user' && message.run_id === latestRunId);
  if (!userSent) return false;
  const assistant = scoped.find((message) => message.role === 'assistant' && message.run_id === latestRunId);
  if (!assistant) return true;
  return !agentTurnMayCompleteWorkflow(assistant.content, latestRun);
}