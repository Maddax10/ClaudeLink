import { createHash } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

const recordSchema = z.object({
  pid: z.number().int().positive(),
  startedAt: z.string().datetime({ offset: false }),
});

export type WatchProcess = z.infer<typeof recordSchema>;

/**
 * Un seul veilleur par machine, et de quoi le retrouver pour l'arreter.
 *
 * Le fichier vit dans le dossier temporaire local et non dans le home, pour la meme raison que le
 * verrou d'operation (git/lock.ts) : un home synchronise par OneDrive rend les dates de fichiers
 * assez fantaisistes pour qu'un controle de fraicheur reponde n'importe quoi.
 */
function watchProcessPath(home: string): string {
  const fingerprint = createHash('sha256').update(home).digest('hex').slice(0, 16);
  return join(tmpdir(), `claude-link-${fingerprint}.watch.json`);
}

/** Le veilleur en cours, ou `undefined` s'il n'y en a pas - y compris quand le fichier existe mais
 *  que le processus qu'il nomme est mort (machine redemarree, processus tue). */
export async function readWatchProcess(home: string): Promise<WatchProcess | undefined> {
  let record: WatchProcess;
  try {
    record = recordSchema.parse(JSON.parse(await readFile(watchProcessPath(home), 'utf8')) as unknown);
  } catch {
    return undefined;
  }
  return isAlive(record.pid) ? record : undefined;
}

export type Acquisition = { readonly ok: true } | { readonly ok: false; readonly heldBy: number };

/**
 * Prend la place du veilleur unique, ou dit qui la tient deja.
 *
 * La creation est exclusive (`flag: 'wx'`) et non « je lis, puis j'ecris » : le serveur MCP demarre
 * avec chaque session Claude Code, donc deux fenetres ouvertes en meme temps lancent deux veilleurs
 * a la meme seconde. Entre une lecture et une ecriture separees, les deux passeraient.
 *
 * Un fichier laisse par un processus mort est repris - sinon un Ctrl-C interdirait tout veilleur
 * jusqu'au prochain redemarrage de la machine.
 */
export async function acquireWatchProcess(home: string, pid: number = process.pid): Promise<Acquisition> {
  const record: WatchProcess = { pid, startedAt: new Date().toISOString() };
  const content = `${JSON.stringify(record)}\n`;

  try {
    await writeFile(watchProcessPath(home), content, { encoding: 'utf8', flag: 'wx' });
    return { ok: true };
  } catch {
    const held = await readWatchProcess(home);
    if (held !== undefined) {
      return { ok: false, heldBy: held.pid };
    }
  }

  // Le fichier etait la mais son processus est mort. Une seule reprise : si celle-ci echoue encore,
  // c'est qu'un autre veilleur l'a prise entre-temps, et c'est exactement ce qu'on voulait empecher.
  await clearWatchProcess(home);
  try {
    await writeFile(watchProcessPath(home), content, { encoding: 'utf8', flag: 'wx' });
    return { ok: true };
  } catch {
    const held = await readWatchProcess(home);
    return held === undefined ? { ok: false, heldBy: 0 } : { ok: false, heldBy: held.pid };
  }
}

export async function clearWatchProcess(home: string): Promise<void> {
  await rm(watchProcessPath(home), { force: true });
}

/** Rend le pid arrete, ou `undefined` s'il n'y avait rien a arreter. */
export async function stopWatchProcess(home: string): Promise<number | undefined> {
  const record = await readWatchProcess(home);
  await clearWatchProcess(home);
  if (record === undefined) {
    return undefined;
  }
  try {
    process.kill(record.pid, 'SIGTERM');
  } catch {
    return undefined;
  }
  return record.pid;
}

/**
 * Le systeme recycle les pid. Un pid reattribue a un autre programme repondrait donc « vivant »
 * alors que le veilleur est mort, et on n'en relancerait pas.
 *
 * C'est le bon cote de l'erreur, et il est asymetrique : pas de veilleur, ca se voit tout de suite
 * puisque personne ne repond. L'erreur inverse lancerait un second veilleur, et deux veilleurs
 * repondent chacun a chaque message sans jamais se voir.
 */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
