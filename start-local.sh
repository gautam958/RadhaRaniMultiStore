#!/usr/bin/env bash
# One-shot local runner for Radha Rani Multi Store (macOS) — no Docker needed.
# Local database = SQLite file at ./data/radharani.db (created automatically).
# Starts the API (http://localhost:7071) and the web app (http://localhost:5173). Logs go to ./logs
set -uo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"
LOGS="$ROOT/logs"; mkdir -p "$LOGS" "$ROOT/data"
STATUS="$LOGS/status.log"; : > "$STATUS"
API="$ROOT/api/RadhaRani.Api"
WEB="$ROOT/web"
OWNER_EMAIL="${OWNER_EMAIL:-gautam958@gmail.com}"
DB_FILE="$ROOT/data/radharani.db"

export PATH="$HOME/.azure-functions-core-tools:$HOME/.dotnet/tools:/opt/homebrew/bin:/usr/local/bin:/usr/local/share/dotnet:$PATH"
export DOTNET_CLI_TELEMETRY_OPTOUT=1

say()  { echo "▶ $*"; echo "$(date '+%H:%M:%S') STEP $*" >> "$STATUS"; }
ok()   { echo "  ✓ $*"; echo "$(date '+%H:%M:%S') OK   $*" >> "$STATUS"; }
fail() { echo "  ✗ $*"; echo "$(date '+%H:%M:%S') FAIL $*" >> "$STATUS"; echo; echo "Stopped. Details are in $LOGS"; exit 1; }
# Stop only what is listening on our own ports (never other projects' servers).
free_port() { local pids; pids="$(lsof -ti tcp:"$1" 2>/dev/null)"; [ -n "$pids" ] && kill $pids 2>/dev/null; sleep 1; }

# ---------------------------------------------------------------- tools
say "Checking tools"
{ sw_vers; uname -m; } > "$LOGS/env.log" 2>&1

command -v node >/dev/null || fail "Node.js not found — install with: brew install node"
ok "Node $(node -v)"

dotnet --list-sdks 2>/dev/null | grep -q '^10\.' || fail ".NET 10 SDK not found — install from https://dotnet.microsoft.com/download/dotnet/10.0"
ok ".NET SDK $(dotnet --version)"

FUNC_HOME="$HOME/.azure-functions-core-tools"
FUNC_URL="https://cdn.functions.azure.com/public/4.0.308342/Azure.Functions.Cli.osx-$( [ "$(uname -m)" = arm64 ] && echo arm64 || echo x64 ).4.16.0.zip"
func_ok() { func --version 2>/dev/null | grep -qE '^4\.'; }
if ! func_ok; then
  say "Installing Azure Functions Core Tools v4 into ~/.azure-functions-core-tools (no admin needed)"
  rm -rf "$FUNC_HOME" && mkdir -p "$FUNC_HOME"
  curl -fsSL "$FUNC_URL" -o "$FUNC_HOME/func.zip" >> "$LOGS/install.log" 2>&1 || fail "Download of Core Tools failed (see install.log)"
  unzip -q "$FUNC_HOME/func.zip" -d "$FUNC_HOME" >> "$LOGS/install.log" 2>&1 || fail "Unzip of Core Tools failed"
  rm -f "$FUNC_HOME/func.zip"
  chmod +x "$FUNC_HOME/func" "$FUNC_HOME/gozip" 2>/dev/null
  xattr -dr com.apple.quarantine "$FUNC_HOME" 2>/dev/null
  hash -r
fi
func_ok || fail "Azure Functions Core Tools not working (see install.log)"
ok "Functions Core Tools $(func --version 2>/dev/null | head -1)"

# ---------------------------------------------------------------- API config
# (Re)create local.settings.json for SQLite if missing or still pointing at the old Docker SQL Server.
if [ ! -f "$API/local.settings.json" ] || grep -q "1433" "$API/local.settings.json"; then
  SECRET="$(openssl rand -base64 48 | tr -d '\n')"
  cat > "$API/local.settings.json" <<JSON
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "",
    "FUNCTIONS_WORKER_RUNTIME": "dotnet-isolated",
    "Auth__GoogleClientId": "",
    "Auth__OwnerEmails": "${OWNER_EMAIL}",
    "Auth__TokenSecret": "${SECRET}",
    "Auth__SessionDays": "7",
    "Auth__DevLogin": "true",
    "Shop__CashierMaxBillDiscountPercent": "5"
  },
  "ConnectionStrings": {
    "Db": "Data Source=${DB_FILE}"
  },
  "Host": { "LocalHttpPort": 7071, "CORS": "http://localhost:5173" }
}
JSON
  ok "Created local.settings.json (SQLite at data/radharani.db, dev sign-in for ${OWNER_EMAIL})"
fi

# ---------------------------------------------------------------- build
say "Restoring & building the API"
( cd "$API" && dotnet build -c Debug ) > "$LOGS/build.log" 2>&1 || { grep -E " error " "$LOGS/build.log" | sort -u | head -20; fail "API build failed (see build.log)"; }
ok "API builds"

# ---------------------------------------------------------------- run API (creates the SQLite DB on first start)
say "Starting API on http://localhost:7071"
free_port 7071
( cd "$API" && nohup func start --port 7071 > "$LOGS/api.log" 2>&1 & echo $! > "$LOGS/api.pid" )
for i in $(seq 1 60); do
  curl -sf http://localhost:7071/api/health >/dev/null 2>&1 && { ok "API is running (database: data/radharani.db)"; break; }
  if [ "$i" = 60 ]; then tail -30 "$LOGS/api.log"; fail "API did not respond in 2 min (see api.log)"; fi
  sleep 2
done

# ---------------------------------------------------------------- run web
say "Installing web packages & starting web app on https://localhost:5173"
if [ ! -f "$WEB/.env" ]; then
  cat > "$WEB/.env" <<ENV
VITE_GOOGLE_CLIENT_ID=
VITE_DEV_LOGIN=true
VITE_SHOP_NAME=Radha Rani Multi Store
VITE_SHOP_ADDRESS=Deoghar, Jharkhand
VITE_SHOP_PHONE=
VITE_SHOP_GSTIN=
VITE_UPI_ID=
VITE_API_BASE=
ENV
fi
( cd "$WEB" && npm install --no-audit --no-fund --cache "$ROOT/.npm-cache" ) > "$LOGS/npm.log" 2>&1 || fail "npm install failed (see npm.log)"
free_port 5173
( cd "$WEB" && nohup npm run dev -- --port 5173 --strictPort > "$LOGS/web.log" 2>&1 & echo $! > "$LOGS/web.pid" )
for i in $(seq 1 30); do
  curl -skf https://localhost:5173 >/dev/null 2>&1 && { ok "Web app is running (https)"; break; }
  [ "$i" = 30 ] && fail "Web app did not start (see web.log)"
  sleep 1
done

echo "$(date '+%H:%M:%S') DONE all services running" >> "$STATUS"
echo
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)"
echo "✅ Radha Rani Multi Store is running:  https://localhost:5173"
[ -n "$LAN_IP" ] && echo "   On your phone (same Wi-Fi):        https://${LAN_IP}:5173   (tap Advanced → Proceed on the certificate warning)"
echo "   Sign in with: ${OWNER_EMAIL}  (Local test sign-in)"
echo "   Stop everything:  ./stop-local.sh"
open "https://localhost:5173" 2>/dev/null || true
