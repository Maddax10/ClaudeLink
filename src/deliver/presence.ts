import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { lastTurnPath } from '../paths.js';

const lastTurnSchema = z.object({
  /** Horodatage local, en millisecondes. Ecrit et relu sur cette machine, donc comparable a son
   *  horloge - ce qui ne serait pas vrai d'une date venue de l'autre machine. */
  at: z.number().int().positive(),
});

/**
 * Une session vient de finir un tour ici. Appele par les deux hooks, qui sont les seuls endroits
 * ou le produit apprend qu'un humain est devant l'ecran.
 *
 * Silencieux en cas d'echec : un hook ne doit jamais casser une session, et ne pas savoir qu'on
 * est present ne coute qu'une reponse en double.
 */
export async function markTurn(home: string): Promise<void> {
  try {
    await writeFile(lastTurnPath(home), `${JSON.stringify({ at: Date.now() })}\n`, 'utf8');
  } catch {
    // Rien a dire : la trace est un confort, son absence rend seulement le veilleur plus bavard.
  }
}

/** Quand une session a bouge pour la derniere fois, ou `undefined` si on n'en sait rien. */
export async function readLastTurn(home: string): Promise<number | undefined> {
  try {
    return lastTurnSchema.parse(JSON.parse(await readFile(lastTurnPath(home), 'utf8')) as unknown).at;
  } catch {
    return undefined;
  }
}
