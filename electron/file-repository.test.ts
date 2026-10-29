import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentUsageLedger, ChatArtifact, ChatMessage, Project, ProjectAgent, ProjectTask } from '../src/app/core/models';
import { FileRepository } from './file-repository';

const tempDirs: string[] = [];

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

async function makeRepo(): Promise<FileRepository> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'battleplan-'));
  tempDirs.push(dir);
  return new FileRepository(dir);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('FileRepository', () => {
  it('stores projects, tasks, messages, and artifacts, then cascades a project delete', async () => {
    const repo = await makeRepo();
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

  it('round-trips per-project workspace ui in project_config.json', async () => {
    const repo = await makeRepo();
    await repo.saveProject(project('p1'));
    await repo.saveProjectUiState('p1', {
      pane_width: 520,
      mindmap_zoom: 1.25,
      mindmap_origin_x: 80,
      mindmap_origin_y: 40,
    });
    expect(await repo.getProjectUiState('p1')).toEqual({
      pane_width: 520,
      mindmap_zoom: 1.25,
      mindmap_origin_x: 80,
      mindmap_origin_y: 40,
    });
    const raw = JSON.parse(await fs.readFile(path.join(await repo.root(), 'p1', 'project_config.json'), 'utf8'));
    expect(raw.ui.pane_width).toBe(520);
  });

  it('writes app config atomically', async () => {
    const repo = await makeRepo();
    const saved = await repo.writeAppConfig({ theme: 'dusk', pane_width: 500, current_project_id: 'p1' });
    expect(saved.theme).toBe('dusk');
    expect((await repo.readAppConfig()).pane_width).toBe(500);
  });

  it('loads empty agents for legacy projects and round-trips agents with usage ledger', async () => {
    const repo = await makeRepo();
    await repo.saveProject(project('p1'));
    expect(await repo.listProjectAgents('p1')).toEqual([]);

    const agents: ProjectAgent[] = [
      {
        agent_id: 'a1',
        kind: 'research',
        type: 'OpenAI',
        name: 'OpenAI Research',
        url: 'https://api.openai.com/v1',
        created_at: '2026-10-09T00:00:00.000Z',
        updated_at: '2026-10-09T00:00:00.000Z',
      },
    ];
    const ledger: Record<string, AgentUsageLedger> = {
      a1: { calendar_month: '2026-10', tokens_today: 10, tokens_period: 100, requests_today: 1, requests_period: 5 },
    };
    await repo.saveProjectAgents('p1', agents);
    await repo.saveAgentUsageLedger('p1', ledger);

    await repo.saveProject({ ...project('p1'), title: 'Updated title' });
    expect(await repo.listProjectAgents('p1')).toEqual(agents);
    expect(await repo.getAgentUsageLedger('p1')).toEqual(ledger);

    const raw = JSON.parse(await fs.readFile(path.join(await repo.root(), 'p1', 'project_config.json'), 'utf8'));
    expect(raw.agents).toHaveLength(1);
    expect(raw.agent_usage_ledger.a1.tokens_period).toBe(100);
  });

  it('mirrors git-relative battleplan paths under the project workspace', async () => {
    const repo = await makeRepo();
    await repo.saveProject(project('p1'));
    const gitPath = 'battleplan/projects/p1/tasks/partition-a/outputs/brief.md';
    await repo.writeGitMirrorFile('p1', gitPath, '## Goal\nShip it.\n');
    const absolute = path.join(await repo.root(), 'p1', ...gitPath.split('/'));
    expect(await fs.readFile(absolute, 'utf8')).toContain('Ship it.');
    expect(await repo.readGitMirrorFile('p1', gitPath)).toContain('Ship it.');
  });
});
