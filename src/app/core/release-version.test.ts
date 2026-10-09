import { describe, expect, it } from 'vitest';
import { parseReleaseVersionBranch } from './release-version';

describe('parseReleaseVersionBranch', () => {
  it('reads explicit branch name lines', () => {
    expect(parseReleaseVersionBranch('Branch name: cursor/release-1.0.13')).toBe('cursor/release-1.0.13');
  });

  it('reads cursor branch tokens', () => {
    expect(parseReleaseVersionBranch('Pushed to cursor/releases-ec14.')).toBe('cursor/releases-ec14');
  });
});
