import { describe, expect, it } from 'vitest';
import type { ProjectTask } from './models';
import { validateAndRepairGeneratedTasks } from './validate-generated-tasks';
import { validateTaskGraphEdges } from './task-graph';

const parent = (): ProjectTask => ({
  task_id: 'research-1',
  project_id: 'p1',
  title: 'Research parent',
  prompt: '',
  dependencies: [],
  status: 'TODO',
  output_type: 'research',
  order: 0,
  created_at: '',
  updated_at: '',
});

describe('validate-generated-tasks', () => {
  it('auto-fills break_condition on cycle edges before graph validation', () => {
    const result = validateAndRepairGeneratedTasks({
      tasks: [
        { title: 'A', prompt: 'Do A', output_type: 'code', depends_on: [] },
        { title: 'B', prompt: 'Do B', output_type: 'code', depends_on: [] },
      ],
      edges: [{ from: 'B', to: 'A', kind: 'cycle' }],
    }, { existingTasks: [parent()], parentTaskId: 'research-1' });
    expect(result.valid).toBe(true);
    expect(result.repaired).toBe(true);
    expect(result.payload.edges[0]?.break_condition).toBe('human:REVIEW');
  });

  it('accepts a fork/ordering graph with an explicit cycle break (supabase-style plan)', () => {
    const tasks = [
      { title: 'Architect keypair auth and storage contracts', prompt: 'Doc', output_type: 'research', depends_on: [] as string[] },
      { title: 'Implement keypair auth Supabase edge functions', prompt: 'Code', output_type: 'code', depends_on: ['Architect keypair auth and storage contracts'] },
      { title: 'Replace AuthService with keypair Supabase session flow', prompt: 'Code', output_type: 'code', depends_on: ['Architect keypair auth and storage contracts'] },
      { title: 'Critique Supabase switch deliverables', prompt: 'Review', output_type: 'research', depends_on: [] as string[] },
    ];
    const edges = [
      { from: 'Architect keypair auth and storage contracts', to: 'Implement keypair auth Supabase edge functions', kind: 'fork' as const },
      { from: 'Implement keypair auth Supabase edge functions', to: 'Replace AuthService with keypair Supabase session flow', kind: 'ordering' as const },
      {
        from: 'Critique Supabase switch deliverables',
        to: 'Replace AuthService with keypair Supabase session flow',
        kind: 'cycle' as const,
        break_condition: 'human:REVIEW',
      },
    ];
    const result = validateAndRepairGeneratedTasks(
      { tasks, edges },
      { existingTasks: [parent()], parentTaskId: 'research-1' },
    );
    expect(result.valid).toBe(true);
  });
});

describe('task-graph cycle rules', () => {
  it('rejects ordering-only cycles without requiring break on every edge', () => {
    const ids = new Set(['a', 'b']);
    expect(() => validateTaskGraphEdges([
      { edge_id: '1', from_task_id: 'a', to_task_id: 'b', kind: 'ordering' },
      { edge_id: '2', from_task_id: 'b', to_task_id: 'a', kind: 'ordering' },
    ], ids)).toThrow(/Accidental dependency cycle/i);
  });
});
