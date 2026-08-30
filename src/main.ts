import './style.css';
import { App } from './ui/app';

function demarrer(): void {
  try {
    new App();
  } catch (error) {
    const el = document.getElementById('accueil-etat');
    if (el) el.textContent = `Erreur au demarrage : ${error instanceof Error ? error.message : error}`;
    console.error(error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', demarrer);
} else {
  demarrer();
}
