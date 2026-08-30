# Avis de licences tierces

Rubik'Scam est distribué sous licence MIT (voir `LICENSE`). Il embarque, dans
le code livré au navigateur, la bibliothèque suivante.

## cubejs

Le solveur Kociemba en deux phases (`src/workers/solver.worker.ts` l'importe et
son code est inclus dans le bundle `solver.worker`).

- Site : https://github.com/ldez/cubejs
- Licence : MIT

```
Copyright (c) 2013-2017 Petri Lehtinen <petri@digip.org>
Copyright (c) 2018 Ludovic Fernandez

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Outils de développement

`typescript` (Apache-2.0), `vite`, `vitest` et `@vitejs/plugin-basic-ssl` (MIT)
ne sont utilisés qu'au développement et ne sont pas livrés au navigateur.
