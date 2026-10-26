#!/usr/bin/env bash
# Lance les 6 démos + Keycloak (Mac / Linux), attend qu'elles soient prêtes, puis ouvre le navigateur.
# Utilisation :  bash lancer.sh
cd "$(dirname "$0")" || exit 1

echo "Lancement de Keycloak et des 6 démos (la première fois : téléchargement des images)..."
# --force-recreate : repart de zéro et relit toujours les derniers fichiers
docker compose up -d --build --force-recreate || { echo "Docker n'a pas pu lancer les démos. Docker est-il démarré ?"; exit 1; }

echo "Attente des 6 démos (Keycloak met 30 à 60 secondes)..."
for i in $(seq 1 90); do
  pretes=0
  for port in 3001 3002 3003 3004 3005 3006; do
    curl -s -o /dev/null --max-time 2 "http://localhost:$port/api/config" && pretes=$((pretes + 1))
  done
  echo "  $pretes / 6 prêtes"
  [ "$pretes" -eq 6 ] && break
  sleep 4
done

cat <<'FIN'

OpenFGA      http://localhost:3001
SpiceDB      http://localhost:3002
Permify      http://localhost:3003
Casbin       http://localhost:3004
Code maison  http://localhost:3005
Keycloak KAS http://localhost:3006
Keycloak     http://localhost:8080  (admin / admin)
Pour tout arrêter : docker compose down
FIN
if command -v open >/dev/null; then open http://localhost:3001; elif command -v xdg-open >/dev/null; then xdg-open http://localhost:3001; fi
