# RaceReplay

Un replay de courses entre amis, sans compte et sans backend : **un lien LiveTrail v3 + 2 à 10 FIT** (GPX et TCX horodatés acceptés). Le parcours, le départ et les pointages viennent de LiveTrail ; les traces GPS animent les positions entre contrôles.

## Démarrage

Node.js 24 recommandé.

```sh
npm install
npm run dev
```

Application : http://localhost:5173

```sh
npm test
npm run build
npm run preview
```

## Utilisation

1. Coller le lien du tableau des passages LiveTrail v3, avec l’édition et `raceId`, et charger la course.
2. Sélectionner les activités en une fois ou les glisser dans la zone d’import.
3. **Après l’import**, associer chaque FIT à un participant LiveTrail (nom ou dossard), choisir sa couleur et marquer **« C’est moi »** sur son propre fichier. Aucun nom n’est déduit du nom de fichier.
4. Vérifier le recalage proposé : au moins deux contrôles intermédiaires sont comparés. Les corrections d’horloge sont affichées ; le détail montre chaque écart GPS / pointage et permet une correction en secondes. Une association incohérente bloque la création au lieu de fausser le replay.
5. Lire le replay sur un seul écran de PC, sans défilement (vérifié en 1920 × 960 et 1536 × 730). En haut, **« Je suis »** choisit le coureur dont on analyse la course ; chaque ami qui ouvre le fichier peut choisir le sien, ou « Spectateur ».
   - Carte et tableau des coureurs côte à côte : écart avec moi (− devant, + derrière), **FC**, **% de FC moyenne de course**, **VAP lissée sur 3 min**, puis km, allure et cadence en petit. Sous le tableau, **mes moments clés** : les tranches où j’ai le plus perdu ou gagné face au plus rapide des autres.
   - Profil et lecteur collés sous la carte. Clic : aller au point. **Glisser : sélectionner une zone**, que la carte cadre ; le tableau passe en mode « Zone » (temps, écart, FC, % FC moy. et VAP moyennes ; entrée et sortie au survol de l’écart). Échap efface la zone.
6. Analyses en bas, **vs moi** ou **vs tête** :
   - **Bilan** (onglet par défaut), une ligne par coureur : temps officiel et classement général, temps en mouvement, arrêts, allure et VAP, montées (VAM), descentes, plat, évolution de la VAP et de la FC entre les deux moitiés, FC moyenne et max, cadence.
   - **Ravitos** : temps d’arrêt à chaque ravito, autres arrêts et total ; un clic sur un ravito ramène le replay à l’arrivée du coureur.
   - Courbe des écarts (devant en haut, survol synchronisé avec le profil et la carte), heatmap par tranche, tronçons et pointages officiels. Contre la tête, vert = meilleur et rouge = temps perdu ; contre moi, rouge = plus rapide que moi et vert = plus lent. Une case ou un tronçon sélectionne la zone.
   Le thème clair ou sombre se change avec l’icône lune / soleil ; il suit le système tant qu’aucun choix n’est fait.
7. Exporter un `.racereplay` et l’envoyer à ses amis, qui l’ouvrent dans l’application. Il inclut le parcours et les pointages des **seuls coureurs choisis**, pas tout le classement ; leur réouverture ne nécessite pas LiveTrail. **Ce fichier contient les coordonnées GPS et données des montres** : le partager uniquement avec des personnes de confiance.

Les anciens exports restent importables : ils ouvrent l’association à LiveTrail avant la lecture. Leurs traces sont conservées, les noms complets uniques peuvent être rapprochés des participants officiels, et les repères manuels sont reprojetés sur le parcours officiel.

Les activités sont uniquement en mémoire dans l’onglet : exporter avant de fermer ou recharger. Aucun compte, téléversement serveur, stockage automatique ou télémétrie. L’API publique LiveTrail est appelée directement avec l’identifiant public d’événement (`X-Tenant`), sans cookies, jeton ni FIT. LiveTrail, son stockage du parcours, OpenStreetMap et Google Fonts font des requêtes externes ; le fond de carte révèle la zone visualisée au fournisseur. Les données d’activité ne leur sont pas envoyées. Les tuiles publiques OpenStreetMap conviennent aux premiers essais ; prévoir un fournisseur adapté et respecter sa politique d’utilisation pour une mise en production à grande échelle.

## Calculs et limites de la V1

- Projection géographique des traces sur le **parcours officiel LiveTrail**, progression monotone et recherche locale pour réduire les sauts aux croisements. Les distances du replay sont celles du parcours officiel ; les distances d’activité à l’import sont calculées sur le GPS. D+ estimé avec un seuil de 5 m contre le bruit altimétrique.
- Interpolation des passages et positions entre points ; les coupures de plus de 60 s sont signalées. Les pauses restent dans le temps écoulé.
- Écarts : différence des temps de passage au même kilomètre, pas différence de distance. Un passage absent n’est pas extrapolé.
- Arrêts GPS : vitesse le long du parcours inférieure à 0,5 m/s sur les 10 dernières secondes, pendant au moins 10 s (une pause automatique de la montre compte comme un arrêt) ; départ et arrivée exclus (300 m). Au ravito : arrêts à moins de 200 m du contrôle. Les tapis LiveTrail (entrée → sortie) sont affichés à côté quand les deux ont été lus, ce qui est rare : ils mesurent un passage dans la zone, pas l’immobilité, d’où des écarts de quelques secondes à une minute.
- Bilan : terrain classé par la pente du profil officiel sur 100 m (montée > 5 %, descente < −5 %, plat entre les deux), en mouvement seulement (plus de 0,3 m/s). VAM = dénivelé positif du profil divisé par le temps en montée. FC max = la plus haute moyenne sur 15 points. Classement général calculé sur tous les finishers LiveTrail au temps officiel (il est enregistré dans l’export ; les anciens exports l’obtiennent en repassant par « Participants »). Les contrôles et ravitos viennent désormais de LiveTrail, et des repères manuels peuvent être ajoutés. Les pointages officiels restent séparés des repères modifiés.
- VAP (allure ajustée à la pente) : coefficients de pente de Strava mesurés par A. Schroeder (projet `specialsauce`), interpolés et plafonnés à ±45 %. La pente vient du profil officiel sur 100 m, donc identique pour tous les coureurs. En direct, VAP et allure sont lissées sur les 3 dernières minutes de montre ; sur une zone, ce sont des moyennes. Arrêts inclus dans les deux cas.
- % FC moy. : FC instantanée, ou moyenne de la zone, divisée par la FC moyenne du coureur entre son départ et son arrivée officiels (pondérée par le temps, zéros ignorés). Orange au-delà de 105 %, bleu sous 92 %.
- Cadence en pas par minute : les FIT de course comptent un seul pied, elle est donc doublée quand la médiane du fichier est inférieure à 120, et laissée telle quelle sinon.
- Heatmaps : temps perdu face au plus rapide du groupe, ou différence avec moi, sur la même case ; échelle racine carrée jusqu’au plus gros écart du tableau, pour garder visibles les petites différences.
- Écart en direct avec moi : comparé au même point du parcours (le passage de l’un à l’endroit où se trouve l’autre), pas en distance.
- Mode sombre : variables CSS ; les couleurs historiques de `style.css` ont une contrepartie sombre générée (luminosité inversée, teinte conservée). Les tuiles OpenStreetMap sont inversées par filtre, ce qui garde les sentiers lisibles.
- Zones : les bornes posées sur un contrôle officiel (aimantation à 8 px sur le profil) utilisent les pointages LiveTrail ; ailleurs, le passage GPS corrigé.
- **Une seule horloge**, depuis le départ officiel ISO horodaté avec son fuseau. Les trois anciens modes ont été retirés. Les arrivées et les tronçons entre contrôles officiels utilisent les vrais pointages, pas l’arrêt de la montre. Les positions entre contrôles restent estimées ; un GPS manquant n’est pas reconstruit.
- Recalage : médiane des différences pointage / passage GPS sur les contrôles intermédiaires. Départ et arrivée sont exclus pour éviter de confondre le démarrage ou l’arrêt de la montre avec un passage de ligne. Si un décalage exact de quart d’heure explique la médiane à 45 s près, il est préféré à une correction de quelques secondes due au bruit GPS. Sinon la médiane à la seconde est proposée. Il faut au moins deux contrôles, un écart absolu médian ≤ 45 s, tous les résidus ≤ 120 s et au moins 75 % ≤ 90 s. Aucune déformation progressive ni alignement artificiel des coureurs n’est appliqué.
- Les liens LiveTrail historiques hors domaine `*.v3.livetrail.net` et les événements sans parcours ou sans deux contrôles intermédiaires exploitables ne sont pas encore pris en charge. Un changement de l’API publique ou de sa politique CORS peut nécessiter une mise à jour ; aucun proxy tiers n’est utilisé.
- Les parcours très différents, les grands allers-retours ou des traces fortement bruitées peuvent dégrader la projection ; une alerte apparaît lorsque plus de 10 % des points s’écartent du parcours commun.
- Le replay partageable nécessite l’application ; ce n’est pas un HTML autonome et il n’y a pas encore de lien public hébergé.

## Stack

React · TypeScript · Vite · Leaflet · fit-file-parser · Vitest. Le dossier `dist` peut être hébergé sur un serveur de fichiers statiques. Les FIT/GPX/TCX privés et les exports sont ignorés par Git. Les tests des trois FIT locaux ne s’exécutent que si ces fichiers sont présents.
