#!/usr/bin/env bash
# Installs what is missing, then starts Fire TV Debloater (macOS and Linux).
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required but was not found."
  echo "Install the LTS version from https://nodejs.org and run this again."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

case "$(uname -s)" in
  Darwin) os=darwin ;;
  *) os=linux ;;
esac

if [ ! -x vendor/platform-tools/adb ]; then
  echo "Downloading Google's Android platform-tools (adb)..."
  npx tsx scripts/fetch-platform-tools.ts "$os"
fi

exec npx tsx src/index.ts
