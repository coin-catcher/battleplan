import { describe, expect, it } from 'vitest';
import type { ChatMessage } from './models';
import {
  agentTurnMayCompleteWorkflow,
  normalizeAgentRunStatus,
  taskTurnAwaitingCompletion,
} from './agent-run-completion';
import { AGENT_RESPONSE_PLACEHOLDER } from './agent-run-response';

describe('normalizeAgentRunStatus', () => {
  it('uppercases provider statuses', () => {
    expect(normalizeAgentRunStatus('finished')).toBe('FINISHED');
    expect(normalizeAgentRunStatus(' running ')).toBe('RUNNING');
  });
});

describe('agentTurnMayCompleteWorkflow', () => {
  it('completes on FINISHED run with substantive result even when chat body is short', () => {
    expect(agentTurnMayCompleteWorkflow('Short summary.', {
      status: 'finished',
      result: 'Short summary.',
    })).toBe(true);
  });

  it('does not complete FINISHED run while only placeholder text is synced', () => {
    expect(agentTurnMayCompleteWorkflow(AGENT_RESPONSE_PLACEHOLDER, { status: 'FINISHED' })).toBe(false);
  });

  it('uses heuristics while run is still RUNNING', () => {
    expect(agentTurnMayCompleteWorkflow('Got it.', { status: 'RUNNING' })).toBe(false);
    expect(agentTurnMayCompleteWorkflow(
      'Here is a longer completed answer that should count as done even before the API marks the run finished.',
      { status: 'RUNNING' },
    )).toBe(true);
  });
});

describe('taskTurnAwaitingCompletion', () => {
  const user: ChatMessage = {
    message_id: 'u1',
    scope: 'task',
    project_id: 'p1',
    task_id: 't1',
    role: 'user',
    content: 'go',
    run_id: 'r1',
    created_at: '',
  };

  it('awaits when assistant missing', () => {
    expect(taskTurnAwaitingCompletion([user], 't1', 'r1')).toBe(true);
  });

  it('stops awaiting when FINISHED run matches substantive assistant', () => {
    const assistant: ChatMessage = {
      message_id: 'a1',
      scope: 'task',
      project_id: 'p1',
      task_id: 't1',
      role: 'assistant',
      content: 'Done.',
      run_id: 'r1',
      created_at: '',
    };
    expect(taskTurnAwaitingCompletion(
      [user, assistant],
      't1',
      'r1',
      { status: 'FINISHED', result: 'Done.' },
    )).toBe(false);
  });
});