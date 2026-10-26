# Lance les 6 démos + Keycloak, attend qu'elles soient prêtes, puis ouvre le navigateur.
# Exemple :  .\lancer.ps1
$racine = $PSScriptRoot
Set-Location $racine

Write-Host "Lancement de Keycloak et des 6 démos (la première fois : téléchargement des images)..."
# --force-recreate : repart de zéro et relit toujours les derniers fichiers (server.js, moteur.js...)
docker compose up -d --build --force-recreate
if ($LASTEXITCODE -ne 0) { Write-Host "Docker n'a pas pu lancer les démos. Docker Desktop est-il démarré ?"; exit 1 }

Write-Host "Attente des 6 démos (Keycloak met 30 à 60 secondes)..."
$ports = 3001, 3002, 3003, 3004, 3005, 3006
for ($i = 0; $i -lt 90; $i++) {
    $pretes = @($ports | Where-Object {
        try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://localhost:$_/api/config").StatusCode -eq 200 } catch { $false }
    }).Count
    Write-Host "  $pretes / 6 prêtes"
    if ($pretes -eq 6) { break }
    Start-Sleep -Seconds 4
}

Write-Host ""
Write-Host "OpenFGA     http://localhost:3001"
Write-Host "SpiceDB     http://localhost:3002"
Write-Host "Permify     http://localhost:3003"
Write-Host "Casbin      http://localhost:3004"
Write-Host "Code maison http://localhost:3005"
Write-Host "Keycloak KAS http://localhost:3006"
Write-Host "Keycloak    http://localhost:8080  (admin / admin)"
Write-Host "Pour tout arrêter : docker compose down"
Start-Process "http://localhost:3001"
