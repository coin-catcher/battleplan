import { describe, expect, it } from 'vitest';
import type { ProjectTask } from './models';
import { parseGeneratedTasksPayload } from './parse-tasks';
import { buildGraphEdgesFromDrafts, parseGeneratedEdgeDraft } from './generate-task-graph';
import { validateTaskGraphEdges } from './task-graph';

const task = (partial: Partial<ProjectTask> & Pick<ProjectTask, 'task_id' | 'title'>): ProjectTask => ({
  project_id: 'p1',
  prompt: '',
  dependencies: [],
  status: 'TODO',
  output_type: 'code',
  order: 0,
  created_at: '',
  updated_at: '',
  ...partial,
});

describe('generate-task-graph', () => {
  it('maps fan-in and loop aliases', () => {
    expect(parseGeneratedEdgeDraft({ from: 'A', to: 'B', kind: 'fan-in' }, 0).kind).toBe('join');
    const loop = parseGeneratedEdgeDraft({ from: 'A', to: 'B', kind: 'loop' }, 0);
    expect(loop.kind).toBe('cycle');
    expect(loop.break_condition).toBeTruthy();
  });

  it('parses tasks + edges payload', () => {
    const payload = parseGeneratedTasksPayload(JSON.stringify({
      tasks: [{
        title: 'Implement',
        prompt: 'Build it',
        task_kind: 'code',
        depends_on: [],
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
      }],
      edges: [{ from: 'Gate', to: 'Implement', kind: 'join' }],
    }));
    expect(payload.tasks).toHaveLength(1);
    expect(payload.tasks[0]?.output_type).toBe('code');
    expect(payload.edges[0]?.kind).toBe('join');
  });

  it('validates cycle edges with break_condition from drafts', () => {
    const a = task({ task_id: 'a', title: 'Code' });
    const b = task({ task_id: 'b', title: 'Critique' });
    const edges = buildGraphEdgesFromDrafts([], [a, b], [
      { from: 'Critique', to: 'Code', kind: 'cycle', break_condition: 'human:REVIEW' },
    ]);
    const ids = new Set(['a', 'b']);
    expect(() => validateTaskGraphEdges(edges, ids)).not.toThrow();
  });
});
