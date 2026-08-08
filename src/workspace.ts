import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from './core/config.js';
import { OperationLock } from './git/lock.js';
import { GitRepo, MAILBOX_MARKER } from './git/repo.js';
import { Mailbox, mailboxMarkerContent } from './mailbox.js';

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
  } catch {
    // Depot encore vide : il n'a ni branche ni commit a recuperer. On l'amorce ci-dessous.
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
