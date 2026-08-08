import { createHash } from 'node:crypto';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Un verrou court autour de chaque sequence git. Deux sessions ouvertes sur la meme machine
 * partagent le meme clone : sans lui, un `reset --hard` peut tomber pendant le commit de l'autre.
 *
 * Il vit dans le dossier temporaire local, jamais dans le home : sous Windows, un home
 * synchronise par OneDrive rend les dates de fichiers assez fantaisistes pour qu'un verrou y
 * paraisse tantot frais, tantot perime.
 */
export class OperationLock {
  private readonly lockDir: string;

  constructor(
    workDir: string,
    private readonly staleMs = 60_000,
    private readonly timeoutMs = 30_000,
  ) {
    const fingerprint = createHash('sha256').update(workDir).digest('hex').slice(0, 16);
    this.lockDir = join(tmpdir(), `claude-link-${fingerprint}.lock`);
  }

  async withLock<T>(work: () => Promise<T>): Promise<T> {
    const deadline = Date.now() + this.timeoutMs;
    for (;;) {
      if (await this.tryAcquire()) {
        try {
          return await work();
        } finally {
          await rm(this.lockDir, { recursive: true, force: true });
        }
      }
      if (Date.now() > deadline) {
        throw new Error(`another claude-link operation is still holding ${this.lockDir}`);
      }
      await delay(150);
    }
  }

  private async tryAcquire(): Promise<boolean> {
    try {
      await mkdir(this.lockDir);
      await writeFile(join(this.lockDir, 'pid'), String(process.pid), 'utf8');
      return true;
    } catch {
      return this.reclaimIfStale();
    }
  }

  /** Un verrou laisse par un processus tue ne doit pas bloquer la machine pour toujours. */
  private async reclaimIfStale(): Promise<boolean> {
    try {
      const info = await stat(this.lockDir);
      if (Date.now() - info.mtimeMs < this.staleMs) {
        return false;
      }
      await rm(this.lockDir, { recursive: true, force: true });
      return false;
    } catch {
      return false;
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
