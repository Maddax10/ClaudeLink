import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from './core/config.js';
import { OperationLock } from './git/lock.js';
import { GitRepo, MAILBOX_MARKER } from './git/repo.js';
import { Mailbox, NotAMailboxError, mailboxMarkerContent } from './mailbox.js';

/** Aucune conversion de fin de ligne, dans aucun sens : un message doit arriver octet pour octet. */
const GITATTRIBUTES = '* -text\n';

export interface Workspace {
  readonly config: Config;
  readonly workDir: string;
  readonly repoDir: string;
  readonly repo: GitRepo;
  readonly mailbox: Mailbox;
}

/**
 * Ouvre le dossier de travail, en le creant au besoin : clone le depot s'il n'est pas la, et
 * l'amorce s'il est vide. Le dossier de travail vit **hors du dossier de config de Claude**,
 * parce qu'un curseur synchronise entre les deux machines livrerait le courrier une fois sur deux.
 */
export async function openWorkspace(workDir: string, config: Config): Promise<Workspace> {
  const repoDir = join(workDir, 'repo');
  const hooksDir = join(workDir, 'empty-hooks');

  await mkdir(workDir, { recursive: true });
  await mkdir(hooksDir, { recursive: true });

  const repo = new GitRepo(repoDir, config.branch);

  if (!(await exists(join(repoDir, '.git')))) {
    await cloneInto(workDir, repoDir, config);
  }

  await repo.configureLocal(hooksDir);
  await bootstrapIfEmpty(repo, repoDir, config);

  const mailbox = new Mailbox(repo, repoDir, workDir, config, new OperationLock(workDir));
  return { config, workDir, repoDir, repo, mailbox };
}

async function cloneInto(workDir: string, repoDir: string, config: Config): Promise<void> {
  const parent = new GitRepo(workDir, config.branch);
  await parent.run(['clone', '--quiet', config.repoUrl, repoDir]);
}

/**
 * Un depot neuf est vide : pas de branche, pas de marqueur. On y pose le marqueur, les attributs
 * et les deux boites. Le marqueur est ce qui autorisera, plus tard, les gestes destructeurs.
 *
 * **Et seulement un depot vide.** Cette fonction amorcait tout depot sans marqueur, y compris un
 * depot de code plein de commits : elle y ecrivait `mailbox.json`, `.gitattributes`, deux dossiers
 * `messages/` et un commit « init mailbox », **et poussait**. Quelqu'un qui donne le nom de son
 * vrai projet au lieu de celui de sa boite - le cas le plus probable a l'installation - voyait donc
 * son depot modifie. Trouve le 9 aout 2026 par le test d'installation, pas par relecture : le nom
 * de la fonction disait « if empty » et le code ne le verifiait pas.
 */
async function bootstrapIfEmpty(repo: GitRepo, repoDir: string, config: Config): Promise<void> {
  if (await exists(join(repoDir, MAILBOX_MARKER))) {
    return;
  }

  try {
    await repo.fetch();
    await repo.resetHardToRemote();
    if (await exists(join(repoDir, MAILBOX_MARKER))) {
      return;
    }
    // Le fetch a reussi : ce depot a une branche et des commits. Il n'est pas vide, il n'a pas de
    // marqueur, donc ce n'est pas une boite aux lettres - et on n'ecrit rien dedans.
    throw new NotAMailboxError(repoDir);
  } catch (error) {
    if (error instanceof NotAMailboxError) {
      throw error;
    }
    // Le fetch a echoue : le depot n'a ni branche ni commit a recuperer. Il est vide, on l'amorce.
  }

  await writeFile(join(repoDir, MAILBOX_MARKER), mailboxMarkerContent(), 'utf8');
  await writeFile(join(repoDir, '.gitattributes'), GITATTRIBUTES, 'utf8');
  for (const box of [config.machineName, config.peer]) {
    await mkdir(join(repoDir, 'messages', box), { recursive: true });
    // Git ne suit pas les dossiers vides : chaque boite porte un fichier qui la maintient.
    await writeFile(join(repoDir, 'messages', box, '.keep'), '', 'utf8');
  }
  await repo.run(['checkout', '--quiet', '-B', config.branch]);
  await repo.commitAll('init mailbox');
  await repo.run(['push', '--quiet', '--set-upstream', 'origin', `HEAD:${config.branch}`]);
  await repo.fetch();
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EISDIR';
  }
}
