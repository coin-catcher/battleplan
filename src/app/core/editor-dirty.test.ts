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
  dar: 'Rules',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

const baseTask = (): ProjectTask => ({
  task_id: 't1',
  project_id: 'p1',
  title: 'Task',
  prompt: 'Legacy',
  dar: 'Rules',
  initial_prompt: 'Go',
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
      github_pat: '',
      dar: 'Rules',
    }, project)).toBe(false);
  });

  it('detects title, branch, dar, and initial prompt changes', () => {
    const project = baseProject();
    expect(projectEditorDirty({
      title: 'Beta',
      repo_url: 'https://github.com/org/repo',
      starting_ref: 'main',
      github_pat: '',
      dar: 'Rules',
    }, project)).toBe(true);
    expect(projectEditorDirty({
      title: 'Alpha',
      repo_url: 'https://github.com/org/repo',
      starting_ref: 'develop',
      github_pat: '',
      dar: 'Rules',
    }, project)).toBe(true);
    expect(projectEditorDirty({
      title: 'Alpha',
      repo_url: 'https://github.com/org/repo',
      starting_ref: 'main',
      github_pat: '',
      dar: 'New rules',
    }, project)).toBe(true);
    expect(projectEditorDirty({
      title: 'Alpha',
      repo_url: 'https://github.com/org/repo',
      starting_ref: 'main',
      github_pat: '',
      dar: 'Rules',
      initial_prompt: 'Updated',
    }, project)).toBe(true);
  });
});

describe('taskEditorDirty', () => {
  it('detects dar, initial prompt, and dependency changes', () => {
    const task = baseTask();
    expect(taskEditorDirty({
      title: 'Task',
      dar: 'Rules',
      initial_prompt: 'Go',
      output_type: 'code',
      dependencies: ['t0'],
      sibling_dependencies: [],
    }, task)).toBe(false);
    expect(taskEditorDirty({
      title: 'Task',
      dar: 'Updated',
      initial_prompt: 'Go',
      output_type: 'code',
      dependencies: ['t0'],
      sibling_dependencies: [],
    }, task)).toBe(true);
    expect(taskEditorDirty({
      title: 'Task',
      dar: 'Rules',
      initial_prompt: 'Updated',
      output_type: 'code',
      dependencies: ['t0'],
      sibling_dependencies: [],
    }, task)).toBe(true);
    expect(taskEditorDirty({
      title: 'Task',
      dar: 'Rules',
      initial_prompt: 'Go',
      output_type: 'code',
      dependencies: [],
      sibling_dependencies: [],
    }, task)).toBe(true);
  });

  it('ignores initial prompt after the agent has started', () => {
    const task = { ...baseTask(), cursor_agent_id: 'agent-1' };
    expect(taskEditorDirty({
      title: 'Task',
      dar: 'Rules',
      initial_prompt: 'Changed',
      output_type: 'code',
      dependencies: ['t0'],
      sibling_dependencies: [],
    }, task)).toBe(false);
  });
});
