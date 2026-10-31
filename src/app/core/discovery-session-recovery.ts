import { findLastAssistantTaskGraph } from './generate-task-links';
import type { GenerateTasksSessionState } from './generate-tasks-layered';
import { isGraphCompleteCommand, tryParseGeneratedTasksFromSources } from './generate-tasks-layered';
import { discoveryMessageKey } from './discovery-session-persist';
import { messageContainsImportableTaskGraph } from './parse-tasks';
import type { ChatArtifact, ChatMessage } from './models';

/** Align persisted session flags with chat when JSON arrived but import never ran. */
export function reconcileDiscoverySessionFromChat(
  session: GenerateTasksSessionState,
  messages: ChatMessage[],
  artifacts: ChatArtifact[],
): GenerateTasksSessionState {
  const reply = findLastAssistantImportableMessage(messages, artifacts);
  if (!reply) return session;

  const messageKey = discoveryMessageKey(reply);
  if (session.lastImportedMessageKey === messageKey) return session;

  const sentGraphDone = messages.some((message) => message.role === 'user' && isGraphCompleteCommand(message.content));
  const parsed = tryParseGeneratedTasksFromSources(reply.content, artifacts);
  const taskCount = parsed?.tasks.length ?? 0;
  if (taskCount === 0) return session;

  let next = { ...session };

  if (session.phase === 'depth_first' && sentGraphDone && !session.awaitingGraphJson) {
    next = { ...next, awaitingGraphJson: true };
  }

  if (session.phase === 'partition' && taskCount > 0 && !session.awaitingGraphJson) {
    next = { ...next, awaitingGraphJson: true };
  }

  return next;
}

export function findLastAssistantImportableMessage(
  messages: ChatMessage[],
  artifacts: ChatArtifact[],
): ChatMessage | null {
  return findLastAssistantTaskGraph(messages, artifacts);
}

export function pendingDiscoveryImportMessage(
  session: GenerateTasksSessionState | null,
  messages: ChatMessage[],
  artifacts: ChatArtifact[],
): ChatMessage | null {
  if (!session) return null;
  const reply = findLastAssistantImportableMessage(messages, artifacts);
  if (!reply) return null;
  if (session.lastImportedMessageKey === discoveryMessageKey(reply)) return null;
  return reply;
}

export function canOfferDiscoveryJsonImport(
  session: GenerateTasksSessionState | null,
  messages: ChatMessage[],
  artifacts: ChatArtifact[],
): boolean {
  return pendingDiscoveryImportMessage(session, messages, artifacts) !== null;
}

export function discoveryImportBlockReason(
  session: GenerateTasksSessionState,
  messages: ChatMessage[],
  artifacts: ChatArtifact[],
): string | null {
  const reply = findLastAssistantImportableMessage(messages, artifacts);
  if (!reply) {
    return 'No importable task JSON found in this task’s chat history.';
  }
  if (session.lastImportedMessageKey === discoveryMessageKey(reply)) {
    return 'That assistant reply was already imported.';
  }
  if (!messageContainsImportableTaskGraph(reply.content, artifacts)) {
    return 'The latest assistant reply is not valid task graph JSON.';
  }
  if (session.phase === 'depth_first' && !session.awaitingGraphJson && session.closingStep !== 'architecture') {
    return 'Send GRAPH DONE in chat, or use Force import to apply the partition graph JSON.';
  }
  return null;
}
