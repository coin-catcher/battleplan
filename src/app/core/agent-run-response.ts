/** Shown when a run is terminal but Cursor did not return inline result text yet. */
export const AGENT_RESPONSE_PLACEHOLDER =
  'The agent finished. Attached files are shown with this conversation.';

/** Agent includes this exact token when grilling is unnecessary (Battleplan may auto-approve). */
export const NO_HUMAN_REVIEW_NEEDED_SENTINEL = 'NO_HUMAN_REVIEW_NEEDED';

/** Appended to new task agent instructions (Cursor launch). */
export const NO_HUMAN_REVIEW_GRILLING_INSTRUCTION = [
  'For any grilling questions that are part of the response, explain the decision that is being requested',
  'along with the likely options that should be selected for those decisions.',
  'If you have high confidence that the likely options for each decision are the correct choices,',
  `then respond with ${NO_HUMAN_REVIEW_NEEDED_SENTINEL} (exact token) on its own line at the end of your message.`,
].join(' ');

export function agentDeclaresNoHumanReviewNeeded(content: string): boolean {
  return content.includes(NO_HUMAN_REVIEW_NEEDED_SENTINEL);
}

/** User message for orchestration re-execute (continues existing agent chat). */
export function buildOrchestrationReExecuteMessage(parts: {
  inputDocuments?: string;
  upstreamHandoff?: string;
  crossGraphRationale?: string;
  objectivesReminder?: string;
}): string {
  const blocks = [
    'Task graph orchestration has re-queued this task.',
    'Continue in this existing conversation — keep prior chat history and decisions; do not restart as a new agent.',
    'Re-evaluate your objectives and implementation plan using the updated upstream inputs and cross-task context below.',
    NO_HUMAN_REVIEW_GRILLING_INSTRUCTION,
  ];
  if (parts.inputDocuments?.trim()) blocks.push(parts.inputDocuments.trim());
  if (parts.upstreamHandoff?.trim()) blocks.push(parts.upstreamHandoff.trim());
  if (parts.crossGraphRationale?.trim()) {
    blocks.push(`Cross-task graph context:\n${parts.crossGraphRationale.trim()}`);
  }
  if (parts.objectivesReminder?.trim()) {
    blocks.push(`Original objectives (for reference):\n${parts.objectivesReminder.trim()}`);
  }
  return blocks.join('\n\n');
}

export interface AgentRunTextSource {
  result?: string;
  status?: string;
  git?: { branches?: unknown[] };
}

function looksLikeInterimAcknowledgment(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed.length > 240) return false;
  const lower = trimmed.toLowerCase();
  const patterns = [
    /^i'?ll\b/,
    /^i will\b/,
    /^working on\b/,
    /^got it\.?$/,
    /^on it\.?$/,
    /^acknowledged\.?$/,
    /^starting\b/,
    /^let me\b/,
    /^sure[,!.]?\s/,
    /^thanks[,!.]?\s/,
  ];
  return patterns.some((pattern) => pattern.test(lower));
}

/** True when the assistant message (or run result) is a real agent reply, not a sync stub. */
export function isSubstantiveAgentResponse(
  content: string,
  run?: AgentRunTextSource,
): boolean {
  if (run?.result?.trim()) return true;
  const text = content.trim();
  if (!text) return false;
  if (text === AGENT_RESPONSE_PLACEHOLDER) return false;
  if (text.startsWith('The agent run ended (')) return false;
  return true;
}

/**
 * True when an agent run should drive workflow transitions (DOING → REVIEW/DONE),
 * as opposed to interim acks or reasoning traces that can still be shown in chat.
 */
export function isWorkflowTerminalAgentReply(content: string, run?: AgentRunTextSource): boolean {
  if (!isSubstantiveAgentResponse(content, run)) return false;
  const branches = run?.git?.branches;
  if (Array.isArray(branches) && branches.length > 0) return true;
  const result = run?.result?.trim() ?? '';
  const body = (result || content).trim();
  if (looksLikeInterimAcknowledgment(body)) return false;
  if (run?.status === 'FINISHED' && result && !looksLikeInterimAcknowledgment(result)) return true;
  if (body.length >= 160) return true;
  return body.length >= 40 && !looksLikeInterimAcknowledgment(body);
}
