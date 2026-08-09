import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gitEnv } from './gitEnv.js';

const execFileAsync = promisify(execFile);

export class GitError extends Error {
  constructor(
    message: string,
    readonly args: readonly string[],
    readonly stderr: string,
  ) {
    super(message);
    this.name = 'GitError';
  }
}

/** Le fichier qui dit « ce depot est une boite aux lettres ». Voir `assertMailbox`. */
export const MAILBOX_MARKER = 'mailbox.json';

/**
 * Les reglages sont **locaux au clone**, jamais herites de la config globale de l'utilisateur.
 * Chacun a deja coute un bug sur un projet voisin :
 *
 * - `core.autocrlf=false` : sinon Windows reecrit les fins de ligne et chaque message revient
 *   modifie chez l'autre machine ;
 * - `core.hooksPath` vide : un hook global de l'utilisateur ne doit pas tourner ici ;
 * - `commit.gpgsign=false` : un gpgsign global demanderait une passphrase a un processus
 *   d'arriere-plan, qui resterait suspendu ;
 * - `core.quotepath=false` : sinon git echappe en octal tout chemin non-ASCII qu'on affiche ;
 * - `core.precomposeunicode=true` : le NFD de macOS contre le NFC de Windows produit un diff
 *   qui ne se stabilise jamais sur un nom accentue.
 */
const LOCAL_CONFIG: ReadonlyArray<readonly [string, string]> = [
  ['core.autocrlf', 'false'],
  ['core.quotepath', 'false'],
  ['core.precomposeunicode', 'true'],
  ['commit.gpgsign', 'false'],
  ['user.name', 'claude-link'],
  ['user.email', 'link@local'],
];

export class GitRepo {
  constructor(
    private readonly dir: string,
    private readonly branch: string,
  ) {}

  async run(args: readonly string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', [...args], {
        cwd: this.dir,
        env: gitEnv(),
        maxBuffer: 32 * 1024 * 1024,
        // Sans ceci, Windows ouvre une fenetre de console a chaque lancement. Le veilleur appelle
        // git toutes les `pollSeconds`, et le hook de fin de tour a chaque tour de chaque fenetre :
        // ca clignote en permanence sur l'ecran de quelqu'un qui travaille. Sans effet ailleurs.
        windowsHide: true,
      });
      return stdout;
    } catch (error) {
      const stderr = String((error as { stderr?: string }).stderr ?? '');
      throw new GitError(`git ${args[0] ?? ''} failed: ${redact(stderr).trim()}`, args, redact(stderr));
    }
  }

  /** Applique les reglages locaux. `hooksPath` recoit un dossier vide fourni par l'appelant :
   *  le core ne cree pas de dossier lui-meme. */
  async configureLocal(emptyHooksDir: string): Promise<void> {
    for (const [key, value] of LOCAL_CONFIG) {
      await this.run(['config', '--local', key, value]);
    }
    await this.run(['config', '--local', 'core.hooksPath', emptyHooksDir]);
  }

  async fetch(): Promise<void> {
    await this.run(['fetch', '--quiet', 'origin', this.branch]);
  }

  async remoteHead(): Promise<string> {
    return (await this.run(['rev-parse', `origin/${this.branch}`])).trim();
  }

  async isAncestor(maybeAncestor: string, descendant: string): Promise<boolean> {
    try {
      await this.run(['merge-base', '--is-ancestor', maybeAncestor, descendant]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Les fichiers **ajoutes** entre deux commits, dans l'ordre des commits.
   *
   * `--diff-filter=A` n'est pas un detail : sans lui, la purge de retention, qui supprime des
   * fichiers, ferait relivrer tous les messages qu'elle vient d'effacer.
   */
  async addedFiles(fromSha: string | undefined, toSha: string, pathPrefix: string): Promise<string[]> {
    const range = fromSha === undefined ? [toSha] : [`${fromSha}..${toSha}`];
    const stdout = await this.run([
      'log',
      '--reverse',
      '--diff-filter=A',
      '--name-only',
      '--format=',
      ...range,
      '--',
      pathPrefix,
    ]);
    const seen = new Set<string>();
    for (const line of stdout.split('\n')) {
      const path = line.trim();
      if (path.length > 0) {
        seen.add(path);
      }
    }
    return [...seen];
  }

  async fileAt(sha: string, path: string): Promise<string> {
    return this.run(['show', `${sha}:${path}`]);
  }

  async listTree(sha: string, pathPrefix: string): Promise<string[]> {
    const stdout = await this.run(['ls-tree', '-r', '--name-only', sha, '--', pathPrefix]);
    return stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  }

  /**
   * Remet l'arbre de travail sur l'etat distant. Destructeur par nature, donc jamais appele
   * sans `assertMailbox` : c'est exactement le geste qui, sur un projet voisin, a efface le
   * mauvais depot parce que deux appelants ne passaient pas par le meme garde.
   */
  async resetHardToRemote(): Promise<void> {
    await this.run(['reset', '--hard', `origin/${this.branch}`]);
  }

  async commitAll(message: string): Promise<void> {
    await this.run(['add', '--all']);
    await this.run(['commit', '--quiet', '--message', message]);
  }

  async push(): Promise<void> {
    await this.run(['push', '--quiet', 'origin', `HEAD:${this.branch}`]);
  }

  async hasStagedOrUnstagedChanges(): Promise<boolean> {
    return (await this.run(['status', '--porcelain'])).trim().length > 0;
  }
}

/** Les erreurs de git recrachent les URLs verbatim, credentials compris. */
export function redact(text: string): string {
  return text.replace(/(https?:\/\/)[^@\s/]+@/gi, '$1***@');
}

export function isNonFastForward(error: unknown): boolean {
  return error instanceof GitError && /non-fast-forward|fetch first|rejected/i.test(error.stderr);
}
