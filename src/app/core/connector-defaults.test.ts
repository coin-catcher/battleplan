import { describe, expect, it } from 'vitest';
import { defaultConnectorForTask } from './connector-defaults';
import type { Project, ProjectTask } from './models';

const project = { project_id: 'p1', default_hermes_connector_id: 'hermes-1' } as Project;

describe('defaultConnectorForTask', () => {
  it('maps output types to connectors', () => {
    const code = { output_type: 'code' } as ProjectTask;
    const research = { output_type: 'research' } as ProjectTask;
    const sub = { output_type: 'subproject' } as ProjectTask;
    expect(defaultConnectorForTask(code, project)).toBe('cursor');
    expect(defaultConnectorForTask(research, project)).toBe('research_http');
    expect(defaultConnectorForTask(sub, project)).toBe('hermes');
  });
});
