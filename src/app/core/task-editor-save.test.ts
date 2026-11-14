import { describe, expect, it } from 'vitest';
import type { ProjectTask } from './models';
import { buildTaskEditorSavePatch } from './task-editor-save';

const baseTask = (): ProjectTask => ({
  task_id: 't1',
  project_id: 'p1',
  title: 'Task',
  prompt: '',
  dependencies: [],
  status: 'TODO',
  output_type: 'research',
  order: 0,
  created_at: '',
  updated_at: '',
  initial_prompt: 'Start',
  cursor_agent_id: 'agent-1',
});

describe('buildTaskEditorSavePatch', () => {
  it('omits initial_prompt when the Cursor agent has started', () => {
    const patch = buildTaskEditorSavePatch(baseTask(), {
      title: 'Task',
      initial_prompt: 'Changed',
      editor_kind: 'code',
      dependencies: [],
      sibling_dependencies: [],
      research_agent_id: '',
      code_agent_id: '',
      repo_path: 'battleplan/projects/p1/tasks/t1/outputs/',
      brief: {
        goal: 'g', scope: 's', context: 'c', acceptance: 'a', verify: 'v',
        timebox: 't', forbidden: 'f', report: 'r', standing: 'st',
      },
    });
    expect(patch.output_type).toBe('code');
    expect(patch.initial_prompt).toBeUndefined();
  });

  it('includes initial_prompt before the agent starts', () => {
    const task = { ...baseTask(), cursor_agent_id: undefined };
    const patch = buildTaskEditorSavePatch(task, {
      title: 'Task',
      initial_prompt: 'Go',
      editor_kind: 'research',
      dependencies: [],
      sibling_dependencies: [],
      research_agent_id: '',
      code_agent_id: '',
      repo_path: '',
      brief: {
        goal: 'g', scope: 's', context: 'c', acceptance: 'a', verify: 'v',
        timebox: 't', forbidden: 'f', report: 'r', standing: 'st',
      },
    });
    expect(patch.initial_prompt).toBe('Go');
  });
});