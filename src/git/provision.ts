import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Un nom de depot part **en position d'argument** dans `gh repo view <nom>` et
 * `gh repo create <nom>`. C'est exactement la forme qui a coute un correctif de securite ce
 * 9 aout 2026 : `branch` n'etait pas valide, et `--upload-pack=touch temoin` executait la commande
 * en affichant une erreur qui se lisait comme une panne de reseau.
 *
 * Ce motif est donc ecrit avant tout le reste du fichier, et rien ne l'atteint sans y passer.
 * GitHub accepte lettres, chiffres, tiret, souligne et point ; on n'accepte rien d'autre, et jamais
 * en premier caractere autre chose qu'une lettre ou un chiffre.
 */
export const REPO_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function isRepoName(value: string): boolean {
  return REPO_NAME_PATTERN.test(value);
}

/** Le lanceur de `gh`. Injectable pour que les tests ne creent jamais de vrai depot GitHub. */
export type GhRunner = (args: readonly string[]) => Promise<string>;

export type RepoOutcome =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly cause: RepoFailure; readonly detail?: string };

export type RepoFailure =
  | 'bad-name'
  | 'not-found'
  | 'name-taken'
  | 'gh-missing'
  | 'gh-not-logged-in'
  | 'failed';

/**
 * Le depot que l'utilisateur a choisi, dans le mode qu'il a choisi.
 *
 * Deux modes explicites et jamais l'un a la place de l'autre : `use` ne cree rien, `create` ne
 * prend rien d'existant. Chercher un nom par defaut et le prendre s'il existe brancherait un jour
 * le canal sur un depot que personne n'a designe, et la panne serait incomprehensible.
 */
export async function resolveRepo(
  mode: 'use' | 'create',
  name: string,
  run: GhRunner = ghRun,
): Promise<RepoOutcome> {
  if (!isRepoName(name)) {
    return { ok: false, cause: 'bad-name' };
  }

  try {
    if (mode === 'use') {
      return { ok: true, url: readUrl(await run(['repo', 'view', name, '--json', 'url'])) };
    }
    await run(['repo', 'create', name, '--private']);
    return { ok: true, url: readUrl(await run(['repo', 'view', name, '--json', 'url'])) };
  } catch (error) {
    return { ok: false, cause: classify(error, mode), detail: message(error) };
  }
}

function readUrl(stdout: string): string {
  const parsed = JSON.parse(stdout) as { url?: unknown };
  if (typeof parsed.url !== 'string' || parsed.url.length === 0) {
    throw new Error('gh returned no url');
  }
  return `${parsed.url}.git`;
}

/**
 * Trois etats distincts pour `gh`, trois causes distinctes : les confondre, c'est envoyer quelqu'un
 * installer ce qu'il a deja, ou chercher un probleme de droits quand il s'est juste trompe de nom.
 */
function classify(error: unknown, mode: 'use' | 'create'): RepoFailure {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
    return 'gh-missing';
  }
  const text = message(error).toLowerCase();
  if (text.includes('not logged') || text.includes('authentication') || text.includes('gh auth login')) {
    return 'gh-not-logged-in';
  }
  if (mode === 'create' && (text.includes('already exists') || text.includes('name already'))) {
    return 'name-taken';
  }
  if (mode === 'use') {
    // « introuvable » et « pas le droit de le voir » sont indiscernables chez GitHub, et c'est
    // voulu de leur part : repondre autrement dirait a un inconnu quels depots prives existent.
    return 'not-found';
  }
  return 'failed';
}

function message(error: unknown): string {
  const failure = error as { stderr?: string; message?: string };
  return String(failure.stderr ?? failure.message ?? error);
}

async function ghRun(args: readonly string[]): Promise<string> {
  // `gh` recoit l'environnement complet, contrairement a git qui passe par l'allowlist de
  // `gitEnv()`. Son jeton vit dans le trousseau du systeme et il lui faut plus que git pour l'y
  // trouver. C'est un choix constate, pas un oubli : une allowlist demanderait de savoir ce que
  // `gh` lit, et personne ici ne le sait encore.
  const { stdout } = await execFileAsync('gh', [...args], { maxBuffer: 4 * 1024 * 1024 });
  return stdout;
}
