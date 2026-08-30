# Contribuer

Merci de l'intérêt. Ce projet a une règle de travail, une seule, et tout le
reste en découle.

## Mesurer avant de corriger

**Aucun correctif n'entre ici sur la foi d'un raisonnement.** Trois hypothèses
séduisantes ont déjà été tuées par la mesure dans ce dépôt :

- « l'image de la webcam est en miroir, il faut la retourner » → dé-miroiter
  donnait exactement le même résultat sur les captures réelles ;
- « un vrai cube respecte un schéma de couleurs, servons-nous-en » → 0 détection
  sur 15 arrangements faux ;
- « les faces opposées permettent de détecter une erreur » → 0 sur 15.

Chacune aurait ajouté du code permanent pour rien.

Donc, concrètement :

1. Écris d'abord un test qui **mesure** le problème, avec un chiffre.
2. Corrige.
3. Montre que le chiffre a bougé.
4. Si la mesure ne montre aucun effet, **retire le code** plutôt que de le
   garder « au cas où ».

Les mesures jetables se nomment `test/_quelquechose.test.ts` : elles sont
exclues des passes de tests et se suppriment une fois la question tranchée.

## Lancer les tests

```bash
npm test           # passe rapide, ~2 min
npm run test:complet   # tout, y compris le rendu au pixel (~6 min)
```

Ne lance jamais la suite en tâche de fond pendant que tu édites des fichiers :
le verdict ne veut alors plus rien dire.

## Style

- Le code, les commentaires et l'interface sont **en français**. Garde-le ainsi.
- Un commentaire explique **pourquoi**, pas quoi. Si le pourquoi est une mesure,
  cite le chiffre.
- La géométrie du cube est **dérivée**, jamais tapée à la main : voir
  `src/core/geometry.ts`. N'écris pas de table de permutations en dur.

## Vie privée

Ce projet allume une caméra et **ne fait sortir aucune donnée de l'appareil**.
Toute contribution qui ajoute un appel réseau, une télémétrie, un stockage
persistant, une police ou une ressource distante sera refusée. Cette propriété
se vérifie en une commande :

```bash
grep -rE "fetch\(|XMLHttpRequest|WebSocket|sendBeacon|https?://" src/ index.html
```

Elle doit rester sans résultat, hors `data:` URI.
