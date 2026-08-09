import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `setupFiles` et non `globalSetup` : ce dernier ne tourne qu'une fois par session, donc en
    // mode watch les trois tests qui lancent le vrai binaire jugeaient le `dist/` du demarrage.
    // Ils passaient sur du code perime - exactement ce que les gardes de fraicheur supprimes
    // appelaient « pire qu'echouer ». Ici la construction a lieu avant chaque fichier de test.
    setupFiles: ['./test/globalSetup.ts'],
  },
});
