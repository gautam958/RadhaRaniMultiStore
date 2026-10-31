#!/usr/bin/env bash
# Double-click in Finder to start Radha Rani Multi Store locally.
cd "$(dirname "$0")" && /bin/bash ./start-local.sh
echo; read -n 1 -s -r -p "Press any key to close this window (the app keeps running)…"
