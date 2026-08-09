import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { type Config, resolveConfig } from './core/config.js';
import { clearAttempts, countAttempt } from './deliver/attempts.js';
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
    //
    // `env` est passe comme partout ailleurs. Sans lui, l'installation clonait et amorcait le depot
    // que la personne avait nomme, pendant que le premier `check_inbox` - qui passe par `loadApp`,
    // lequel applique l'environnement - en ouvrait un autre. Deux depots, un succes affiche, et
    // rien pour dire lequel fait foi.
    config = resolveConfig({ file: { machineName, peer, repoUrl }, env: process.env });
  } catch (error) {
    return { ok: false, cause: 'invalid', detail: describe(error) };
  }

  // Et si l'environnement a effectivement pris le dessus, on le dit : quelqu'un qui a tape une
  // adresse et en voit configurer une autre doit l'apprendre maintenant, pas au premier message.
  if (config.repoUrl !== repoUrl) {
    return {
      ok: false,
      cause: 'invalid',
      detail: `CLAUDE_LINK_REPO_URL is set to ${config.repoUrl} and overrides the address you gave (${repoUrl}). Unset it, or set up the channel with that address.`,
    };
  }

  await mkdir(home, { recursive: true });

  try {
    // `openWorkspace(home, config)` et non `loadApp()` : `loadApp` relit la configuration depuis
    // l'environnement, donc il ouvrirait le canal de la machine plutot que celui qu'on vient de
    // construire. Mesure du 9 aout 2026 : les tests d'installation, sur un home temporaire, ont
    // fait avancer les curseurs du vrai canal. Rien n'a ete perdu ce jour-la - le lot etait vide -
    // mais le meme code lance une minute plus tot aurait mange du courrier jamais montre.
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
    return {
      ok: false,
      cause: error instanceof NotAMailboxError ? 'not-a-mailbox' : 'failed',
      detail: describe(error),
    };
  }

  // `config.json` s'ecrit en dernier, et c'est ce qui rend une tentative ratee reprenable.
  //
  // Il s'ecrivait d'abord : un echec laissait donc un fichier de configuration derriere lui, et
  // toute reprise repondait « deja configure ». La seule issue etait d'effacer ce fichier a la
  // main - ce qu'un modele ne peut pas faire seul, au premier contact de quelqu'un avec le
  // produit. L'existence de ce fichier veut dire « ca a marche », rien d'autre.
  await writeFile(configPath(home), `${JSON.stringify(config, null, 2)}\n`, 'utf8');

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
  const { home, machineName, peer, mode, repo } = request;

  if (await isConfigured(home)) {
    return `This machine already has a channel configured in ${home}. Read config.json there to see it, and remove that file by hand to start over.`;
  }

  let repoUrl = repo;
  if (mode !== 'url') {
    // Compte sur le disque, avant de toucher a `gh` : passe la limite, aucune commande ne part.
    // L'appelant ne fournit plus ce nombre - il le remettait a un a chaque fois sans le vouloir.
    if (mode === 'create' && (await countAttempt(home)) > MAX_NAME_ATTEMPTS) {
      return (
        `Stopping after ${MAX_NAME_ATTEMPTS} attempts at creating a repository from this machine. ` +
        'Rather than proposing another name, tell the user to pick an existing repository with ' +
        'mode "use", to create one under a different account, or to make it themselves and pass ' +
        'its address with mode "url".'
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
  await clearAttempts(home);

  return (
    `The channel is set up: "${machineName}" talking to "${peer}", through ${repoUrl}.\n\n` +
    'Two things are still missing, and neither can be done from here.\n\n' +
    'The hooks deliver mail into a session. They belong in the user own settings file, so show ' +
    `them this rather than writing it for them - the path is already filled in:\n\n${hookBlock()}\n\n` +
    'And the other machine needs the same setup, pointing at the same repository address, with the ' +
    'two names swapped.'
  );
}

/**
 * Le bloc de hooks a coller, avec le chemin reel de cette installation.
 *
 * `install.md` demandait au modele de « remplacer le chemin par celui qu'a affiche l'outil », et
 * l'outil n'affichait aucun chemin : il ne restait qu'a l'inventer ou a le faire chercher, a la
 * derniere etape d'une premiere installation.
 *
 * Une seule forme, celle que `clink init` imprime deja, pour qu'il n'y ait pas deux blocs
 * differents selon la porte par laquelle on est entre.
 */
export function hookBlock(): string {
  // Le chemin est entre guillemets, et ce n'est pas cosmetique : cette chaine est interpretee par
  // un shell. Mesure le 9 aout 2026 sur ce Mac - un chemin contenant une espace se coupe en deux,
  // node cherche un module au nom tronque, et le hook echoue en silence. Personne ne recoit rien
  // et rien ne dit pourquoi. `C:\Users\Jean Dupont\...` est un chemin Windows banal.
  const cliPath = join(dirname(fileURLToPath(import.meta.url)), 'cli.js');
  const command = (kind: string) => `node "${cliPath}" hook ${kind}`;
  return JSON.stringify(
    {
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: command('session-start') }] }],
        Stop: [{ hooks: [{ type: 'command', command: command('stop') }] }],
      },
    },
    null,
    2,
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

/**
 * Un texte, jamais une structure. `resolveConfig` leve une `ZodError`, dont le `message` est un
 * tableau JSON complet - c'est ce qui remontait au modele quand un nom de machine etait refuse,
 * dans le lot qui promettait des echecs lisibles.
 */
function describe(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`).join('; ');
  }
  return error instanceof Error ? error.message : String(error);
}
