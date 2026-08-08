import { z } from 'zod';
import { machineNameSchema } from './names.js';

/** Toute evolution de la forme d'un message incremente ceci : une machine qui lit une version
 *  qu'elle ne connait pas doit refuser le message, pas le deviner. */
export const MESSAGE_VERSION = 1;

export const messageSchema = z.object({
  v: z.literal(MESSAGE_VERSION),
  id: z.string().regex(/^[0-9a-f]{12}$/, 'id must be 12 hex chars'),
  from: machineNameSchema,
  to: machineNameSchema,
  at: z.string().datetime({ offset: false }),
  text: z.string().min(1),
});

export type Message = z.infer<typeof messageSchema>;

export const MESSAGES_DIR = 'messages';

/** Un dossier par destinataire : chaque machine ne lit que le sien, sans filtrer quoi que ce soit. */
export function inboxDir(machine: string): string {
  return `${MESSAGES_DIR}/${machine}`;
}

/** `2026-08-08T14:22:33.123Z` -> `20260808T142233123Z`. Le nom de fichier commence par cet
 *  horodatage pour que l'ordre alphabetique reste lisible a l'oeil ; l'ordre qui fait foi pour la
 *  livraison reste celui des commits, jamais celui-ci (deux machines, deux horloges). */
export function stampOf(isoDate: string): string {
  return isoDate.replace(/[-:.]/g, '');
}

export function messageFileName(message: Message): string {
  return `${stampOf(message.at)}-${message.from}-${message.id}.json`;
}

export function messagePath(message: Message): string {
  return `${inboxDir(message.to)}/${messageFileName(message)}`;
}

export function serializeMessage(message: Message): string {
  return `${JSON.stringify(messageSchema.parse(message), null, 2)}\n`;
}

/** Leve si le contenu n'est pas un message valide. Un fichier illisible est ignore par l'appelant
 *  et signale dans le journal : il ne doit jamais etre livre a moitie. */
export function parseMessage(raw: string): Message {
  return messageSchema.parse(JSON.parse(raw) as unknown);
}
