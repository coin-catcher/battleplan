import { describe, expect, it } from 'vitest';
import {
  compareSemver,
  isNewerVersion,
  isProductionReleaseTag,
  latestProductionRelease,
  normalizeVersion,
  selectInstallerAsset,
  type GithubRelease,
} from './desktop-release-update';

describe('desktop-release-update', () => {
  it('normalizes version tags', () => {
    expect(normalizeVersion('v1.0.12')).toBe('1.0.12');
  });

  it('recognizes production release tags', () => {
    expect(isProductionReleaseTag('v1.0.7')).toBe(true);
    expect(isProductionReleaseTag('v1.0.7-test-1790978815')).toBe(false);
  });

  it('compares semver ordering', () => {
    expect(compareSemver('1.0.12', '1.0.7')).toBe(1);
    expect(isNewerVersion('1.0.12', '1.0.7')).toBe(true);
    expect(isNewerVersion('1.0.7', '1.0.7')).toBe(false);
  });

  it('picks the newest production release', () => {
    const releases: GithubRelease[] = [
      { tag_name: 'v1.0.7-test-1', name: 'test', body: null, draft: false, prerelease: true, assets: [] },
      { tag_name: 'v1.0.11', name: '11', body: 'notes', draft: false, prerelease: false, assets: [] },
      { tag_name: 'v1.0.12', name: '12', body: null, draft: false, prerelease: false, assets: [] },
    ];
    expect(latestProductionRelease(releases)?.tag_name).toBe('v1.0.12');
  });

  it('selects platform installers', () => {
    const assets = [
      { id: 1, name: 'battleplan-1.0.12-win.exe', url: '', browser_download_url: '', size: 1 },
      { id: 2, name: 'battleplan-1.0.12-win.exe.blockmap', url: '', browser_download_url: '', size: 1 },
    ];
    expect(selectInstallerAsset(assets, 'win32')?.name).toBe('battleplan-1.0.12-win.exe');
  });
});
