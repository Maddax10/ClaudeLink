/**
 * Rétention par **nombre uniquement**, jamais par age. Deux raisons, et chacune suffit :
 *
 * - la date d'un message est celle de l'horloge de la machine qui l'a ecrit, pas de celle qui purge ;
 * - une regle par age ne sait pas honorer « en garder au moins un » : une boite calme se vide
 *   entierement, et le jour ou on cherche le dernier echange, il n'y a plus rien.
 *
 * Ce que ca ne fait pas, et qui doit rester dit : supprimer les fichiers n'efface pas l'historique
 * Git. Le depot continue de grossir, lentement. La seule vraie remise a zero est de le recreer.
 */
export function filesToPrune(paths: readonly string[], keep: number): string[] {
  if (keep < 1) {
    throw new RangeError('keep must be at least 1');
  }
  // Les noms commencent par l'horodatage, donc l'ordre alphabetique est l'ordre chronologique de
  // l'emetteur. C'est suffisant pour choisir quoi jeter : on jette le plus ancien, pas le plus juste.
  const sorted = [...paths].sort();
  return sorted.length <= keep ? [] : sorted.slice(0, sorted.length - keep);
}
