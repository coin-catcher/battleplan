import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentUsageLedger, Project, ProjectAgent } from '../src/app/core/models';
import { exportProject, importProject } from './battleplan-archive';
import { FileRepository } from './file-repository';

const tempDirs: string[] = [];

function project(id: string): Project {
  return {
    project_id: id,
    title: 'Sample',
    initial_prompt: 'prompt',
    cursor_chat_link: 'https://cursor.com/agents/a',
    created_at: '2026-10-02T00:00:00.000Z',
    updated_at: '2026-10-02T00:00:00.000Z',
  };
}

async function makeRepo(): Promise<{ repo: FileRepository; root: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'battleplan-'));
  tempDirs.push(root);
  return { repo: new FileRepository(root), root };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('battleplan archive', () => {
  it('exports and imports a project archive', async () => {
    const { repo, root } = await makeRepo();
    await repo.saveProject(project('p1'));
    const archivePath = path.join(root, 'sample.battleplan');
    await exportProject(repo, 'p1', archivePath);
    const target = await makeRepo();
    const imported = await importProject(target.repo, archivePath, false);
    expect(imported.project_id).toBe('p1');
    expect((await target.repo.listProjects())).toHaveLength(1);
  });

  it('preserves agents and usage ledger in export/import', async () => {
    const { repo, root } = await makeRepo();
    await repo.saveProject(project('p1'));
    const agents: ProjectAgent[] = [
      {
        agent_id: 'a1',
        kind: 'research',
        type: 'Gemini',
        name: 'Gemini Research',
        url: 'https://generativelanguage.googleapis.com/v1beta',
        created_at: '2026-10-09T00:00:00.000Z',
        updated_at: '2026-10-09T00:00:00.000Z',
      },
    ];
    const ledger: Record<string, AgentUsageLedger> = { a1: { tokens_period: 42 } };
    await repo.saveProjectAgents('p1', agents);
    await repo.saveAgentUsageLedger('p1', ledger);
    const archivePath = path.join(root, 'with-agents.battleplan');
    await exportProject(repo, 'p1', archivePath);
    const target = await makeRepo();
    await importProject(target.repo, archivePath, false);
    expect(await target.repo.listProjectAgents('p1')).toEqual(agents);
    expect(await target.repo.getAgentUsageLedger('p1')).toEqual(ledger);
  });

  it('signals when a project already exists', async () => {
    const { repo, root } = await makeRepo();
    await repo.saveProject(project('p1'));
    const archivePath = path.join(root, 'sample.battleplan');
    await exportProject(repo, 'p1', archivePath);
    await expect(importProject(repo, archivePath, false)).rejects.toThrow('PROJECT_EXISTS');
  });
});
