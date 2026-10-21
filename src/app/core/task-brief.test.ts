import { describe, expect, it } from 'vitest';
import {
  assertTaskBriefReadyForRelease,
  emptyTaskBrief,
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

  it('ignores release check when brief is undefined', () => {
    expect(() => assertTaskBriefReadyForRelease(undefined)).not.toThrow();
  });

  it('normalizes partial brief objects', () => {
    const brief = normalizeTaskBrief({ goal: 'x', scope: 'y' });
    expect(brief?.goal).toBe('x');
    expect(brief?.scope).toBe('y');
  });
});
