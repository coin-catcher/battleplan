import fs from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

const schemaPath = path.join(
  process.cwd(),
  'research/15ddb36c-b9ec-4732-9ac1-6049da532e8a/86575162-d95e-486d-8db4-18858ab5a093/agent-schema.json',
);

describe('agent-schema.json', () => {
  it('validates a sample project agent document extension', () => {
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);

    const sample = {
      agents: [
        {
          agent_id: 'agent-openai-1',
          kind: 'research',
          type: 'OpenAI',
          name: 'OpenAI Research',
          url: 'https://api.openai.com/v1',
          api_key: 'sk-test',
          options: {
            system_prompt: 'You are a research assistant.',
            use_reasoning: true,
            use_tool_calls: false,
            model: 'gpt-4.1-mini',
            temperature: 0.7,
          },
          created_at: '2026-10-09T00:00:00.000Z',
          updated_at: '2026-10-09T00:00:00.000Z',
        },
      ],
      agent_usage_ledger: {
        'agent-openai-1': {
          calendar_month: '2026-10',
          tokens_today: 1200,
          tokens_period: 45000,
          requests_today: 3,
          requests_period: 88,
          last_request_at: '2026-10-09T12:00:00.000Z',
        },
      },
    };

    expect(validate(sample)).toBe(true);
    expect(validate.errors).toBeNull();
  });

  it('validates a Cursor code agent with cloud options', () => {
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);

    const sample = {
      agents: [
        {
          agent_id: 'agent-cursor-1',
          kind: 'code',
          type: 'Cursor Agent',
          name: 'Cursor Code Agent',
          url: 'https://api.cursor.com/v1',
          options: {
            default_mode: 'agent',
            default_repo_url: 'https://github.com/org/repo',
            default_starting_ref: 'develop',
            auto_create_pr: false,
            env_vars_json: '{}',
          },
          cursor_agent_id: 'bc_abc123',
          last_test_status: 'success',
          last_test_at: '2026-10-09T12:00:00.000Z',
          created_at: '2026-10-09T00:00:00.000Z',
          updated_at: '2026-10-09T00:00:00.000Z',
        },
      ],
    };

    expect(validate(sample)).toBe(true);
    expect(validate.errors).toBeNull();
  });
});
