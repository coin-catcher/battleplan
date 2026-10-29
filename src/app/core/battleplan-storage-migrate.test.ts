import { describe, expect, it } from 'vitest';
import { migrateProjectStorageToV2 } from './battleplan-storage-migrate';
import type { Project, ProjectTask } from './models';

function task(partial: Partial<ProjectTask> = {}): ProjectTask {
  return {
    task_id: 't1',
    project_id: 'p1',
    title: 'T',
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

describe('migrateProjectStorageToV2', () => {
  it('rewrites legacy research paths and bumps project version', () => {
    const project: Project = {
      project_id: 'p1',
      title: 'P',
      initial_prompt: '',
      cursor_chat_link: '',
      created_at: '',
      updated_at: '',
    };
    const tasks = [
      task({ repo_path: 'research/p1/t1/' }),
      task({ task_id: 't2', repo_path: 'battleplan/projects/p1/tasks/t2/outputs/' }),
    ];
    const result = migrateProjectStorageToV2(project, tasks);
    expect(result.project.battleplan_storage_version).toBe(3);
    expect(result.migratedTasks).toBe(1);
    expect(result.tasks[0].repo_path).toBe('battleplan/projects/p1/tasks/t1/outputs/');
    expect(result.tasks[1].repo_path).toContain('battleplan/projects');
  });

  it('is idempotent when already on current storage version', () => {
    const project: Project = {
      project_id: 'p1',
      title: 'P',
      initial_prompt: '',
      cursor_chat_link: '',
      battleplan_storage_version: 3,
      created_at: '',
      updated_at: '',
    };
    const result = migrateProjectStorageToV2(project, [task()]);
    expect(result.migratedTasks).toBe(0);
  });
});
