#!/usr/bin/env sh
# One-command start for macOS / Linux:  ./start.sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get the LTS version from https://nodejs.org and run this again."
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "First run: installing everything. This takes a minute..."
  npm install || { echo "Install failed. Check your internet connection and try again."; exit 1; }
fi
echo "Starting SignSprint. Your browser will open at http://localhost:5173"
npm start
