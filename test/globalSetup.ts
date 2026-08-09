import { buildAll } from '../esbuild.mjs';

/**
 * Construit `dist/` avant la suite, et le tient a jour en mode continu.
 *
 * Trois tests lancent le vrai binaire - c'est le seul moyen de prouver qu'un signal emporte une
 * session, qu'un hook livre son courrier, ou qu'un veilleur se tait. Ils jugeaient jusqu'ici la
 * fraicheur de `dist/` en comparant des dates, avec un commentaire qui justifiait ce controle par
 * le fait que `dist/` etait gitignore, donc jamais horodate par un `git checkout`.
 *
 * `dist/` est desormais versionne, et cette justification tombe : apres un clone, git pose des
 * dates arbitraires, et le controle repondrait n'importe quoi - **en passant**, ce qui est pire
 * qu'en echouant.
 *
 * `globalSetup` et non `setupFiles` : le second construisait avant **chaque fichier** de test, et
 * vitest les execute en parallele. Deux esbuild ecrivant `dist/cli.js` en meme temps ont produit un
 * echec intermittent le 9 aout 2026 - un rouge qui disparait au relancement fait perdre confiance
 * dans toute la suite, ce qui coute plus cher que le defaut qu'il signale. Un seul constructeur,
 * et le mode continu est couvert par la surveillance d'esbuild plutot que par des reconstructions
 * concurrentes.
 */
export default async function setup(): Promise<() => Promise<void>> {
  return buildAll({ watch: process.argv.includes('--watch') || process.env.VITEST_MODE === 'WATCH' });
}
