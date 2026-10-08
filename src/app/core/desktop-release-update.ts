export const BATTLEPLAN_RELEASE_REPO = {
  owner: 'coin-catcher',
  repo: 'battleplan',
} as const;

export interface GithubReleaseAsset {
  id: number;
  name: string;
  url: string;
  browser_download_url: string;
  size: number;
}

export interface GithubRelease {
  tag_name: string;
  name: string;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  assets: GithubReleaseAsset[];
}

export function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/i, '');
}

/** Production semver tags only (excludes develop test tags like v1.0.7-test-123). */
export function isProductionReleaseTag(tagName: string): boolean {
  return /^v?\d+\.\d+\.\d+$/i.test(tagName.trim());
}

export function parseSemver(value: string): [number, number, number] | null {
  const match = normalizeVersion(value).match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareSemver(left: string, right: string): number {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function isNewerVersion(latest: string, current: string): boolean {
  return compareSemver(latest, current) > 0;
}

export function latestProductionRelease(releases: GithubRelease[]): GithubRelease | null {
  let best: GithubRelease | null = null;
  let bestVersion = '';
  for (const release of releases) {
    if (release.draft) continue;
    if (!isProductionReleaseTag(release.tag_name)) continue;
    const version = normalizeVersion(release.tag_name);
    if (!best || compareSemver(version, bestVersion) > 0) {
      best = release;
      bestVersion = version;
    }
  }
  return best;
}

export function selectInstallerAsset(
  assets: GithubReleaseAsset[],
  platform: NodeJS.Platform,
): GithubReleaseAsset | null {
  const installers = assets.filter((asset) => !asset.name.endsWith('.blockmap'));
  if (platform === 'win32') {
    return installers.find((asset) => /-win\.exe$/i.test(asset.name)) ?? null;
  }
  if (platform === 'darwin') {
    return installers.find((asset) => /-mac\.dmg$/i.test(asset.name))
      ?? installers.find((asset) => /-mac\.zip$/i.test(asset.name))
      ?? null;
  }
  if (platform === 'linux') {
    return installers.find((asset) => /-linux\.AppImage$/i.test(asset.name))
      ?? installers.find((asset) => /-linux\.deb$/i.test(asset.name))
      ?? null;
  }
  return null;
}

export function githubAuthHeaders(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'battleplan-desktop',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export function githubAssetDownloadHeaders(token: string): Record<string, string> {
  return {
    Accept: 'application/octet-stream',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'battleplan-desktop',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}
