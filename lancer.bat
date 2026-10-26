@echo off
rem Double-cliquez sur ce fichier pour lancer les 5 demos (Docker Desktop doit etre demarre).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lancer.ps1"
pause
