import fs from 'node:fs/promises';
import path from 'node:path';

const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function writeFileAtomic(filePath: string, contents: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const directory = path.dirname(filePath);
  const nonce = `${Date.now()}.${process.hrtime.bigint().toString(36)}`;
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${nonce}.tmp`);
  await fs.writeFile(tempPath, contents);
  try {
    await replaceFile(tempPath, filePath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

async function replaceFile(tempPath: string, filePath: string): Promise<void> {
  const maxAttempts = process.platform === 'win32' ? 10 : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await fs.rename(tempPath, filePath);
      return;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (process.platform !== 'win32' || !RETRYABLE_RENAME_CODES.has(err.code ?? '')) {
        throw error;
      }

      try {
        await tryWindowsFallback(tempPath, filePath);
        return;
      } catch (fallbackError) {
        const fb = fallbackError as NodeJS.ErrnoException;
        if (!RETRYABLE_RENAME_CODES.has(fb.code ?? '') || attempt === maxAttempts - 1) {
          throw fallbackError;
        }
        await sleep(25 * (attempt + 1));
      }
    }
  }
}

async function tryWindowsFallback(tempPath: string, filePath: string): Promise<void> {
  try {
    await fs.chmod(filePath, 0o666);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  try {
    await fs.copyFile(tempPath, filePath);
    await fs.unlink(tempPath);
    return;
  } catch (copyError) {
    const code = (copyError as NodeJS.ErrnoException).code;
    if (!RETRYABLE_RENAME_CODES.has(code ?? '')) throw copyError;
  }

  await fs.unlink(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
  await fs.rename(tempPath, filePath);
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
