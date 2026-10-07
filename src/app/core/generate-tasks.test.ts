import { describe, expect, it } from 'vitest';
import {
  anchorDraftsUnderParentTask,
  generateTasksInstructionForResearchTask,
  generateTasksInstructionForProject,
} from './generate-tasks';

describe('generateTasksInstructionForResearchTask', () => {
  it('asks for a flat list of code tasks with empty depends_on by default', () => {
    const text = generateTasksInstructionForResearchTask('Catalog research');
    expect(text).toContain('one-dimensional list of code tasks');
    expect(text).toContain('depends_on to []');
    expect(text).toContain('Foundation code task');
    expect(text).toContain('Child research task');
  });
});

describe('generateTasksInstructionForProject', () => {
  it('includes JSON schema rules', () => {
    const text = generateTasksInstructionForProject();
    expect(text).toContain('JSON array');
    expect(text).toContain('depends_on');
  });
});

describe('anchorDraftsUnderParentTask', () => {
  it('fills empty depends_on with the parent research title', () => {
    const drafts = anchorDraftsUnderParentTask([
      { title: 'A', prompt: 'Do A', output_type: 'code', depends_on: [] },
      { title: 'B', prompt: 'Do B', output_type: 'code', depends_on: ['Foundation'] },
    ], 'Research parent');
    expect(drafts[0].depends_on).toEqual(['Research parent']);
    expect(drafts[1].depends_on).toEqual(['Foundation']);
  });
});
