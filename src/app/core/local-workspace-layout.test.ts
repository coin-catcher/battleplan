import { describe, expect, it } from 'vitest';
import { userDataRootFromProjectsDataRoot } from './local-workspace-layout';

describe('local-workspace-layout', () => {
  it('derives userData from projects data root', () => {
    expect(userDataRootFromProjectsDataRoot('/appdata/battleplan/projects')).toBe('/appdata/battleplan');
  });
});
