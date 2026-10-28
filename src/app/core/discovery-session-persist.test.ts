import { describe, expect, it } from 'vitest';
import {
  describeDiscoveryNextAction,
  generateTasksSessionFromPersisted,
  persistedDiscoverySessionFromGenerateTasks,
} from './discovery-session-persist';
import type { GenerateTasksSessionState } from './generate-tasks-layered';

describe('discovery-session-persist', () => {
  it('round-trips session fields', () => {
    const session: GenerateTasksSessionState = {
      sourceTaskId: 't1',
      phase: 'depth_first',
      layer: 2,
      activeGraphId: 'g1',
      activeGraphGoal: 'Partition A',
      partitionTitles: ['A', 'B'],
      partitionIndex: 0,
      focusPartitionTitle: 'A',
      awaitingGraphJson: true,
      lastImportedMessageKey: 'run:abc',
    };
    const persisted = persistedDiscoverySessionFromGenerateTasks(session);
    const restored = generateTasksSessionFromPersisted(persisted);
    expect(restored).toMatchObject({
      sourceTaskId: 't1',
      phase: 'depth_first',
      awaitingGraphJson: true,
      lastImportedMessageKey: 'run:abc',
      partitionTitles: ['A', 'B'],
    });
    expect(persisted.next_action).toMatch(/GRAPH DONE/i);
  });

  it('describes partition phase next action', () => {
    const text = describeDiscoveryNextAction({
      sourceTaskId: 't',
      phase: 'partition',
      layer: 1,
      activeGraphId: 'g',
      activeGraphGoal: 'Root',
      partitionTitles: [],
      partitionIndex: 0,
    });
    expect(text).toMatch(/Layer 1/i);
  });
});
