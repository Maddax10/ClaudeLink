import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const attemptsSchema = z.object({ count: z.number().int().min(0) });

function attemptsPath(home: string): string {
  return join(home, 'create-attempts.json');
}

/**
 * Combien de fois on a deja essaye de creer un depot sur cette machine.
 *
 * Le compteur vit ici, sur le disque, et non dans un argument que l'appelant renvoie a chaque fois.
 * Une premiere version prenait un `attempt` fourni par le modele, avec un commentaire affirmant que
 * « la limite vit dans le code ». C'etait faux : un appelant qui renvoie `attempt: 1` indefiniment
 * bouclait pour toujours, et le test ne prouvait que la confiance du code envers le nombre qu'on
 * lui tendait. Une limite que celui qu'elle borne peut remettre a zero n'est pas une limite.
 */
export async function countAttempt(home: string): Promise<number> {
  const next = (await readAttempts(home)) + 1;
  try {
    // Le dossier n'existe pas encore au premier essai - c'est `configureChannel` qui le cree, plus
    // tard. Sans ce `mkdir`, l'ecriture echouait en silence et le compteur restait a zero a chaque
    // appel : la limite ne limitait rien, exactement comme la version qu'elle remplace.
    await mkdir(home, { recursive: true });
    await writeFile(attemptsPath(home), `${JSON.stringify({ count: next })}\n`, 'utf8');
  } catch {
    // Home non ecrivable : on rend quand meme le compte. Ne pas pouvoir compter ne doit pas
    // empecher une installation par ailleurs valide.
  }
  return next;
}

export async function readAttempts(home: string): Promise<number> {
  try {
    return attemptsSchema.parse(JSON.parse(await readFile(attemptsPath(home), 'utf8')) as unknown).count;
  } catch {
    return 0;
  }
}

/** Une installation reussie remet le compteur a zero : la prochaine machine, ou la prochaine
 *  reconfiguration, repart avec ses cinq essais. */
export async function clearAttempts(home: string): Promise<void> {
  await rm(attemptsPath(home), { force: true });
}
