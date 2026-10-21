import { describe, expect, it } from 'vitest';
import { parseGeneratedTaskList } from './parse-tasks';

describe('parse-tasks graph-of-agents fields', () => {
  it('parses brief and node metadata from JSON', () => {
    const json = JSON.stringify([{
      title: 'Grill feature',
      prompt: 'Interview user',
      output_type: 'research',
      depends_on: [],
      node_kind: 'decision',
      loop_mode: 'HITL',
      connector_kind: 'hermes',
      brief: {
        goal: 'g',
        scope: 's',
        context: 'c',
        acceptance: 'a',
        verify: 'v',
        timebox: 't',
        forbidden: 'f',
        report: 'r',
        standing: 'st',
      },
    }]);
    const tasks = parseGeneratedTaskList(json);
    expect(tasks[0]?.node_kind).toBe('decision');
    expect(tasks[0]?.loop_mode).toBe('HITL');
    expect(tasks[0]?.connector_kind).toBe('hermes');
    expect(tasks[0]?.brief?.goal).toBe('g');
  });
});
