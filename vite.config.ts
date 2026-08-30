import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const portDemande = env?.PORT;

/**
 * HTTPS a la demande, pour tester sur telephone.
 *
 * Les navigateurs n'ouvrent la camera qu'en contexte securise : `localhost` ou
 * HTTPS. Sur telephone on arrive par l'IP du reseau local, donc il FAUT du
 * HTTPS. Vite 7 n'a plus de drapeau `--https` : le certificat auto-signe passe
 * par ce greffon. `npm run dev:https` pose HTTPS=1 et l'active.
 */
const httpsDemande = env?.HTTPS === '1' || env?.HTTPS === 'true';

export default defineConfig({
  base: './',
  plugins: httpsDemande ? [basicSsl()] : [],
  // Le port vient de l'environnement quand l'hote en impose un (previews,
  // conteneurs), sinon 5173 par defaut. Lu via globalThis pour ne pas exiger
  // les types Node dans un projet qui n'en a pas besoin par ailleurs.
  server: { host: true, port: Number(portDemande) || 5173 },
  preview: { host: true, port: 4173 },
  worker: { format: 'es' },
  optimizeDeps: { include: ['cubejs'] },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
