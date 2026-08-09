import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Construit `dist/` avant chaque fichier de test.
 *
 * Trois tests lancent le vrai binaire - c'est le seul moyen de prouver qu'un signal emporte une
 * session, qu'un hook livre son courrier, ou qu'un veilleur se tait. Ils jugeaient jusqu'ici la
 * fraicheur de `dist/` en comparant des dates, avec un commentaire qui justifiait ce controle par
 * le fait que `dist/` etait gitignore, donc jamais horodate par un `git checkout`.
 *
 * `dist/` est desormais versionne, et cette justification tombe : apres un clone, git pose des
 * dates arbitraires, et le controle repondrait n'importe quoi - **en passant**, ce qui est pire
 * qu'en echouant. Construire est vrai partout, sur n'importe quelle machine, et ne depend d'aucune
 * date. Ca rattrape aussi `npx vitest run` lance a la main, qui contourne le `pretest` de npm.
 *
 * `setupFiles` et non `globalSetup` : le second ne tourne qu'une fois par session, donc en mode
 * watch un fichier modifie etait teste contre le `dist/` du demarrage - le bug meme que les gardes
 * de fraicheur attrapaient. esbuild met une fraction de seconde, le payer par fichier est sans
 * commune mesure avec un test vert sur du code perime.
 */
export default async function setup(): Promise<void> {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  await execFileAsync(process.execPath, [join(root, 'esbuild.mjs')], { cwd: root });
}
