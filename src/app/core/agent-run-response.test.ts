import { describe, expect, it } from 'vitest';
import {
  AGENT_RESPONSE_PLACEHOLDER,
  agentDeclaresNoHumanReviewNeeded,
  buildOrchestrationReExecuteMessage,
  isSubstantiveAgentResponse,
  isTerminalAgentRunStatus,
  isWorkflowTerminalAgentReply,
  NO_HUMAN_REVIEW_NEEDED_SENTINEL,
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

describe('buildOrchestrationReExecuteMessage', () => {
  it('continues existing chat and includes upstream context without resetting objectives', () => {
    const message = buildOrchestrationReExecuteMessage({
      inputDocuments: 'INPUT DOCUMENTS',
      upstreamHandoff: 'handoff block',
      crossGraphRationale: 'Partition B moved goalposts',
    });
    expect(message).toContain('existing conversation');
    expect(message).toContain('INPUT DOCUMENTS');
    expect(message).toContain('Partition B moved goalposts');
    expect(message).toContain(NO_HUMAN_REVIEW_NEEDED_SENTINEL);
  });
});

describe('agentDeclaresNoHumanReviewNeeded', () => {
  it('detects the sentinel token in assistant text', () => {
    expect(agentDeclaresNoHumanReviewNeeded(`Summary.\n${NO_HUMAN_REVIEW_NEEDED_SENTINEL}`)).toBe(true);
    expect(agentDeclaresNoHumanReviewNeeded('Needs your input on scope.')).toBe(false);
  });
});

describe('isTerminalAgentRunStatus', () => {
  it('treats FINISHED and ERROR as terminal', () => {
    expect(isTerminalAgentRunStatus('FINISHED')).toBe(true);
    expect(isTerminalAgentRunStatus('RUNNING')).toBe(false);
  });
});

describe('isWorkflowTerminalAgentReply', () => {
  it('rejects short working acknowledgments while run is in progress', () => {
    expect(isWorkflowTerminalAgentReply('Working on that now.', { status: 'RUNNING' })).toBe(false);
    expect(isWorkflowTerminalAgentReply('Got it.', { status: 'RUNNING' })).toBe(false);
  });

  it('accepts substantive completion text or git branches while run is in progress', () => {
    expect(isWorkflowTerminalAgentReply(
      'Here is the completed implementation with tests and documentation that covers the requested feature end to end.',
      { status: 'RUNNING' },
    )).toBe(true);
    expect(isWorkflowTerminalAgentReply('Done', { git: { branches: [{ branch: 'feat/x' }] } })).toBe(true);
  });

  it('accepts any substantive reply when the run is terminal', () => {
    expect(isWorkflowTerminalAgentReply('Fixed the bug.', { status: 'FINISHED', result: 'Fixed the bug.' })).toBe(true);
    expect(isWorkflowTerminalAgentReply('Short fix.', { status: 'FINISHED' })).toBe(true);
  });
});
