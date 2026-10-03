import { describe, expect, it } from 'vitest';
import { projectEditorDirty, taskEditorDirty } from './editor-dirty';
import type { Project, ProjectTask } from './models';

const baseProject = (): Project => ({
  project_id: 'p1',
  title: 'Alpha',
  initial_prompt: 'Plan',
  cursor_chat_link: 'https://cursor.com',
  repo_url: 'https://github.com/org/repo',
  starting_ref: 'main',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

const baseTask = (): ProjectTask => ({
  task_id: 't1',
  project_id: 'p1',
  title: 'Task',
  prompt: 'Do work',
  output_type: 'code',
  status: 'TODO',
  dependencies: ['t0'],
  order: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

describe('projectEditorDirty', () => {
  it('is false when the form matches the project', () => {
    const project = baseProject();
    expect(projectEditorDirty({
      title: 'Alpha',
      repo_url: 'https://github.com/org/repo',
      starting_ref: 'main',
    }, project)).toBe(false);
  });

  it('detects title and branch changes', () => {
    const project = baseProject();
    expect(projectEditorDirty({
      title: 'Beta',
      repo_url: 'https://github.com/org/repo',
      starting_ref: 'main',
    }, project)).toBe(true);
    expect(projectEditorDirty({
      title: 'Alpha',
      repo_url: 'https://github.com/org/repo',
      starting_ref: 'develop',
    }, project)).toBe(true);
  });
});

describe('taskEditorDirty', () => {
  it('detects prompt and dependency changes', () => {
    const task = baseTask();
    expect(taskEditorDirty({
      title: 'Task',
      prompt: 'Do work',
      output_type: 'code',
      dependencies: ['t0'],
    }, task)).toBe(false);
    expect(taskEditorDirty({
      title: 'Task',
      prompt: 'Updated',
      output_type: 'code',
      dependencies: ['t0'],
    }, task)).toBe(true);
    expect(taskEditorDirty({
      title: 'Task',
      prompt: 'Do work',
      output_type: 'code',
      dependencies: [],
    }, task)).toBe(true);
  });
});
