import { describe, expect, it } from 'vitest';
import { emptyTaskBrief } from './task-brief';
import {
  applyCodeTaskDefinitionOfDone,
  CODE_TASK_DEFINITION_OF_DONE,
  codeTaskAgentCompletionPolicy,
  codeTaskDefinitionOfDoneMarkdown,
} from './code-task-dod';

describe('code-task-dod', () => {
  it('lists all mandatory DoD items', () => {
    expect(CODE_TASK_DEFINITION_OF_DONE).toHaveLength(4);
    const md = codeTaskDefinitionOfDoneMarkdown();
    for (const item of CODE_TASK_DEFINITION_OF_DONE) {
      expect(md).toContain(item);
    }
  });

  it('merges DoD into brief without duplicating', () => {
    const brief = applyCodeTaskDefinitionOfDone(emptyTaskBrief());
    expect(brief.acceptance).toMatch(/Definition of done/i);
    expect(brief.verify).toMatch(/coverage/i);
    const again = applyCodeTaskDefinitionOfDone(brief);
    expect(again.acceptance).toBe(brief.acceptance);
  });

  it('includes agent completion policy', () => {
    const policy = codeTaskAgentCompletionPolicy();
    expect(policy).toMatch(/lint/i);
    expect(policy).toMatch(/80%/);
    expect(policy).toMatch(/build:electron/);
  });
});