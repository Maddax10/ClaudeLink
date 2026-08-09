import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { type Config, resolveConfig } from './core/config.js';
import { explainRepoFailure } from './deliver/installHint.js';
import { type GhRunner, resolveRepo } from './git/provision.js';
import { NotAMailboxError } from './mailbox.js';
import { configPath } from './paths.js';
import { openWorkspace } from './workspace.js';

export interface ChannelRequest {
  readonly home: string;
  readonly machineName: string;
  readonly peer: string;
  readonly repoUrl: string;
}

export type ChannelOutcome =
  | { readonly ok: true; readonly config: Config }
  | { readonly ok: false; readonly cause: 'already-configured' | 'invalid' | 'not-a-mailbox' | 'failed'; readonly detail: string };

/**
 * Tout ce qu'il faut pour qu'une machine parle : la config sur le disque, le depot clone et amorce,
 * et les deux curseurs poses.
 *
 * Cette sequence existait dans `init`, en ligne de commande seulement. Elle vit ici parce que
 * l'outil MCP la refait a l'identique - deux copies auraient diverge des le premier correctif, et
 * celle qui compte le plus est celle qu'on utilise le moins.
 */
export async function configureChannel(request: ChannelRequest): Promise<ChannelOutcome> {
  const { home, machineName, peer, repoUrl } = request;

  if (await isConfigured(home)) {
    return {
      ok: false,
      cause: 'already-configured',
      detail: `${configPath(home)} exists. Read it to see the current channel, and remove it by hand to start over.`,
    };
  }

  let config: Config;
  try {
    // Valide avant d'ecrire quoi que ce soit : un nom refuse doit l'etre ici, pas au premier envoi.
    config = resolveConfig({ file: { machineName, peer, repoUrl } });
  } catch (error) {
    return { ok: false, cause: 'invalid', detail: describe(error) };
  }

  await mkdir(home, { recursive: true });
  await writeFile(configPath(home), `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  try {
    // `openWorkspace(home, config)` et non `loadApp()` : `loadApp` relit la configuration depuis
    // l'environnement, donc il ouvrirait le canal de la machine plutot que celui qu'on vient
    // d'ecrire. Mesure du 9 aout 2026 : les tests d'installation, sur un home temporaire, ont fait
    // avancer les curseurs du vrai canal. Rien n'a ete perdu ce jour-la - le lot etait vide - mais
    // le meme code lance une minute plus tot aurait mange du courrier jamais montre.
    const workspace = await openWorkspace(home, config);
    // Le marqueur est verifie **maintenant**, pas au premier envoi. Sans ca, quelqu'un qui donne le
    // nom d'un depot de code - le cas le plus probable de tous - ne l'apprendrait qu'apres avoir
    // cru l'installation reussie.
    await workspace.mailbox.assertMailbox();
    // Pose les deux curseurs sur l'etat courant : une machine qui s'attache ne doit pas deverser
    // tout l'historique dans son premier contexte.
    await workspace.mailbox.receive('session');
    await workspace.mailbox.receive('watch');
  } catch (error) {
    // La config reste sur le disque : la relire est le seul moyen de comprendre ce qui a ete tente,
    // et l'effacer ici priverait l'utilisateur de cette trace au pire moment.
    return {
      ok: false,
      cause: error instanceof NotAMailboxError ? 'not-a-mailbox' : 'failed',
      detail: describe(error),
    };
  }

  return { ok: true, config };
}

/** Au-dela, on arrete de proposer des noms et on propose autre chose. La limite vit dans le code :
 *  une intention qu'un modele se donne a lui-meme ne se teste pas, et ne tient pas sous charge. */
export const MAX_NAME_ATTEMPTS = 5;

export interface InstallRequest {
  readonly home: string;
  readonly machineName: string;
  readonly peer: string;
  readonly mode: 'use' | 'create' | 'url';
  readonly repo: string;
  readonly attempt?: number;
}

/**
 * L'installation complete : le depot d'abord, la configuration ensuite, et un texte lisible quoi
 * qu'il arrive.
 *
 * Elle vit ici plutot que dans le serveur MCP pour une seule raison, et elle est suffisante : dans
 * le serveur, la limite d'essais et le refus d'un depot de code ne seraient verifiables qu'en
 * lancant un vrai serveur contre un vrai GitHub.
 */
export async function installChannel(request: InstallRequest, run?: GhRunner): Promise<string> {
  const { home, machineName, peer, mode, repo, attempt } = request;

  if (await isConfigured(home)) {
    return `This machine already has a channel configured in ${home}. Read config.json there to see it, and remove that file by hand to start over.`;
  }

  let repoUrl = repo;
  if (mode !== 'url') {
    // Le compteur est verifie avant `resolveRepo` : passe la limite, on ne touche meme pas a `gh`.
    if (mode === 'create' && (attempt ?? 1) > MAX_NAME_ATTEMPTS) {
      return (
        `Stopping after ${MAX_NAME_ATTEMPTS} taken names. Rather than proposing another one, tell ` +
        'the user to pick an existing repository with mode "use", to create one under a different ' +
        'account, or to make it themselves and pass its address with mode "url".'
      );
    }
    const outcome = await resolveRepo(mode, repo, run);
    if (!outcome.ok) {
      return explainRepoFailure(outcome.cause, repo);
    }
    repoUrl = outcome.url;
  }

  const configured = await configureChannel({ home, machineName, peer, repoUrl });
  if (!configured.ok) {
    return configured.detail;
  }

  return (
    `The channel is set up: "${machineName}" talking to "${peer}", through ${repoUrl}.\n\n` +
    'Two things are still missing, and neither can be done from here.\n\n' +
    'The hooks, which deliver mail into a session, belong in the user own settings file - tell ' +
    'them what to add rather than writing it for them.\n\n' +
    'And the other machine needs the same setup, pointing at the same repository address, with the ' +
    'two names swapped.'
  );
}

export async function isConfigured(home: string): Promise<boolean> {
  try {
    await readFile(configPath(home), 'utf8');
    return true;
  } catch {
    return false;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
