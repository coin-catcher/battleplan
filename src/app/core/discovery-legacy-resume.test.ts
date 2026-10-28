import { describe, expect, it } from 'vitest';
import type { ChatMessage, ProjectTask } from './models';
import {
  canOfferLegacyDiscoveryResume,
  inferLegacyDiscoverySession,
  partitionLayerAlreadyImported,
} from './discovery-legacy-resume';

const root: ProjectTask = {
  task_id: 'root',
  project_id: 'p',
  title: 'Brainstorm',
  prompt: '',
  dependencies: [],
  status: 'DOING',
  output_type: 'research',
  node_kind: 'brainstorm',
  order: 0,
  created_at: '',
  updated_at: '',
};

describe('discovery-legacy-resume', () => {
  it('infers partition session when generate_tasks ran and JSON is in chat', () => {
    const messages: ChatMessage[] = [
      {
        message_id: '1',
        scope: 'task',
        project_id: 'p',
        task_id: 'root',
        role: 'user',
        content: 'Start Discovery',
        intent: 'generate_tasks',
        created_at: '',
      },
      {
        message_id: '2',
        scope: 'task',
        project_id: 'p',
        task_id: 'root',
        role: 'assistant',
        content: '```json\n{"tasks":[{"title":"A","prompt":"p","output_type":"code","depends_on":[]}],"edges":[]}\n```',
        created_at: '',
      },
    ];
    const session = inferLegacyDiscoverySession(root, messages, [], null, [root]);
    expect(session?.phase).toBe('partition');
    expect(session?.sourceTaskId).toBe('root');
  });

  it('offers resume when legacy signals present', () => {
    const messages: ChatMessage[] = [{
      message_id: '1',
      scope: 'task',
      project_id: 'p',
      task_id: 'root',
      role: 'user',
      content: 'partition',
      intent: 'generate_tasks',
      created_at: '',
    }];
    expect(canOfferLegacyDiscoveryResume(root, messages, [], null, [root])).toBe(true);
  });

  it('offers resume for DOING brainstorm with brief_path partition JSON only', () => {
    const doingRoot: ProjectTask = { ...root, status: 'DOING' };
    const messages: ChatMessage[] = [{
      message_id: '2',
      scope: 'task',
      project_id: 'p',
      task_id: 'root',
      role: 'assistant',
      content: JSON.stringify({
        tasks: [{ title: 'MVP Auth', brief_path: 'battleplan/projects/p/tasks/x/outputs/brief.md' }],
        edges: [],
      }),
      created_at: '',
    }];
    expect(canOfferLegacyDiscoveryResume(doingRoot, messages, [], null, [doingRoot])).toBe(true);
  });

  it('detects partition tasks already on the mindmap', () => {
    const child: ProjectTask = { ...root, task_id: 'c1', title: 'A', dependencies: [] };
    const rootWithChild: ProjectTask = { ...root, dependencies: ['c1'] };
    const imported = partitionLayerAlreadyImported(rootWithChild, [rootWithChild, child], {
      tasks: [{ title: 'A', prompt: 'p', output_type: 'code', depends_on: [] }],
      edges: [],
    });
    expect(imported).toBe(true);
  });
});
