import { describe, expect, it } from 'vitest';
import { AGENT_LIBRARY_VERSION, migrateAgentLibrary } from './agent-library-migrate';
import type { Project, ProjectTask } from './models';

function baseProject(): Project {
  return {
    project_id: 'p1',
    title: 'Plan',
    initial_prompt: 'Plan',
    cursor_chat_link: 'https://cursor.com/agents/a1',
    created_at: '2026-10-09T00:00:00.000Z',
    updated_at: '2026-10-09T00:00:00.000Z',
  };
}

function task(overrides: Partial<ProjectTask>): ProjectTask {
  return {
    task_id: 't1',
    project_id: 'p1',
    title: 'Task',
    prompt: '',
    dependencies: [],
    status: 'TODO',
    output_type: 'research',
    order: 0,
    created_at: '2026-10-09T00:00:00.000Z',
    updated_at: '2026-10-09T00:00:00.000Z',
    ...overrides,
  };
}

describe('migrateAgentLibrary', () => {
  it('seeds a Cursor library agent and binds defaults for legacy projects', () => {
    const result = migrateAgentLibrary({
      project: baseProject(),
      agents: [],
      tasks: [
        task({ task_id: 'r1', output_type: 'research' }),
        task({ task_id: 'c1', output_type: 'code' }),
      ],
      now: '2026-10-09T12:00:00.000Z',
      newId: () => 'cursor-lib-1',
    });
    expect(result.changed).toBe(true);
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]?.type).toBe('Cursor Agent');
    expect(result.project.default_research_agent_id).toBe('cursor-lib-1');
    expect(result.project.default_code_agent_id).toBe('cursor-lib-1');
    expect(result.project.agent_library_version).toBe(AGENT_LIBRARY_VERSION);
    expect(result.tasks.find((item) => item.task_id === 'r1')?.research_agent_id).toBe('cursor-lib-1');
    expect(result.tasks.find((item) => item.task_id === 'c1')?.code_agent_id).toBe('cursor-lib-1');
  });

  it('is idempotent after migration version is set', () => {
    const project = {
      ...baseProject(),
      agent_library_version: AGENT_LIBRARY_VERSION,
      default_research_agent_id: 'a1',
      default_code_agent_id: 'a1',
    };
    const result = migrateAgentLibrary({
      project,
      agents: [],
      tasks: [task({})],
      now: '2026-10-09T12:00:00.000Z',
      newId: () => 'new',
    });
    expect(result.changed).toBe(false);
  });
});
