import { readFile, rm, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { awaitingPath } from '../paths.js';

const awaitingSchema = z.object({
  /** Horodatage local, en millisecondes, au-dela duquel on cesse d'attendre. */
  until: z.number().int().positive(),
  messageId: z.string(),
});

export type Awaiting = z.infer<typeof awaitingSchema>;

/**
 * Une question vient d'etre posee a l'autre machine. C'est ce marqueur, et lui seul, qui autorise
 * le hook de fin de tour a rester quelques secondes en attente : sans lui, chaque fin de tour de
 * chaque session paierait une attente pour rien.
 *
 * Les deux bornes de l'horodatage sont locales (ecrites et relues sur cette machine), donc la
 * comparaison est valide — ce ne serait pas le cas contre l'horloge de l'autre machine.
 */
export async function markAwaiting(home: string, messageId: string, seconds: number): Promise<void> {
  const awaiting: Awaiting = { until: Date.now() + seconds * 1000, messageId };
  await writeFile(awaitingPath(home), `${JSON.stringify(awaiting)}\n`, 'utf8');
}

export async function readAwaiting(home: string): Promise<Awaiting | undefined> {
  try {
    const awaiting = awaitingSchema.parse(JSON.parse(await readFile(awaitingPath(home), 'utf8')) as unknown);
    return Date.now() < awaiting.until ? awaiting : undefined;
  } catch {
    return undefined;
  }
}

export async function clearAwaiting(home: string): Promise<void> {
  await rm(awaitingPath(home), { force: true });
}
