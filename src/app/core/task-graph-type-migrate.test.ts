import { describe, expect, it } from 'vitest';
import type { Project, ProjectTask } from './models';
import {
  inferGraphTypeFromLegacyTask,
  migrateTaskGraphTypeSchema,
  TASK_GRAPH_TYPE_SCHEMA_VERSION,
} from './task-graph-type-migrate';

function project(): Project {
  return {
    project_id: 'p1',
    title: 'P',
    initial_prompt: '',
    cursor_chat_link: '',
    default_code_agent_id: 'code-agent',
    default_research_agent_id: 'research-agent',
    created_at: '',
    updated_at: '',
  };
}

function task(partial: Partial<ProjectTask> & Pick<ProjectTask, 'task_id' | 'title'>): ProjectTask {
  return {
    project_id: 'p1',
    prompt: '',
    dependencies: [],
    status: 'TODO',
    output_type: 'research',
    order: 0,
    created_at: '',
    updated_at: '',
    ...partial,
  };
}

describe('task-graph-type-migrate', () => {
  it('upgrades depth-first discovery tasks that were saved as research to code', () => {
    const legacy = task({
      task_id: 't1',
      title: 'Create MVP allowlist',
      output_type: 'research',
      graph_id: 'graph-1',
      discovery_task_slug: 'sbf-create-mvp-allowlist',
      pattern_id: undefined,
    });
    expect(inferGraphTypeFromLegacyTask(legacy)).toBe('code');
    const result = migrateTaskGraphTypeSchema(project(), [legacy]);
    expect(result.project.graph_of_agents_version).toBe(TASK_GRAPH_TYPE_SCHEMA_VERSION);
    expect(result.tasks[0]?.output_type).toBe('code');
    expect(result.tasks[0]?.graph_type).toBe('code');
    expect(result.tasks[0]?.code_agent_id).toBe('code-agent');
  });

  it('keeps Layer 1 partition tasks as research subgraph', () => {
    const partition = task({
      task_id: 'p1',
      title: 'Supabase backend foundation',
      discovery_task_slug: 'partition-01-supabase-backend-foundation',
      graph_id: 'graph-partition',
    });
    expect(inferGraphTypeFromLegacyTask(partition)).toBe('research');
    const result = migrateTaskGraphTypeSchema(project(), [partition]);
    expect(result.tasks[0]?.graph_type).toBe('research');
    expect(result.tasks[0]?.research_mode).toBe('subgraph');
    expect(result.tasks[0]?.output_type).toBe('research');
  });

  it('preserves critique node_kind and sets decision_mode', () => {
    const legacy = task({
      task_id: 'c1',
      title: 'Quality gate review',
      output_type: 'research',
      node_kind: 'critique',
      pattern_id: 'spike-gate',
      graph_id: 'g1',
      discovery_task_slug: 'gate-review',
    });
    const result = migrateTaskGraphTypeSchema(project(), [legacy]);
    expect(result.tasks[0]?.graph_type).toBe('critique');
    expect(result.tasks[0]?.node_kind).toBe('critique');
    expect(result.tasks[0]?.decision_mode).toBe('yes_no');
  });

  it('is idempotent after graph_of_agents_version is set', () => {
    const upgraded = migrateTaskGraphTypeSchema(project(), [
      task({ task_id: 't', title: 'Work', output_type: 'code', graph_type: 'code' }),
    ]);
    const again = migrateTaskGraphTypeSchema(upgraded.project, upgraded.tasks);
    expect(again.migratedTasks).toBe(0);
    expect(again.changed).toBe(false);
  });
});
