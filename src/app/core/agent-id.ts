const DRAFT_PREFIX = 'draft-';

export function isAgentDraftId(agentId: string): boolean {
  return agentId.startsWith(DRAFT_PREFIX);
}

export function newDraftAgentId(): string {
  return `${DRAFT_PREFIX}${crypto.randomUUID()}`;
}
