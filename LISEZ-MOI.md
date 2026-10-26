# Démo « hello world » : Keycloak + 5 façons de décider des droits

Une petite application web, la même pour les 6 façons de décider, avec un seul Keycloak.
Les 6 démos tournent **en même temps** : on peut comparer le même compte, sur le même scénario, d'un moteur à l'autre.

| Démo | Adresse |
|---|---|
| OpenFGA | http://localhost:3001 |
| SpiceDB | http://localhost:3002 |
| Permify | http://localhost:3003 |
| Casbin | http://localhost:3004 |
| Code maison | http://localhost:3005 |
| Keycloak KAS (module d'autorisation de Keycloak) | http://localhost:3006 |
| Keycloak (admin / admin) | http://localhost:8080 |

## Lancer et arrêter

Il faut Docker Desktop démarré. Dans un terminal PowerShell, dans ce dossier `Demo` :

- **Tout lancer** : `docker compose up -d` (ou `.\lancer.ps1`, qui ouvre aussi le navigateur)
- **Voir le journal** : `docker compose logs -f` (attendre « Démo … prête » pour les 5)
- **Tout arrêter** : `docker compose down` (tout repart à zéro au prochain lancement)

La première fois, Docker télécharge les images : compter quelques minutes.
Si PowerShell refuse le script : `powershell -ExecutionPolicy Bypass -File .\lancer.ps1`.

## Le scénario commun

```
Bâtiment A (propriétaire : olivier)
 ├── Parties communes A ── machine M2 (marque AirPlus)
 ├── Logement A1 (occupé par le ménage Dupont) ── machine M1 (marque ThermoX)
 └── Logement A2 (vide)
Bâtiment B (sans propriétaire dans la démo)
 └── Logement B1 (occupé par le ménage Delille, dont olivier est le Master)
```

Les 11 comptes (mot de passe = nom du compte) et le type de droit que chacun permet de tester :

| Compte | Rôle Keycloak | Type de droit testé |
|---|---|---|
| olivier | proprietaire, locataire | Propriétaire du bâtiment A (avec **exception** : rien dans un logement occupé) **et** locataire dans le bâtiment B : deux rôles différents selon le bâtiment |
| martin | architecte | Rôle direct, **daté** (mission) |
| bea | building-administrator | Rôle direct |
| fanny | facility-manager | **Héritage** vers espaces et machines, sauf logement occupé ; **révocable** par le propriétaire |
| eva | event-manager | Délégation **datée** |
| theo | technicien | Droit sur **une machine précise**, pendant l'intervention (M2 en cours, M1 **terminée**) |
| sophie | locataire | Droits via un **groupe** (le ménage), **sous-rôle** Master : peut inviter |
| lucas | locataire | Invité du ménage : voit, mais ne pilote pas et n'invite pas |
| fabien | fabricant | Droit selon un **attribut** de l'objet (la marque) |
| admin | admin-plateforme | Rôle Keycloak, mais **aucun droit** dans les bâtiments |
| paul | aucun | Refusé par **Keycloak** (niveau 1), le moteur n'est pas appelé |

Chaque compte reçoit les mêmes 17 questions (voir, modifier la structure, gérer les ménages, voir les mesures, piloter une machine…).
Les réponses attendues sont écrites dans `_commun/app/scenario.js`.

## Ce qu'on peut faire sur la page

1. **Se connecter** avec un compte. La connexion est partagée entre les 6 démos (même Keycloak) : connecté sur une, on l'est sur les autres. Pour changer de compte : se déconnecter, ou utiliser une fenêtre privée.
2. **Ce que voit le compte** : l'écran de l'app pour ce compte (bâtiment, espaces, machines, mesures, boutons). N'apparaît que ce que le moteur autorise ; la case « Montrer aussi ce qui est caché » grise le reste. Chaque bouton est revérifié par l'API : cacher un bouton ne suffit pas à protéger.
3. **Mes droits** : les 17 réponses du moteur pour ce compte, à côté de la réponse attendue. Un cadre orange signale une différence.
4. **Déléguer / révoquer** : retirer puis rendre le rôle de facility manager à fanny. Seul olivier y arrive : c'est le moteur qui le décide.
5. **Banc de test** : les 17 questions pour les 11 comptes d'un coup, avec le nombre de réponses conformes et le temps moyen par question.
6. **Les règles et le modèle** : les règles en français, puis le modèle écrit dans la langue du moteur.
7. **Ce que le moteur contient** : les relations, au format du moteur.
8. **Journal** : chaque décision, avec qui, quoi, le résultat et la durée.

## Ce que contient chaque dossier

```
Demo
├── docker-compose.yml       lance tout (Keycloak + les 6 démos)
├── lancer.ps1               lance tout et ouvre le navigateur
├── _commun                  identique pour tous les moteurs
│   ├── docker-compose.yml   Keycloak
│   ├── keycloak/realm-reskin-demo.json   l'app, ses 9 rôles, les 11 comptes
│   └── app
│       ├── server.js        l'API : vérifie le jeton Keycloak, puis demande au moteur
│       ├── scenario.js      les faits, les comptes, les 14 questions, les réponses attendues
│       └── index.html       la page web (connexion Keycloak écrite à la main)
├── OpenFGA
│   ├── docker-compose.yml   le moteur + son app (port 3001)
│   ├── moteur.js            TOUT le code propre à OpenFGA (modèle + appels)
│   └── openfga-v1.22.0      le code source du moteur (sur le PC seulement, pas dans le dépôt GitHub)
├── SpiceDB                  même organisation (port 3002, spicedb-v1.57.0)
├── Permify                  même organisation (port 3003, permify-v1.7.5)
├── Casbin                   même organisation (port 3004, Casbin.NET-v2.21.2), pas de conteneur moteur
├── Code Maison              même organisation (port 3005), pas de moteur : une table SQL + du code
└── Keycloak KAS             même organisation (port 3006), pas de moteur en plus : l'app configure Keycloak
```

Pour comparer les moteurs, il suffit de comparer les 6 fichiers `moteur.js`.
En tête de chacun, un encadré montre comment ce moteur écrit chaque type de droit.

## Ce qu'on observe déjà (à vérifier avec la démo)

- **OpenFGA, SpiceDB, Permify** : tous les types de droits s'écrivent dans le modèle lui-même (héritage, groupe, exception, date de fin, attribut). Permify passe par un objet « mandat » pour les dates de fin.
- **Casbin** : les règles et les faits sont dans Casbin, mais suivre un lien entre objets, vérifier une date de fin ou réutiliser une permission demande des **fonctions JavaScript ajoutées** (8 ici).
- **Code maison** : chaque règle est une fonction écrite à la main. C'est rapide pour 14 questions ; il faut tout réécrire, tester et auditer soi-même quand les règles grandissent.
- **Keycloak KAS** : aucun composant en plus, et la décision peut se faire avec le jeton du compte (requête UMA). Les sous-groupes avec « extend to children » font l'héritage **des personnes** (tout le bâtiment, le ménage). Mais KAS ne lit pas de faits : `moteur.js` **construit** sa configuration au démarrage (ici 19 groupes, 28 politiques, 8 ressources, 20 permissions, une centaine d'appels à l'API d'administration). L'héritage **vers les objets** (machine → espace → bâtiment), l'exception « logement occupé » et le choix des politiques de chaque permission sont calculés par notre code. Chaque droit daté demande sa propre politique (utilisateur ET avant la date). Révoquer un rôle sans date = retirer du sous-groupe (immédiat) ; tout autre changement = recalculer des permissions.
- Les 6 donnent **187 / 187 réponses conformes**. Casbin et le code maison sont les plus rapides, parce qu'ils tournent dans l'application sans appel réseau.

## Un compte, deux rôles selon le bâtiment (olivier)

olivier est propriétaire du bâtiment A et locataire dans le bâtiment B. Pour l'ajouter, il a suffi de **4 faits de plus**
(`scenario.js`) : aucun des 5 fichiers `moteur.js` n'a changé, parce que dans les moteurs un rôle est toujours **sur un objet**
(« propriétaire DU bâtiment A »).

Le piège est côté Keycloak : un rôle Keycloak vaut pour toute la plateforme. olivier a les deux rôles `proprietaire` et `locataire`,
mais Keycloak ne sait pas lequel vaut pour quel bâtiment. Si une app décidait à partir du rôle Keycloak seul, olivier serait
« propriétaire » partout. Keycloak dit qui on est et si on a accès à l'app ; le moteur dit ce qu'on peut faire sur tel bâtiment.

## Les choix faits pour cette démo (et pourquoi)

- **Node.js, sans bibliothèque externe** (sauf Casbin, qui en est une) : peu de code, tout est lisible, rien à compiler. La vraie plateforme est en .NET ; la maquette finale pourra l'être aussi.
- **Les mêmes faits, les mêmes questions, la même page pour tous** : la comparaison est équitable.
- **Données en mémoire** : tout repart à zéro à chaque `docker compose down` / `up`.
- **Dates relatives** : « mission en cours » = finit dans 90 jours, « intervention terminée » = finie il y a 7 jours, calculées au démarrage. La démo marche quel que soit le jour.
- **Versions fixées** (Keycloak 26.8.1, OpenFGA v1.22.0, SpiceDB v1.57.0, Permify v1.7.5, node-casbin 5.51.1) : même résultat chez n'importe qui.
- **Le nom de connexion sert d'identifiant** (martin). Dans la vraie plateforme : l'identifiant Keycloak (`sub`).

## Ce qui n'est PAS fait pour la production

- Mots de passe et clés de démo écrits en clair (admin/admin, `cle-de-demo`).
- Keycloak en mode développement, sans HTTPS (`start-dev`, `sslRequired: none`).
- Le banc de test pose des questions pour d'autres comptes : pratique pour comparer, à ne jamais ouvrir en vrai.
- Pas de base de données durable pour les moteurs.

## Testé

Le 22/10/2026, avec un vrai Keycloak 26.8.1 et les vrais moteurs (mêmes versions), les démos lancées en même temps :
- 420 / 420 réponses conformes par moteur en test direct (avant, pendant et après la révocation de fanny) ;
- dans un navigateur : connexion, connexion partagée entre les 5 démos, banc 154 / 154 sur chacune (187 / 187 après l'ajout d'olivier locataire dans B, 510 / 510 en test direct), révocation puis retour de fanny, refus de délégation pour martin, refus Keycloak pour paul, déconnexion.
- Keycloak KAS (ajouté le 22/10 après-midi) : 510 / 510 en test direct ; dans le navigateur, « Mes droits » décidé avec le jeton de 5 comptes (UMA) sans écart, banc 187 / 187 avant et après la révocation de fanny, refus de délégation pour martin, appel direct refusé pour theo sur M1.
