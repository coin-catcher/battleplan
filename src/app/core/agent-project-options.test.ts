import { describe, expect, it } from 'vitest';
import { applyProjectInheritedAgentOptions, parseCursorEnvVarsJson } from './agent-project-options';
import type { Project, ProjectAgent } from './models';

describe('applyProjectInheritedAgentOptions', () => {
  it('fills empty Cursor repo/ref from project fields', () => {
    const agent: ProjectAgent = {
      agent_id: 'a1',
      kind: 'code',
      type: 'Cursor Agent',
      name: 'Cursor',
      url: 'https://api.cursor.com/v1',
      options: { default_repo_url: '', default_starting_ref: '' },
      created_at: '2026-10-09T00:00:00.000Z',
      updated_at: '2026-10-09T00:00:00.000Z',
    };
    const project: Project = {
      project_id: 'p1',
      title: 'T',
      initial_prompt: 'P',
      cursor_chat_link: 'https://cursor.com/agents/x',
      repo_url: 'https://github.com/org/repo',
      starting_ref: 'feature/x',
      created_at: '2026-10-09T00:00:00.000Z',
      updated_at: '2026-10-09T00:00:00.000Z',
    };
    const merged = applyProjectInheritedAgentOptions(agent, project);
    expect(merged['default_repo_url']).toBe('https://github.com/org/repo');
    expect(merged['default_starting_ref']).toBe('feature/x');
  });
});

describe('parseCursorEnvVarsJson', () => {
  it('parses object JSON for Cursor env_vars_json option', () => {
    expect(parseCursorEnvVarsJson({ env_vars_json: '{"FOO":"bar","N":1}' })).toEqual({ FOO: 'bar', N: '1' });
  });

  it('rejects invalid JSON', () => {
    expect(() => parseCursorEnvVarsJson({ env_vars_json: 'not-json' })).toThrow(/Environment variables/);
  });
});
