@echo off
title Gobble - local test server
cd /d "%~dp0server"
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org and run this again. & pause & exit /b)
if not exist node_modules (echo Installing, one time only... & call npm install --omit=dev --no-audit --no-fund)
echo.
echo Game running at http://localhost:8080  -  close this window to stop it.
echo Other computers on your Wi-Fi can join at http://YOUR-PC-IP:8080
echo.
start "" http://localhost:8080
node src/server.js
pause
