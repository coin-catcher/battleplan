import { describe, expect, it } from 'vitest';
import {
  assertTaskBriefReadyForRelease,
  buildDefaultTaskBrief,
  emptyTaskBrief,
  mergeTaskBriefWithDefaults,
  normalizeTaskBrief,
  validateTaskBrief,
} from './task-brief';

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
