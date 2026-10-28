/** Shown when a run is terminal but Cursor did not return inline result text yet. */
export const AGENT_RESPONSE_PLACEHOLDER =
  'The agent finished. Attached files are shown with this conversation.';

export interface AgentRunTextSource {
  result?: string;
  status?: string;
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
