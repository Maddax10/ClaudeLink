import { z } from 'zod';

/**
 * Un nom de machine finit dans un chemin de fichier que les deux machines lisent et ecrivent.
 * On le limite donc a ce qui passe partout : minuscules, chiffres, trait d'union. Un caractere
 * refuse par Windows (`:` par exemple) casserait le depot pour les deux machines, pas seulement
 * pour celle qui l'a choisi.
 */
export const MACHINE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

export const machineNameSchema = z
  .string()
  .regex(MACHINE_NAME_PATTERN, 'a machine name must be 1 to 32 chars of a-z, 0-9 and "-", starting with a letter or digit');

export function isMachineName(value: unknown): value is string {
  return typeof value === 'string' && MACHINE_NAME_PATTERN.test(value);
}
