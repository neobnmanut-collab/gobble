#!/bin/sh
# Double-click on a Mac (or run in a terminal) to start the game on this computer.
cd "$(dirname "$0")/server" || exit 1
command -v node >/dev/null || { echo "Node.js is not installed. Get it from https://nodejs.org"; read _; exit 1; }
[ -d node_modules ] || npm install --omit=dev --no-audit --no-fund
echo "Game running at http://localhost:8080 - close this window to stop it."
(sleep 1; open http://localhost:8080 2>/dev/null || xdg-open http://localhost:8080 2>/dev/null) &
node src/server.js
