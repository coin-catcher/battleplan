import { describe, expect, it } from 'vitest';
import { mapBattleplanStatusToHermes, mapHermesStatusToBattleplan } from './agent-connector';

describe('agent-connector status mapping', () => {
  it('maps Hermes running to DOING', () => {
    expect(mapHermesStatusToBattleplan('running')).toBe('DOING');
  });

  it('maps Battleplan REVIEW to Hermes review', () => {
    expect(mapBattleplanStatusToHermes('REVIEW')).toBe('review');
  });

  it('returns undefined for unknown Hermes statuses', () => {
    expect(mapHermesStatusToBattleplan('unknown')).toBeUndefined();
  });
});
