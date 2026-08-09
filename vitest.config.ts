import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Voir test/globalSetup.ts : un seul constructeur pour toute la session, qui surveille en mode
    // continu. `setupFiles` construirait avant chaque fichier, et vitest les lance en parallele.
    globalSetup: ['./test/globalSetup.ts'],
  },
});
