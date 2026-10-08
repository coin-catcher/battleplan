import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { shell } from 'electron';
import { githubAssetDownloadHeaders } from '../src/app/core/desktop-release-update';

export async function downloadReleaseAsset(input: {
  assetApiUrl: string;
  token: string;
  destinationPath: string;
}): Promise<void> {
  const response = await fetch(input.assetApiUrl, {
    headers: githubAssetDownloadHeaders(input.token),
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(`Installer download failed (${response.status}).`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(input.destinationPath), { recursive: true });
  await fs.writeFile(input.destinationPath, buffer);
}

export async function installDownloadedRelease(filePath: string, platform: NodeJS.Platform): Promise<void> {
  if (platform === 'win32') {
    spawn(filePath, [], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  if (platform === 'darwin') {
    const opened = await shell.openPath(filePath);
    if (opened) throw new Error(opened);
    return;
  }
  if (platform === 'linux') {
    if (filePath.endsWith('.AppImage')) {
      await fs.chmod(filePath, 0o755);
      spawn(filePath, [], { detached: true, stdio: 'ignore' }).unref();
      return;
    }
    if (filePath.endsWith('.deb')) {
      spawn('xdg-open', [filePath], { detached: true, stdio: 'ignore' }).unref();
      return;
    }
  }
  throw new Error('Unsupported installer type for this platform.');
}
