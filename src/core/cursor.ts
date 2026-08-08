import { z } from 'zod';

/**
 * Le curseur de lecture, c'est le dernier commit deja traite. Pas une date : les horloges de deux
 * machines ne sont pas comparables, alors que l'ordre des commits dans le depot l'est.
 */
export const cursorSchema = z.object({
  lastCommit: z.string().regex(/^[0-9a-f]{40}$/, 'lastCommit must be a full 40-char sha'),
});

export type Cursor = z.infer<typeof cursorSchema>;

export function parseCursor(raw: string): Cursor {
  return cursorSchema.parse(JSON.parse(raw) as unknown);
}

export function serializeCursor(cursor: Cursor): string {
  return `${JSON.stringify(cursorSchema.parse(cursor), null, 2)}\n`;
}

export interface Pending<T> {
  readonly path: string;
  readonly message: T;
}

export interface CatchUp<T> {
  /** Ce qui sera livre, dans l'ordre d'arrivee. */
  readonly deliver: readonly Pending<T>[];
  /** Combien ont ete sautes, pour pouvoir le dire au lieu de le taire. */
  readonly skipped: number;
}

/**
 * Borne le rattrapage au demarrage : une machine restee eteinte trois semaines ne doit pas
 * deverser tout son courrier d'un coup, chaque message coutant un tour comme un prompt tape.
 *
 * Borne par **nombre uniquement**, jamais par age : la date d'un message vient de l'horloge de
 * l'autre machine, et la comparer a l'horloge locale ferait disparaitre des messages en silence
 * des que les deux derivent. On garde les plus recents, ce sont eux qui ont encore du sens.
 */
export function boundCatchUp<T>(pending: readonly Pending<T>[], maxMessages: number): CatchUp<T> {
  if (maxMessages < 1) {
    throw new RangeError('maxMessages must be at least 1');
  }
  if (pending.length <= maxMessages) {
    return { deliver: [...pending], skipped: 0 };
  }
  return {
    deliver: pending.slice(pending.length - maxMessages),
    skipped: pending.length - maxMessages,
  };
}
