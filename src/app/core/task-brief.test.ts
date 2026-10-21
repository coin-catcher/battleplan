import { describe, expect, it } from 'vitest';
import {
  assertTaskBriefReadyForRelease,
  buildDefaultTaskBrief,
  emptyTaskBrief,
  inheritedTaskPromptContext,
  mergeTaskBriefWithDefaults,
  normalizeTaskBrief,
  validateTaskBrief,
} from './task-brief';
import type { ProjectTask } from './models';

describe('task-brief', () => {
  it('requires all fields when a brief is present', () => {
    const brief = emptyTaskBrief();
    brief.goal = 'Ship connectors';
    expect(validateTaskBrief(brief).length).toBeGreaterThan(0);
    expect(() => assertTaskBriefReadyForRelease(brief)).toThrow(/incomplete/i);
  });

  it('accepts a complete brief', () => {
    const brief = emptyTaskBrief();
    for (const field of Object.keys(brief) as (keyof typeof brief)[]) {
      brief[field] = field;
    }
    expect(validateTaskBrief(brief)).toEqual([]);
    expect(() => assertTaskBriefReadyForRelease(brief)).not.toThrow();
  });

  it('requires a brief on release', () => {
    expect(() => assertTaskBriefReadyForRelease(undefined)).toThrow(/required/i);
  });

  it('builds default brief with all fields populated', () => {
    const brief = buildDefaultTaskBrief({
      title: 'Add connectors',
      initialPrompt: 'Implement Hermes connector spike',
      dar: 'Use idempotency keys.',
      outputType: 'code',
    });
    expect(validateTaskBrief(brief)).toEqual([]);
    expect(brief.goal).toContain('Hermes');
  });

  it('normalizes partial brief objects', () => {
    const brief = normalizeTaskBrief({ goal: 'x', scope: 'y' });
    expect(brief?.goal).toBe('x');
    expect(brief?.scope).toBe('y');
  });

  it('combines brief context and forbidden for inherited prompts', () => {
    const task = {
      task_id: 't1',
      project_id: 'p1',
      title: 'T',
      prompt: '',
      output_type: 'code',
      status: 'TODO',
      dependencies: [],
      order: 0,
      created_at: '',
      updated_at: '',
      brief: { ...emptyTaskBrief(), context: 'Parent context', forbidden: 'No PRs' },
    } satisfies ProjectTask;
    expect(inheritedTaskPromptContext(task)).toContain('Parent context');
    expect(inheritedTaskPromptContext(task)).toContain('Forbidden');
    expect(inheritedTaskPromptContext({ ...task, brief: undefined, dar: 'Legacy rules' })).toBe('Legacy rules');
  });

  it('merge preserves edited fields', () => {
    const defaults = buildDefaultTaskBrief({
      title: 'T',
      initialPrompt: 'p',
      dar: '',
      outputType: 'research',
    });
    const merged = mergeTaskBriefWithDefaults({ ...emptyTaskBrief(), goal: 'custom' }, defaults);
    expect(merged.goal).toBe('custom');
    expect(merged.scope).toBe(defaults.scope);
  });
});
