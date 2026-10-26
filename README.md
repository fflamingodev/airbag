# Démo « hello world » : Keycloak + 6 façons de décider des droits

Une petite application web, la même pour les 6 solutions, avec un seul Keycloak.
Seul le fichier `moteur.js` de chaque dossier change : on compare les solutions sur le même scénario.

| Solution | Adresse |
|---|---|
| OpenFGA | http://localhost:3001 |
| SpiceDB | http://localhost:3002 |
| Permify | http://localhost:3003 |
| Casbin | http://localhost:3004 |
| Code maison (SQL) | http://localhost:3005 |
| Keycloak KAS | http://localhost:3006 |
| Console Keycloak (admin / admin) | http://localhost:8080 |

## Lancer

Il faut **Docker** (Docker Desktop ou Docker Engine avec Compose 2.20 ou plus) et les ports 3001 à 3006 et 8080 libres.

- **Windows** : double-cliquer sur `lancer.bat` (attend que les 6 démos soient prêtes puis ouvre le navigateur).
- **Mac / Linux** : dans un terminal, dans ce dossier, `bash lancer.sh` (même chose).
- **N'importe quel système, à la main** : `docker compose up -d --build`

Les images utilisées existent pour les processeurs Intel/AMD et ARM (dont les Mac Apple Silicon).
- **Arrêter** : `docker compose down` (tout repart à zéro au prochain lancement)

La première fois, Docker télécharge les images (quelques minutes). Les démos sont prêtes quand
`docker compose logs -f` affiche « Démo … prête » pour les 6.

## Se connecter

Comptes de test : **mot de passe = nom du compte** (olivier, martin, bea, fanny, eva, theo, sophie, lucas, fabien, admin, paul).
La liste et ce que chaque compte permet de tester sont sur la page d'accueil de chaque démo.

À regarder sur la page : « Ce que voit le compte » (l'écran tel que ce compte le verrait), « Mes droits »,
« Déléguer / révoquer », le **banc de test** (les 17 questions pour les 11 comptes d'un coup), le modèle et le journal.

## Plus de détails

Voir [LISEZ-MOI.md](LISEZ-MOI.md) : le scénario, les types de droits testés, l'organisation des fichiers,
les choix faits et ce qui n'est pas fait pour la production.

## Code source des moteurs (non inclus dans ce dépôt)

Les démos utilisent les images Docker officielles. Le code source se trouve dans les dépôts des projets :
[OpenFGA v1.22.0](https://github.com/openfga/openfga/tree/v1.22.0) ·
[SpiceDB v1.57.0](https://github.com/authzed/spicedb/tree/v1.57.0) ·
[Permify v1.7.5](https://github.com/Permify/permify/tree/v1.7.5) ·
[Casbin.NET v2.21.2](https://github.com/casbin/Casbin.NET/tree/v2.21.2) ·
[node-casbin v5.51.1](https://github.com/casbin/node-casbin/tree/v5.51.1) ·
[Keycloak 26.8.1](https://github.com/keycloak/keycloak/tree/26.8.1)

## Attention

Démo locale uniquement : mots de passe et clés en clair (admin/admin, `cle-de-demo`), Keycloak en mode développement sans HTTPS,
données en mémoire. Ne pas exposer sur un réseau.
