import { defineConfig } from 'vitest/config';

/**
 * Passe RAPIDE — celle qu'on lance avant chaque changement, et sur chaque
 * poussee en integration continue.
 *
 * `test/pipeline.test.ts` rend de vraies images de face au pixel pres et pese
 * a lui seul ~250 des ~280 secondes de la suite complete. Le laisser dans la
 * passe par defaut revient a ne jamais lancer les tests : on finit par coder
 * sans filet. Il est donc sorti d'ici et tourne dans `npm run test:complet`,
 * sur son propre poste d'integration continue, en parallele du reste.
 *
 * `test/_*.test.ts` sont les mesures jetables : on en ecrit pour repondre a une
 * question, on les supprime ensuite. Elles ne doivent jamais faire echouer une
 * passe ni ralentir personne.
 */
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'test/_*.test.ts', 'test/pipeline.test.ts'],
    /**
     * Les suites de vision (detecteur, chaine complete) sont gourmandes en
     * calcul. Les executer en parallele les fait se voler le processeur : les
     * mesures de vitesse deviennent fausses et les tests longs depassent leur
     * delai, sans qu'aucune regression reelle ne soit en cause. On les execute
     * donc fichier par fichier.
     */
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
