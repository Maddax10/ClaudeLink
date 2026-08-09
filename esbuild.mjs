import { build } from 'esbuild';

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

for (const name of ['mcpServer', 'cli']) {
  await build({ ...common, entryPoints: [`src/${name}.ts`], outfile: `dist/${name}.js` });
}
