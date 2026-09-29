@echo off
title Thumbnail Studio
cd /d "%~dp0"

echo ===============================================
echo   Thumbnail Studio - YouTube Thumbnail Automat
echo ===============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [FEHLER] Node.js wurde nicht gefunden. Bitte Node.js 20+ installieren: https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo [1/3] Installiere Abhaengigkeiten...
  call npm install
  if errorlevel 1 ( echo [FEHLER] npm install fehlgeschlagen. & pause & exit /b 1 )
)

if not exist .env (
  echo [INFO] Keine .env gefunden - erstelle sie aus .env.example
  copy .env.example .env >nul
  echo [INFO] Bitte OPENAI_API_KEY in der .env eintragen. Bis dahin laeuft die App im TEST_MODE.
)

echo [2/3] Baue Oberflaeche...
call npm run build
if errorlevel 1 ( echo [FEHLER] Build fehlgeschlagen. & pause & exit /b 1 )

echo [3/3] Starte Anwendung...
start "" http://localhost:3000
call npm run start:server
pause
