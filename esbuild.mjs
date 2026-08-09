import { context } from 'esbuild';

/**
 * Deux bundles autonomes, parce que le produit a deux points d'entree : le serveur MCP pour les
 * outils, et le CLI pour les hooks que Claude Code lance a chaque fin de tour.
 *
 * Pourquoi bundler plutot que livrer la sortie de `tsc` : un plugin installe depuis GitHub est un
 * `git clone`, sans `npm install`. Sans ses dependances, le serveur ne demarre pas - et il ne
 * pourrait meme pas dire pourquoi, puisqu'il est lui-meme du node. Mesure du 9 aout 2026 :
 * `node_modules` complet pese 86 Mo et 6 802 fichiers, dont un binaire compile pour macOS ARM qui
 * ne servirait a personne ailleurs. Deux fichiers valent mieux.
 */
const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  // Sans ceci, un `import` de dependance CommonJS casse a l'execution en ESM bundle.
  banner: { js: "import { createRequire as __cr } from 'node:module';\nconst require = __cr(import.meta.url);" },
  logLevel: 'warning',
};

/**
 * Construit les deux bundles, et rend de quoi arreter la surveillance si on l'a demandee.
 *
 * `watch` sert aux tests en mode continu : ils lancent le vrai binaire, donc `dist/` doit suivre le
 * code edite. Un seul constructeur pour toute la session, jamais un par fichier de test - vitest
 * execute les fichiers en parallele, et deux esbuild ecrivant `dist/cli.js` en meme temps ont
 * produit un echec intermittent le 9 aout 2026, ce qui est pire qu'un test franchement rouge.
 */
export async function buildAll({ watch = false } = {}) {
  const contexts = await Promise.all(
    ['mcpServer', 'cli'].map((name) =>
      context({ ...common, entryPoints: [`src/${name}.ts`], outfile: `dist/${name}.js` }),
    ),
  );

  await Promise.all(contexts.map((ctx) => ctx.rebuild()));

  if (watch) {
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    return async () => {
      await Promise.all(contexts.map((ctx) => ctx.dispose()));
    };
  }

  await Promise.all(contexts.map((ctx) => ctx.dispose()));
  return async () => {};
}

// Lance directement : `node esbuild.mjs`.
if (import.meta.url === `file://${process.argv[1]}`) {
  await buildAll();
}
