import { describe, expect, it } from 'vitest';
import {
  expectedDiscoveryBriefPath,
  validateDiscoveryTaskCollateral,
} from './discovery-task-schema';
import type { TaskDraft } from './models';

describe('discovery-task-schema', () => {
  it('computes canonical brief_path from project and id', () => {
    expect(expectedDiscoveryBriefPath('switch-to-supabase', 'sbf-create-mvp-allowlist')).toBe(
      'battleplan/projects/switch-to-supabase/tasks/sbf-create-mvp-allowlist/outputs/brief.md',
    );
  });

  it('accepts brief_path when repo project slug differs from Battleplan project_id', () => {
    const draft: TaskDraft = {
      title: 'Create MVP allowlist',
      prompt: 'Go',
      output_type: 'research',
      depends_on: [],
      discovery_task_slug: 'sbf-create-mvp-allowlist',
      brief_path: 'battleplan/projects/switch-to-supabase/tasks/sbf-create-mvp-allowlist/outputs/brief.md',
      git_paths: ['battleplan/projects/switch-to-supabase/tasks/sbf-create-mvp-allowlist/outputs/brief.md'],
    };
    const issues = validateDiscoveryTaskCollateral('15ddb36c-b9ec-4732-9ac1-6049da532e8a', draft, 0);
    expect(issues).toHaveLength(0);
  });

  it('flags brief_path that does not match id', () => {
    const draft: TaskDraft = {
      title: 'Create MVP allowlist',
      prompt: 'Go',
      output_type: 'research',
      depends_on: [],
      discovery_task_slug: 'sbf-create-mvp-allowlist',
      brief_path: 'battleplan/projects/p/tasks/wrong/outputs/brief.md',
    };
    const issues = validateDiscoveryTaskCollateral('switch-to-supabase', draft, 0);
    expect(issues.some((item) => item.path.includes('brief_path'))).toBe(true);
  });
});
