import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Construit `dist/` avant la suite : trois tests lancent le vrai binaire, et un artefact plus
    // vieux que sa source ne prouve rien. Voir test/globalSetup.ts.
    globalSetup: ['./test/globalSetup.ts'],
  },
});
