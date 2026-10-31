#!/usr/bin/env bash
# Stops the API (7071) and web app (5173). Your data stays in data/radharani.db.
cd "$(dirname "$0")"
for port in 7071 5173; do pids="$(lsof -ti tcp:$port 2>/dev/null)"; [ -n "$pids" ] && kill $pids; done
echo "Stopped. Data is kept in data/radharani.db; double-click 'Start Radha Rani.command' to start again."
