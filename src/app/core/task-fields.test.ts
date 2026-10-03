import { describe, expect, it } from 'vitest';
import { defaultDarForOutputType, RESEARCH_TASK_DAR_DEFAULT, taskDar } from './task-fields';
import type { ProjectTask } from './models';

describe('task fields', () => {
  it('defaults research DAR and leaves code/subproject empty', () => {
    expect(defaultDarForOutputType('research')).toBe(RESEARCH_TASK_DAR_DEFAULT);
    expect(defaultDarForOutputType('code')).toBe('');
    expect(defaultDarForOutputType('subproject')).toBe('');
  });

  it('reads DAR from dar or legacy prompt', () => {
    const task = {
      task_id: 't1',
      project_id: 'p1',
      title: 'Task',
      prompt: 'legacy',
      dar: 'explicit',
    } as ProjectTask;
    expect(taskDar(task)).toBe('explicit');
  });
});
