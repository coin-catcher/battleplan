import { describe, expect, it } from 'vitest';
import type { Project, ProjectTask } from './models';
import { collectTaskDarSections } from './dar';

function task(partial: Partial<ProjectTask> & Pick<ProjectTask, 'task_id' | 'title'>): ProjectTask {
  return {
    project_id: 'p-root',
    prompt: partial.title,
    dependencies: [],
    status: 'TODO',
    output_type: 'code',
    order: 0,
    created_at: '2026-10-02T00:00:00.000Z',
    updated_at: '2026-10-02T00:00:00.000Z',
    ...partial,
  };
}

describe('collectTaskDarSections', () => {
  it('orders project, ancestor, and current task DAR from top to bottom', async () => {
    const project: Project = {
      project_id: 'p-root',
      title: 'Root plan',
      initial_prompt: 'Plan',
      dar: 'Root rules',
      cursor_chat_link: 'https://cursor.com/agents/a',
      created_at: '2026-10-02T00:00:00.000Z',
      updated_at: '2026-10-02T00:00:00.000Z',
    };
    const parent = task({ task_id: 't-parent', title: 'Parent', dar: 'Parent rules', prompt: 'Parent rules', order: 0 });
    const current = task({ task_id: 't-child', title: 'Child', dar: 'Child rules', prompt: 'Child rules', order: 1, dependencies: ['t-parent'] });
    const lookup = {
      async getProject() { return project; },
      async getTask(id: string) {
        if (id === 't-parent') return parent;
        if (id === 't-child') return current;
        return null;
      },
      async listTasks() { return [parent, current]; },
    };
    const sections = await collectTaskDarSections(current, lookup);
    expect(sections.join('\n')).toContain('Root plan');
    expect(sections.join('\n')).toContain('Root rules');
    expect(sections.join('\n')).toMatch(/Root plan[\s\S]*Parent[\s\S]*Child/);
  });

  it('stops at a subproject ancestor and does not include the outer project DAR', async () => {
    const root: Project = {
      project_id: 'p-root',
      title: 'Outer',
      initial_prompt: 'Plan',
      dar: 'Outer rules',
      cursor_chat_link: 'https://cursor.com/agents/a',
      created_at: '2026-10-02T00:00:00.000Z',
      updated_at: '2026-10-02T00:00:00.000Z',
    };
    const nested: Project = {
      project_id: 'p-nested',
      title: 'Nested',
      initial_prompt: 'Nested',
      dar: 'Nested rules',
      cursor_chat_link: '',
      parent_project_id: 'p-root',
      parent_task_id: 't-sub',
      created_at: '2026-10-02T00:00:00.000Z',
      updated_at: '2026-10-02T00:00:00.000Z',
    };
    const subproject = task({
      task_id: 't-sub',
      title: 'Subproject task',
      dar: 'Subproject rules',
      prompt: 'Subproject rules',
      output_type: 'subproject',
      subproject_id: 'p-nested',
      order: 0,
    });
    const current = task({
      task_id: 't-work',
      title: 'Work',
      dar: 'Work rules',
      prompt: 'Work rules',
      project_id: 'p-nested',
      order: 0,
    });
    const lookup = {
      async getProject(id: string) {
        if (id === 'p-root') return root;
        if (id === 'p-nested') return nested;
        return null;
      },
      async getTask(id: string) {
        if (id === 't-sub') return subproject;
        if (id === 't-work') return current;
        return null;
      },
      async listTasks(projectId: string) {
        if (projectId === 'p-nested') return [current];
        return [subproject];
      },
    };
    const sections = await collectTaskDarSections(current, lookup);
    const combined = sections.join('\n');
    expect(combined).toContain('Subproject rules');
    expect(combined).toContain('Nested rules');
    expect(combined).toContain('Work rules');
    expect(combined).not.toContain('Outer rules');
  });
});
