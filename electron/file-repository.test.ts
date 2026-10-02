import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatArtifact, ChatMessage, Project, ProjectTask } from '../src/app/core/models';
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

  it('writes app config atomically', async () => {
    const repo = await makeRepo();
    const saved = await repo.writeAppConfig({ theme: 'dusk', pane_width: 500, current_project_id: 'p1' });
    expect(saved.theme).toBe('dusk');
    expect((await repo.readAppConfig()).pane_width).toBe(500);
  });
});
