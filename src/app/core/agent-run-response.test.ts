import { describe, expect, it } from 'vitest';
import { AGENT_RESPONSE_PLACEHOLDER, isSubstantiveAgentResponse } from './agent-run-response';

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
