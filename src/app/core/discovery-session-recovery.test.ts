import { describe, expect, it } from 'vitest';
import { reconcileDiscoverySessionFromChat } from './discovery-session-recovery';
import type { GenerateTasksSessionState } from './generate-tasks-layered';
import type { ChatMessage } from './models';

const baseSession: GenerateTasksSessionState = {
  sourceTaskId: 'root',
  phase: 'depth_first',
  layer: 1,
  activeGraphId: 'g1',
  activeGraphGoal: 'Partition A',
  partitionTitles: ['Partition A'],
  partitionIndex: 0,
  focusPartitionTitle: 'Partition A',
  awaitingGraphJson: false,
};

describe('reconcileDiscoverySessionFromChat', () => {
  it('sets awaitingGraphJson when GRAPH DONE and importable JSON exist', () => {
    const json = JSON.stringify({
      tasks: [{ id: 't1', title: 'One', brief_path: 'battleplan/projects/p/tasks/t1/outputs/brief.md' }],
      edges: [],
    });
    const messages: ChatMessage[] = [
      { message_id: '1', scope: 'task', project_id: 'p', task_id: 'root', role: 'user', content: 'GRAPH DONE', created_at: '' },
      { message_id: '2', scope: 'task', project_id: 'p', task_id: 'root', role: 'assistant', content: json, created_at: '' },
    ];
    const next = reconcileDiscoverySessionFromChat(baseSession, messages, []);
    expect(next.awaitingGraphJson).toBe(true);
  });
});
