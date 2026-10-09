import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { AgentUsageLedger, ChatArtifact, ChatMessage, Project, ProjectAgent, ProjectTask } from '../core/models';
import { IdbRepository } from './idb-repository';

function project(id: string): Project {
  return {
    project_id: id,
    title: id,
    initial_prompt: 'prompt',
    cursor_chat_link: 'https://cursor.com/agents/a',
    created_at: '2026-10-02T00:00:00.000Z',
    updated_at: '2026-10-02T00:00:00.000Z',
  };
}

function task(id: string, projectId: string): ProjectTask {
  return {
    task_id: id,
    project_id: projectId,
    title: id,
    prompt: 'do the work',
    dependencies: [],
    status: 'TODO',
    output_type: 'code',
    order: 0,
    created_at: '2026-10-02T00:00:00.000Z',
    updated_at: '2026-10-02T00:00:00.000Z',
  };
}

describe('IdbRepository', () => {
  it('stores projects, tasks, messages, and artifacts, then cascades a project delete', async () => {
    const repo = new IdbRepository();
    await repo.saveProject(project('p1'));
    await repo.saveTask(task('t1', 'p1'));
    const message: ChatMessage = {
      message_id: 'm1',
      scope: 'project',
      project_id: 'p1',
      role: 'user',
      content: 'hello',
      created_at: '2026-10-02T00:00:01.000Z',
    };
    await repo.saveMessage(message);
    const artifact: ChatArtifact = {
      scope: 'project',
      project_id: 'p1',
      path: 'artifacts/plan.md',
      name: 'plan.md',
      size_bytes: 12,
      updated_at: '2026-10-02T00:00:02.000Z',
      content_type: 'text',
      text: '# Plan',
    };
    await repo.saveArtifact(artifact);

    expect((await repo.listProjects()).map((item) => item.project_id)).toEqual(['p1']);
    expect((await repo.listTasks('p1')).map((item) => item.task_id)).toEqual(['t1']);
    expect(await repo.listProjectMessages('p1')).toHaveLength(1);
    expect((await repo.listArtifacts('project', 'p1'))[0]?.text).toBe('# Plan');

    await repo.deleteProject('p1');
    expect(await repo.listProjects()).toEqual([]);
    expect(await repo.listTasks('p1')).toEqual([]);
    expect(await repo.listProjectMessages('p1')).toEqual([]);
    expect(await repo.listArtifacts('project', 'p1')).toEqual([]);
  });

  it('round-trips project agents and usage ledger', async () => {
    const repo = new IdbRepository();
    await repo.saveProject(project('p1'));
    expect(await repo.listProjectAgents('p1')).toEqual([]);

    const agents: ProjectAgent[] = [
      {
        agent_id: 'a1',
        kind: 'code',
        type: 'Cursor Agent',
        name: 'Cursor Code Agent',
        url: 'https://api.cursor.com/v1',
        created_at: '2026-10-09T00:00:00.000Z',
        updated_at: '2026-10-09T00:00:00.000Z',
      },
    ];
    const ledger: Record<string, AgentUsageLedger> = { a1: { requests_today: 2 } };
    await repo.saveProjectAgents('p1', agents);
    await repo.saveAgentUsageLedger('p1', ledger);
    await repo.saveProject({ ...project('p1'), title: 'Renamed' });

    expect(await repo.listProjectAgents('p1')).toEqual(agents);
    expect(await repo.getAgentUsageLedger('p1')).toEqual(ledger);
  });
});
