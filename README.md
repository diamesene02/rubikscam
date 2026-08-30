# Rubik'Scam

[![CI](https://github.com/diamesene02/rubikscam/actions/workflows/ci.yml/badge.svg)](https://github.com/diamesene02/rubikscam/actions/workflows/ci.yml)
[![Licence MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)
[![Aucun réseau](https://img.shields.io/badge/données-100%25%20locales-brightgreen.svg)](#vie-privée)

Scanner et guide de résolution de Rubik's Cube, dans le navigateur.
Tu montres les 6 faces à la caméra, l'application lit les couleurs, calcule la
solution, **puis éteint la caméra** et t'affiche les mouvements un par un : la
couleur à mettre en haut, puis le geste à faire.

Fonctionne sur **téléphone** (caméra arrière) comme sur **ordinateur** (webcam).
Aucune installation, aucun serveur : tout tourne dans la page.

---

## Vie privée

**Aucune image ne quitte votre appareil.** Ce n'est pas une promesse, c'est une
propriété du code, et elle se vérifie en une commande :

```bash
grep -rE "fetch\(|XMLHttpRequest|WebSocket|sendBeacon|https?://" src/ index.html
```

Elle ne renvoie rien (hors une `data:` URI pour l'icône). Concrètement :

- **Aucun réseau.** Pas d'analytics, pas de télémétrie, pas de CDN, pas de police
  distante. Les polices sont celles du système.
- **Aucun enregistrement.** Ni `localStorage`, ni IndexedDB, ni cookie, ni cache,
  ni service worker. Fermer l'onglet efface tout.
- **Les images ne survivent pas à l'instant.** Chaque image est dessinée dans un
  canvas en mémoire, mesurée, puis jetée. Il n'en reste que **54 couleurs
  moyennes**, une par sticker. Aucune image n'est convertie en fichier, en `blob`
  ni en `data:` URL. Seules les 9 cases de la face détectée sont échantillonnées,
  jamais le décor derrière.
- **Le micro n'est jamais demandé** (`audio: false`). Les seules permissions
  demandées sont la caméra et le verrou d'écran, pour que l'écran ne s'éteigne
  pas pendant que vous tournez le cube.

**Quand la caméra est allumée.** Elle démarre au clic sur « Activer la caméra »
et s'éteint au clic sur « Résoudre ». Elle reste donc allumée pendant l'écran de
vérification des couleurs, qui peut durer plusieurs minutes, et elle n'est pas
coupée si l'onglet passe en arrière-plan. C'est un défaut connu, pas un choix.

**Le bouton « Copier le diagnostic »** met dans votre presse-papier les mesures
de couleur, l'état lu du cube, la solution calculée et la définition de la
caméra — **aucune image, aucun identifiant, aucun nom d'appareil**. C'est vous
qui décidez où le coller. La même chaîne est écrite dans la console du
navigateur quand une lecture est incohérente.

---

## Démarrer

```bash
npm install
npm run dev
```

Puis ouvre `http://localhost:5173`.

### Sur ton téléphone

Les navigateurs n'autorisent la caméra qu'en **HTTPS** (ou sur `localhost`). Deux
options :

```bash
npm run dev:https      # certificat auto-signé, à accepter sur le téléphone
```

…puis ouvre l'adresse réseau affichée par Vite depuis le téléphone. Ou bien
déploie (voir plus bas) : c'est plus simple et l'app est alors installable
depuis le navigateur, comme une application.

### Sans cube sous la main

Le bouton **« Essayer sans cube (demo) »** génère un cube mélangé et déroule
tout le guidage, sans caméra.

---

## Comment ça marche

```
caméra ─▶ détection de la face ─▶ échantillonnage ─▶ lecture des couleurs ─▶ validation
                                                                                 │
                       guidage en direct ◀── solveur (worker) ◀──────────────────┘
```

### 1. Trouver la face (`src/media/detector.ts`)

Pas de cadre fixe à viser : l'application **cherche le cube dans l'image**.
Demander à l'utilisateur de faire coïncider son cube avec un cadre ne marche
pas — avec une webcam grand-angle, le cube occupe une petite partie de l'image
et le cadre échantillonne le visage et le mur.

Les stickers sont des zones uniformes séparées par des joints sombres. On marque
donc comme « bord » les forts gradients et les pixels sombres ; les composantes
connexes restantes sont des stickers candidats ; on cherche le meilleur **réseau
3×3** parmi eux ; enfin on vérifie que les joints sont bien plus sombres que les
cases.

Le réseau est **affine**, pas un carré aligné sur l'image : personne ne tient son
cube parfaitement de face, et un cube incliné se projette en parallélogramme.
Les deux vecteurs de la maille sont élus par vote sur les écarts entre stickers,
puis recalés aux moindres carrés sur les stickers effectivement trouvés — ce
recalage absorbe la perspective.

Trois contraintes font toute la **spécificité**, et les relâcher se paie
immédiatement : un sticker candidat doit avoir la taille d'une case du réseau ;
la maille doit rester quasi carrée (angle 60–120°, longueurs à ±40 %) ; et les
joints doivent être nettement plus sombres que les cases. Sans elles, le
détecteur s'accroche à un mur, un t-shirt ou un visage, et le réseau « danse »
d'une image à l'autre.

Le seuil « pixel sombre » demande deux précautions, et l'oubli de la seconde
rendait le scan **impossible dans une pièce aux murs clairs** :

- il est calé sur un **bas percentile** de luminance, pas sur la moyenne — un
  mur clair fait monter la moyenne, et le seuil avec elle ;
- surtout, un pixel n'est un joint que s'il est sombre **et gris**. Un sticker
  bleu a une luminance d'environ 70 : dès qu'un mur clair entre dans le champ,
  il passe sous le seuil d'obscurité et se fait effacer comme un joint. Le
  détecteur ne voyait alors plus que 6 stickers sur 9 et renonçait. Les joints
  d'un cube sont noirs (saturation quasi nulle) ; les stickers, même sombres,
  sont franchement colorés.

Ce seul correctif a fait passer la détection de 34/40 à **40/40** sur petit
cube, et supprimé toutes les images perdues.

*Mesuré : 100 % de détections justes sur petit comme sur moyen cube ; détection
maintenue de 0° à 45° de rotation et jusqu'à ~10 % de perspective ; 0 faux
positif sur fond seul ; réseau stable à ±0,8 % en taille et ±0,4° en angle d'une
image à l'autre, sans aucune image perdue ; 5,6 ms par image, et l'application
ne relance la recherche qu'une image sur deux une fois le cube accroché.*

Limite assumée : au-delà d'environ 20 % de perspective (cube franchement
incliné), le modèle affine ne suffit plus. L'application le dit alors plutôt que
de lire n'importe quoi.

### 2. N'accepter une face que si l'image a changé

Une capture prend moins d'une seconde. Sans verrou, l'application enregistre
plusieurs fois **la même face** avant que la main ait eu le temps de tourner le
cube — c'est le premier bug remonté par l'usage réel. Une nouvelle capture n'est
donc acceptée que si la lecture diffère nettement de **toutes** les faces déjà
enregistrées, comparaison faite **à luminosité normalisée** : sinon, allumer une
lampe entre deux captures suffirait à faire passer la même face pour une
nouvelle.

Un second filet, indépendant de toute la chaîne de vision, s'appuie sur une
certitude physique : **il n'existe qu'un centre de chaque couleur sur un cube**.
Il est appliqué à la fin du scan et **signale** la face en double, sans jamais
bloquer une capture — voir « Deux garde-fous essayés puis retirés » plus bas
pour la mesure qui a conduit à ce choix.

#### Ne jamais rester bloqué

Le deuxième bug remonté par l'usage réel : l'application avait une lecture
parfaite sous les yeux et refusait de la capturer pendant quarante secondes.
Elle exigeait que les **pixels bruts** soient stables à 9/255 près sur dix
images d'affilée — impossible à main levée avec un reflet qui bouge — et
**doublait** cette exigence quand l'image était jugée mauvaise, durcissant la
contrainte précisément quand l'utilisateur pouvait le moins la satisfaire.

Désormais la stabilité se juge sur la lecture **consolidée** (la médiane
temporelle, qui ne tremble pas), l'exigence ne se durcit jamais, et au bout de
quelques secondes à voir le cube l'application capture de toute façon : une
lecture imparfaite qui sera vérifiée puis relue vaut mieux qu'une attente sans
fin.

### 3. Mesurer les couleurs (`src/media/sampler.ts`)

Deux robustesses qui font plus pour la fiabilité que n'importe quel raffinement
d'algorithme :

- **spatiale** — dans chaque case, les pixels sont triés par clarté et seule une
  bande basse-médiane est conservée : le haut de la distribution, ce sont les
  reflets ; le bas, les joints noirs ;
- **temporelle** — un reflet se déplace quand la main bouge, la couleur du
  sticker non. On garde plusieurs images et on retient un percentile bas.

### 4. Montrer des couleurs franches, pas les couleurs mesurées

Le patron de vérification affichait la couleur **telle que mesurée**. Dans un
salon le soir, cela donne du vert sauge, du mint pâle, du saumon : l'utilisateur
voit de la boue, ne peut rien vérifier, et conclut — à juste titre — que la
lecture est fausse alors qu'elle peut être correcte.

Chaque groupe appris est donc associé à la couleur de cube franche la plus
proche (affectation optimale sur les 6), et c'est **elle** qui est affichée. La
mesure brute reste accessible via le bouton de diagnostic. Un compteur par
couleur (« 9 / 9 ») complète l'écran : un cube a exactement neuf stickers de
chaque couleur, et afficher le compte transforme une correction à l'aveugle en
simple mise à niveau de deux nombres.

### 5. Décider de la couleur (`src/core/color.ts`)

Le seul vrai problème d'un scanner de cube, c'est de séparer **rouge et orange**
(et blanc/jaune) sous un éclairage quelconque. Quatre idées portent la fiabilité :

1. **Métrique de chromaticité masquée.** On ne compare pas des couleurs brutes
   mais leur *direction*, la luminosité étant réestimée par moindres carrés pour
   chaque sticker — un sticker à l'ombre donne la même distance qu'en pleine
   lumière. Le modèle est affine : `échantillon ≈ k · référence + v · blanc`, où
   `v` capture le **voile spéculaire**. Sans ce terme, un simple reflet suffit à
   faire lire un rouge comme un orange.
2. **Les canaux saturés sont une inégalité, pas une perte.** Un canal à 255 dit
   « la vraie valeur vaut au moins ça » : une référence qui prédit du sombre sur
   ce canal est donc incompatible. On l'exploite au lieu de jeter la mesure.
3. **Affectation globale sous contrainte.** Un cube a exactement 9 stickers de
   chaque couleur. On résout l'affectation optimale des 54 stickers aux 6
   couleurs (algorithme hongrois) au lieu de prendre 54 décisions indépendantes.
   Les 6 centres servent d'ancres certaines.
4. **A priori de palette.** Les 6 couleurs d'un cube sont connues à une
   transformation d'éclairage globale près ; cet ancrage empêche les références
   apprises de dériver. L'éclairage de chaque face est estimé séparément
   (3 gains par face, modèle de von Kries).

### 6. Le geste fait dans l'autre sens

C'est le défaut le plus coriace rencontré en usage réel, et le plus trompeur.
Dans une pièce mal éclairée, en tenant un cube d'une main, on tourne une fois
sur deux du mauvais côté : on présente alors **une autre face que celle
attendue**, ou la bonne face tournée d'un quart de tour.

Le symptôme induit en erreur : les couleurs lues sont parfaites — le compteur
affiche bien 9 stickers de chaque — mais les **pièces** sont impossibles, « le
coin URF n'existe pas ou est en double ». Ce n'est pas une erreur de couleur.
Il n'y a rien à corriger sticker par sticker : c'est le placement des faces les
unes par rapport aux autres qui est faux, et aucune correction manuelle
raisonnable n'en vient à bout.

On cherche donc, parmi tous les placements possibles — quelle face va à quelle
position, et tournée comment — celui qui donne un cube physiquement valide. Sans
élagage l'espace fait 6! × 4⁶ ; en posant les faces une à une et en vérifiant
chaque pièce dès qu'elle est déterminée, il s'effondre à quelques dizaines de
millisecondes.

La recherche procède par **approfondissement progressif** : d'abord sans aucun
déplacement, puis à un déplacement près, etc. Ce détail n'est pas cosmétique —
sans lui, la recherche renvoie la première solution rencontrée, qui peut être
très éloignée du scan réel, et transforme alors une lecture douteuse en cube
**valide mais faux**, qu'on résoudrait sans jamais s'en apercevoir. Mesuré : le
taux de mensonge silencieux double si l'on prend la première solution venue.

Seuls les **déplacements** sont comptés ; une face tournée est gratuite, parce
que ce n'est pas une erreur de l'utilisateur — le détecteur ignore où se trouve
le haut du cube, une rotation est donc attendue.

Conséquence pour l'utilisateur : **les gestes affichés deviennent une suggestion,
plus une obligation**. Montre les 6 faces dans l'ordre que tu veux, tournées
comme tu veux.

Un détail a son importance : les lettres produites par le classifieur ne sont
que des **noms de groupes de couleur**, elles n'affirment rien sur la géométrie.
C'est cette recherche, et elle seule, qui décide quelle face va où.

Autre piège vérifié sur un cube réel : le centre porte souvent le **logo de la
marque**, un texte sombre imprimé sur le sticker. La bande basse-médiane, conçue
pour rejeter les reflets, retient justement ce texte et fausse la couleur du
centre — la plus importante de toutes, puisqu'elle sert d'ancre au classement.
Le centre est donc lu dans une bande médiane-haute : au-dessus du logo, en
dessous des reflets.

### 7. Ne jamais reprendre la main après les 6 faces

Une version intermédiaire renvoyait d'autorité l'utilisateur relire une face
quand le cube lu était impossible. En usage réel, cela l'enfermait dans une
boucle : l'application redemandait sans fin une face qu'il n'arrivait pas à
faire accepter, sans lui dire laquelle ni comment en sortir.

La règle est maintenant simple : **après les 6 faces, on arrive toujours à
l'écran de vérification**. L'utilisateur y voit tout le cube, corrige un sticker
d'un appui, et peut demander lui-même une relecture — bouton qui affiche la
pastille de couleur de la face concernée, pour qu'il sache laquelle présenter.
Toute redirection automatique a été supprimée.

### 8. Vérifier, réparer, relire (`src/core/cube.ts`, `src/core/repair.ts`)

Une seule couleur mal lue produit un cube **physiquement impossible**. On vérifie
donc systématiquement : 9 stickers par couleur, centres à leur place, 8 coins et
12 arêtes existants et uniques, somme des orientations de coins ≡ 0 (mod 3), des
arêtes ≡ 0 (mod 2), et même parité de permutation entre coins et arêtes.

Si le cube est incohérent, on cherche la correction **la moins coûteuse** qui le
rend valide : une face entière tournée d'un quart de tour (erreur de tenue), deux
étiquettes interverties, un cycle de trois, deux paires. Et si le doute persiste,
l'application **relit d'elle-même** la face la plus suspecte.

Rien n'est jamais affirmé en silence : si le cube reste incohérent, l'écran de
correction manuelle s'ouvre, avec les stickers douteux encadrés.

### 9. Résoudre (`src/workers/solver.worker.ts`)

Algorithme de Kociemba en deux phases (via `cubejs`), dans un **Web Worker** :
la construction des tables (~2,5 s) démarre au chargement de la page, pendant que
tu scannes, donc elle est toujours finie quand on en a besoin — et l'interface
n'est jamais figée. Chaque solution est **rejouée et vérifiée** avant d'être
proposée.

Profondeur 22 : ~170 ms en moyenne pour ~22 mouvements. Descendre à 21 ne gagne
que 0,8 mouvement mais peut bloquer plusieurs dizaines de secondes sans
interruption possible — mesuré, puis écarté.

### 10. Guider sans caméra (`src/core/consigne.ts`)

**La caméra s'éteint dès les 6 faces lues.** C'était un choix, et il s'est
révélé décisif : tant qu'elle restait allumée, l'utilisateur devait à la fois
tourner son cube et le tenir cadré, et la moindre lecture douteuse réécrivait un
état pourtant correct. Après le scan, l'application connaît l'état complet du
cube — elle n'a plus rien à apprendre d'une image.

Chaque consigne tient donc en deux temps, et ne suppose **aucun point de vue** :

1. « Mets le **ROUGE** en haut » — une couleur, pas un nom de face. `R`, `F` ou
   `B` ne veulent rien dire quand on retourne le cube dans sa main.
2. « La rangée la plus proche de toi part vers la **GAUCHE** » — une rangée
   nommée par sa position par rapport au corps, jamais « sens horaire », qui
   dépend du côté d'où l'on regarde.

Une face peut arriver **en haut** ou **devant** : parmi les 8 prises qui
conviennent, l'application choisit celle qui est la plus proche de la prise
actuelle. Le calcul est une table de distances 24 × 24 construite par parcours
en largeur (`distancePrise`, `src/core/geometry.ts`).

Effet mesuré sur 410 mouvements / 20 cubes : **27,6 → 15,2 quarts de tour** de
repositionnement par résolution, et **100 % des reprises en un seul quart**.

`src/core/tracking.ts` conserve la machinerie de suivi image par image (les 24
prises, l'anticipation, les 18 mouvements possibles). Elle n'est plus branchée
sur l'écran de résolution — `allowDeviation: false` — mais reste testée et
utilisable si l'on veut y revenir.

---

## Fiabilité mesurée

Tous les chiffres viennent de la suite de tests (`npm test`), pas d'une
impression. Le test décisif (`test/pipeline.test.ts`) travaille **au niveau
pixel** : il fabrique de vraies images de face (joints, dégradé d'éclairage,
reflet spéculaire mobile, bruit capteur, cadrage imprécis, auto-exposition), puis
fait tourner le vrai échantillonneur et le vrai classifieur. Rien n'est
court-circuité.

Chaque scénario inclut désormais un cube **tenu de biais** (rotation et
perspective), puisque c'est ainsi qu'on tient un cube dans la vraie vie.

Dernier relevé de `npm run test:complet`. Les scénarios tirent au sort reflets,
éclairage et cadrage : d'une exécution à l'autre les deux premières colonnes
bougent de quelques points.

| Conditions | Exacte du 1er coup | **Exacte au final** | Mensonge silencieux |
| --- | --- | --- | --- |
| Bon éclairage, incliné jusqu'à 10° | 90 % | **100 %** | **0 %** |
| Réalistes : reflets, dérive de blancs, ombrage, incliné jusqu'à 22° | 73 % | **93 %** | **0 %** |
| Hostiles : reflet quasi systématique et intense, incliné jusqu'à 30° | 6 % | 33 % | **0 %** |

L'écart entre « 1er coup » et « final » est tenu par la boucle de rattrapage :
réparation de la lecture, puis recherche des faces présentées tournées.

En conditions hostiles, l'application ne prétend plus lire : elle refuse les
images brûlées et dit qu'elle ne voit pas de cube. **Un cube sur trois seulement
est lu**, et c'est assumé : un vrai utilisateur déplacerait le cube ou
allumerait une lampe plutôt que d'insister. Le taux de réussite n'y a donc guère
de sens.

La mesure qui compte est le **mensonge silencieux** : déclarer valide un cube qui
ne l'est pas, et le résoudre sans que personne s'en aperçoive. Il est mesuré à
**0 % dans les trois conditions**. Le test ne l'exige toutefois qu'à **12 % au
plus** en conditions hostiles : à ce niveau de dégradation (18 stickers faux en
moyenne à la première lecture), promettre la perfection serait promettre ce
qu'on ne sait pas tenir.

Une seconde mesure, distincte, porte sur la **recherche de placement** quand
deux faces ont été scannées dans le désordre (`test/placement.test.ts`, 200
scans) : 200 lectures déclarées valides, **195 justes, 5 fausses** — et les
**5 sur 5** sont signalées à l'utilisateur comme ambiguës, avec l'autre lecture
possible proposée. Aucune ne passe en silence.

Ce n'était pas gratuit : la recherche de placement l'avait fait monter à 11 %
en « réparant » des lectures douteuses en cubes plausibles mais faux. C'est
l'approfondissement progressif — chercher d'abord la correction minimale — qui
l'a ramené à zéro.

Vérifié aussi de bout en bout **dans l'interface**, en branchant une caméra
synthétique sur l'application réelle. Trois scénarios, tous passés sans aucune
erreur de lecture :

- cube tenu de biais dans un décor encombré (mur, épaule, visage), utilisateur
  simulé mettant une seconde et demie à tourner le cube, main tremblante
  comprise — scan complet en 10 s à 31 images/s ;
- **une face présentée tournée d'un quart de tour** — corrigée toute seule :
  « la face R était tournée de 270° pendant le scan » ;
- **lumière faible et chaude**, celle d'un salon le soir — scan en 10,8 s,
  6 couleurs franches affichées, 9 / 9 pour chacune.

Et deux scénarios de refus, tout aussi importants : une étagère 3×3 à cases
brunes avec joints sombres (piège volontaire) n'est jamais capturée, et
quelqu'un qui remontre obstinément la même face pendant 12 secondes n'obtient
qu'une seule capture.

---

## Quand la caméra brûle le blanc

Le cas le plus instructif est venu d'un vrai scan, dans une pièce sombre, sur
un vrai cube. L'auto-exposition de la webcam pousse le gain à fond et les neuf
stickers blancs ressortent tous à `(255, 255, 255)` : trois canaux saturés,
information intégralement détruite. Le classifieur faisait alors **19 erreurs
sur 54** — huit rouges lus comme du blanc, le vert coupé en deux groupes.

Deux corrections, toutes deux vérifiées sur ces mesures réelles
(`test/scanReel.test.ts`) :

1. **Une mesure saturée sur les trois canaux ne peut être que du blanc.** Ce
   n'est pas une heuristique mais une certitude physique : le blanc est la
   seule couleur d'un cube claire sur les trois canaux. Le bleu et le vert
   n'ont pas de rouge, le rouge et l'orange n'ont pas de bleu, le jaune n'a pas
   de bleu. Un **centre** saturé est donc le centre blanc, et cette lecture
   prime sur l'appariement de palette : une fois brûlés, blanc et jaune se
   ressemblent assez pour que l'appariement intervertisse les deux groupes
   entiers.

2. **La moyenne d'un groupe compte les canaux valides séparément.** Un canal
   saturé était bien exclu de la somme, mais pas du diviseur. Un groupe dont
   tous les membres saturent recevait donc la référence `(0, 0, 0)` — du noir —
   et aspirait n'importe quelle autre couleur. Quand un canal n'a aucune mesure
   exploitable, sa référence est maintenue au moins au niveau de saturation,
   ce que toutes les observations affirment.

Résultat sur ce scan : **54 stickers sur 54**, six groupes purs.

La leçon générale : avant d'ajuster un coefficient, vérifier que l'information
est encore là. Ici elle l'était pour cinq couleurs sur six, et la sixième se
déduisait d'une contrainte physique — pas d'un meilleur réglage.

## Deux garde-fous essayés puis retirés

Ils sont documentés ici parce que l'erreur qu'ils illustrent est facile à
refaire : un contrôle qui protège en théorie peut, en pratique, **empêcher
l'utilisateur d'avancer** — ce qui est bien pire que le risque qu'il écarte.

- **« Ces couleurs ne sont pas celles d'un cube. »** Sous une lampe chaude et
  faible, un bleu de cube se mesure `[12, 32, 66]`, dont la chromaticité brute
  est très loin du bleu canonique : le filtre rejetait le vrai cube et bloquait
  le scan. Corrigé de la balance des blancs, il devenait à l'inverse si
  permissif qu'un mur passait. C'est la **spécificité du détecteur** qui tient
  ce rôle, et elle le tient : 0 faux positif sur 40 scènes sans cube.

- **« Ce centre est déjà enregistré. »** Mesuré sur de vraies captures :
  orange sombre contre rouge sombre donne 0,0104, une même couleur sous deux
  éclairages 0,0005. La marge est trop mince pour bloquer, et ajouter un terme
  de clarté inverse l'ordre (0,0417 contre 0,0437). Ce test **signale**
  désormais, il ne bloque plus ; le refus s'appuie sur la comparaison des
  9 cases, bien mieux informée.

## Conseils d'utilisation

- **Assez de lumière** : dans la pénombre, toutes les couleurs convergent vers
  le gris et rien ne les sépare. L'application le dit et refuse de capturer.
- **Lumière diffuse**, pas une lampe ponctuelle : les reflets sont l'ennemi n°2.
- Si l'app dit « trop de reflets », **incline légèrement le cube** — elle réessaie
  et capture quand même au bout de quelques secondes.
- Sur téléphone, **caméra arrière** : toi et l'objectif voyez alors la même face,
  il n'y a aucune ambiguïté gauche/droite. Avec une webcam, l'app détecte qu'elle
  te fait face et inverse les consignes en conséquence.
- Le bouton 🔦 allume la lampe si l'appareil le permet, 🔈 active les annonces
  vocales (pratique : tu gardes les yeux sur le cube).

---

## Structure

```
src/
  core/
    geometry.ts     géométrie du cube : mouvements et 24 orientations DÉRIVÉS
                    d'un modèle 3D, jamais tapés à la main
    cube.ts         état en 54 facettes, application des mouvements, validation
    color.ts        espaces colorimétriques, métrique robuste, classification
    hungarian.ts    affectation optimale sous contrainte (9 par couleur)
    repair.ts       réparation automatique d'une lecture incohérente
    scanPlan.ts     parcours des 6 faces (un seul geste entre deux captures)
    arrange.ts      recherche du placement des 6 faces : quelle face va où et
                    tournée comment (l'ordre de scan devient une suggestion)
    tracking.ts     suivi temps réel : orientation + mouvements effectués
    solverClient.ts pilotage du worker
  media/
    camera.ts       accès caméra, torche, exposition, verrou d'écran
    detector.ts     détection automatique de la face (réseau affine : le cube
                    peut être tenu de biais), lissage entre images
    sampler.ts      échantillonnage le long du réseau (spatial + temporel),
                    qualité d'image, comparaison de faces à luminosité normalisée
  ui/               interface : superposition, patron déplié, cube 3D, voix
  workers/
    solver.worker.ts  Kociemba deux phases, hors du fil principal
test/               géométrie, cube, couleur, détecteur, suivi, chaîne complète
```

Le cube 3D est en **CSS pur** (aucune bibliothèque 3D) : chaque sticker est placé
par une matrice construite depuis la géométrie, et une rotation de couche est
préfixée à ces matrices pour animer un mouvement — composé par le GPU, donc fluide
même sur un vieux téléphone. Total mesuré sur `npm run build` : **99 ko de
JavaScript** (81 ko pour la page, 19 ko pour le worker du solveur), soit
**36 ko compressés**, plus 15 ko de CSS (4 ko compressés).

---

## Tests

```bash
npm test
```

- `geometry.test.ts` — accord parfait avec `cubejs` sur 300 algorithmes
  aléatoires, tables coins/arêtes de Kociemba retrouvées par dérivation, les 24
  orientations, et l'invariant de traduction des mouvements sous rotation.
- `cube.test.ts` — la validation rejette coin tourné, arête retournée, parité
  impossible, mauvais comptage, centre incohérent.
- `color.test.ts` — propriétés de la métrique (bornée, invariante à la
  luminosité, exploite les canaux saturés, résiste au voile spéculaire) et
  lecture sans erreur de 100 cubes en conditions propres.
- `detector.test.ts` — détection sur scènes encombrées, faux positifs, vitesse.
- `detectorTilt.test.ts` — cube tourné de 0° à 45° et vu en perspective : taux
  de détection, erreur de centrage, couleurs lues, et **stabilité du réseau**
  d'une image à l'autre (régression : un réseau qui « danse » signale qu'il
  s'accroche au décor).
- `scanPlan.test.ts` — la grille lue à chaque étape **reconstruit exactement**
  l'état du cube (50 cubes aléatoires).
- `tracking.test.ts` — rattrapage de la face arrière, cube retourné dans la main,
  erreur de l'utilisateur, lecture bruitée, et 200 résolutions complètes.
- `arrange.test.ts` — récupération de faces tournées, de deux faces
  interverties, d'un ordre de scan complètement mélangé, refus d'un cube
  réellement impossible, vitesse, et la chaîne complète depuis les couleurs
  mesurées ; plus le rejet d'un logo sombre au centre du sticker.
- `duplicate.test.ts` — le verrou anti-doublon distingue toujours deux faces
  différentes, reconnaît toujours la même face malgré le bruit, n'est pas trompé
  par un changement d'éclairage entre deux captures, et le contrôle des six
  centres distincts rattrape une face montrée deux fois.
- `pipeline.test.ts` — la chaîne entière, du pixel à l'état du cube.

## Déployer

Le projet est un site statique. Sur Vercel :

```bash
npx vercel        # aperçu
npx vercel --prod # production
```

`vercel.json` est déjà configuré (`framework: vite`, autorisation caméra).
N'importe quel hébergeur statique servant du HTTPS convient également.

---

## Contribuer

Une seule règle, et tout le reste en découle : **mesurer avant de corriger**.
Aucun correctif n'entre ici sur la foi d'un raisonnement. Le détail, avec les
trois hypothèses séduisantes que la mesure a déjà tuées dans ce dépôt, est dans
[CONTRIBUTING.md](CONTRIBUTING.md).

```bash
npm test             # passe rapide, ~2 min — celle qu'on lance avant de coder
npm run test:complet # tout, y compris le rendu au pixel (~6 min)
```

Les deux passes tournent en intégration continue à chaque poussée
([.github/workflows/ci.yml](.github/workflows/ci.yml)).

## Auteur

**Diame Sene** — Co-founder & CTO [@Gunoor](https://dsene.dev), location de
voitures entre particuliers au Sénégal. IA appliquée, outillage d'agents,
mobile money. Dakar & Paris.

- 🌍 Portfolio — [dsene.dev](https://dsene.dev)
- 💼 LinkedIn — [diame-sene](https://linkedin.com/in/diame-sene)
- 🐙 GitHub — [@diamesene02](https://github.com/diamesene02)
- 📦 Produits IA — [diamesene.gumroad.com](https://diamesene.gumroad.com)

## Licence

[MIT](LICENSE) © 2026 Diame Sene.

Le solveur [cubejs](https://github.com/ldez/cubejs) (Kociemba en deux phases)
est également sous licence MIT ; son avis de copyright est reproduit dans
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Marque

**Rubik's Cube®** est une marque déposée de Rubik's Brand Ltd. Ce projet n'est
ni affilié à Rubik's Brand Ltd, ni approuvé ni sponsorisé par elle. Le nom
« Rubik'Scam » est un jeu de mots sans lien commercial, et la marque n'est
citée que pour décrire l'objet que l'application sait lire.
