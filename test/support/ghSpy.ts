import type { GhRunner } from '../../src/git/provision.js';

export interface GhSpy {
  /** Ce que `gh` a recu, dans l'ordre. Ce qu'il n'a **pas** recu compte autant : c'est ainsi qu'on
   *  prouve qu'un garde mord avant le lancement, et pas seulement qu'il leve. */
  readonly calls: string[][];
  readonly run: GhRunner;
}

/** Un `gh` qui note ce qu'on lui demande, partage par les tests unitaires et d'integration : deux
 *  copies auraient diverge des le premier correctif. */
export function ghSpy(reply: (args: readonly string[]) => string | Promise<string>): GhSpy {
  const calls: string[][] = [];
  return {
    calls,
    run: async (args) => {
      calls.push([...args]);
      return reply(args);
    },
  };
}

/** Un `gh` qui echoue comme le vrai : le message sur `stderr`, et un `code` quand il s'agit d'un
 *  lancement impossible. */
export function ghFailure(text: string, code?: string): () => never {
  return () => {
    const error = new Error(text) as Error & { stderr?: string; code?: string };
    error.stderr = text;
    if (code !== undefined) {
      error.code = code;
    }
    throw error;
  };
}
