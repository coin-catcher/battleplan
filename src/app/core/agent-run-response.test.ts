import { describe, expect, it } from 'vitest';
import {
  AGENT_RESPONSE_PLACEHOLDER,
  isSubstantiveAgentResponse,
  isWorkflowTerminalAgentReply,
} from './agent-run-response';

describe('isSubstantiveAgentResponse', () => {
  it('rejects placeholder and error stubs', () => {
    expect(isSubstantiveAgentResponse(AGENT_RESPONSE_PLACEHOLDER)).toBe(false);
    expect(isSubstantiveAgentResponse('The agent run ended (ERROR).')).toBe(false);
  });

  it('accepts run result or non-empty assistant text', () => {
    expect(isSubstantiveAgentResponse('', { result: 'Done.' })).toBe(true);
    expect(isSubstantiveAgentResponse('Here is the summary.')).toBe(true);
  });
});

describe('isWorkflowTerminalAgentReply', () => {
  it('rejects short working acknowledgments', () => {
    expect(isWorkflowTerminalAgentReply('Working on that now.')).toBe(false);
    expect(isWorkflowTerminalAgentReply('Got it.')).toBe(false);
  });

  it('accepts substantive completion text or git branches', () => {
    expect(isWorkflowTerminalAgentReply('Here is the completed implementation with tests and documentation that covers the requested feature end to end.')).toBe(true);
    expect(isWorkflowTerminalAgentReply('Done', { git: { branches: [{ branch: 'feat/x' }] } })).toBe(true);
  });
});
