#!/usr/bin/env bash
# One-time Azure setup for Radha Rani Multi Store — run in Azure Cloud Shell (bash):
#   curl -sL https://raw.githubusercontent.com/gautam958/RadhaRaniMultiStore/main/deploy/azure-setup.sh | bash
# Creates: resource group, Azure SQL (serverless, free offer), storage, Function App (Flex Consumption, .NET 10),
# app settings, CORS for GitHub Pages, and an OIDC identity so GitHub Actions can deploy without passwords.
# Safe to re-run: existing resources are reused. Secrets are generated here and never printed.
# Options (env vars): GOOGLE_CLIENT_ID=<client id>  SQL_LOCS="southindia southeastasia …"
#                     SQL_SERVER=<existing server> SQL_RG=<its resource group>  (to reuse a server instead)
set -euo pipefail

LOC="${LOC:-centralindia}"
RG="${RG:-rg-radharani}"
REPO="${REPO:-gautam958/RadhaRaniMultiStore}"
OWNER_EMAIL="${OWNER_EMAIL:-gautam958@gmail.com}"
PAGES_ORIGIN="${PAGES_ORIGIN:-https://gautam958.github.io}"

SUB_ID=$(az account show --query id -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)
SUFFIX=$(echo -n "$SUB_ID" | md5sum | cut -c1-6)
SQL="sql-radharani-$SUFFIX"; DB="radharani"; ST="stradharani$SUFFIX"; FUNC="func-radharani-$SUFFIX"
step() { echo; echo "==> $*"; }

step "Resource group $RG ($LOC)"
az group create -n "$RG" -l "$LOC" -o none

step "Storage account $ST"
az storage account create -g "$RG" -n "$ST" -l "$LOC" --sku Standard_LRS --min-tls-version TLS1_2 --allow-blob-public-access false -o none

step "Function App $FUNC (Flex Consumption, .NET 10 isolated)"
if ! az functionapp show -g "$RG" -n "$FUNC" -o none 2>/dev/null; then
  az functionapp create -g "$RG" -n "$FUNC" --storage-account "$ST" --flexconsumption-location "$LOC" \
    --runtime dotnet-isolated --runtime-version 10.0 --instance-memory 2048 -o none
fi
HOST=$(az functionapp show -g "$RG" -n "$FUNC" --query defaultHostName -o tsv)

# Database: reuse SQL_SERVER (+SQL_RG) if given; otherwise a dedicated server in the first region (SQL_LOCS)
# where Azure accepts a FREE-offer serverless database. Nothing paid is ever created.
SQL_RG="${SQL_RG:-$RG}"
SQL_LOCS="${SQL_LOCS:-southindia southeastasia eastasia westeurope eastus}"
ME_NAME=$(az account show --query user.name -o tsv); ME_ID=$(az ad signed-in-user show --query id -o tsv)

free_db() {  # $1 server  → creates/validates the free DB, returns 0 if it is on the free offer
  if ! az sql db show -g "$SQL_RG" -s "$1" -n "$DB" -o none 2>/dev/null; then
    az sql db create -g "$SQL_RG" -s "$1" -n "$DB" --edition GeneralPurpose --compute-model Serverless \
      --family Gen5 --capacity 2 --use-free-limit --free-limit-exhaustion-behavior AutoPause -o none || return 1
  fi
  [ "$(az sql db show -g "$SQL_RG" -s "$1" -n "$DB" --query useFreeLimit -o tsv)" = "true" ]
}

if [ -n "${SQL_SERVER:-}" ]; then
  SQL="$SQL_SERVER"
  step "Database $DB on existing server $SQL (free offer)"
  free_db "$SQL" || { echo "!! Could not create a free-offer database on $SQL"; exit 1; }
else
  FOUND=""
  for L in $SQL_LOCS; do
    SQL="sql-radharani-$SUFFIX-$L"
    step "SQL server $SQL ($L) + free database $DB"
    if ! az sql server show -g "$SQL_RG" -n "$SQL" -o none 2>/dev/null; then
      az sql server create -g "$SQL_RG" -n "$SQL" -l "$L" -u rradmin -p "Rr$(openssl rand -hex 14)#9a" \
        --external-admin-principal-type User --external-admin-name "$ME_NAME" --external-admin-sid "$ME_ID" -o none || continue
    fi
    if free_db "$SQL"; then FOUND=1; break; fi
    echo "   free offer refused in $L — removing the empty server and trying the next region"
    az sql server delete -g "$SQL_RG" -n "$SQL" --yes -o none || true
  done
  [ -n "$FOUND" ] || { echo "!! No region accepted a free-offer database. Nothing paid was created."; exit 1; }
fi
az sql server firewall-rule create -g "$SQL_RG" -s "$SQL" -n AllowAllWindowsAzureIps --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0 -o none 2>/dev/null || true
echo "   ✓ free database: $SQL / $DB (useFreeLimit=true, auto-pauses when the monthly free limit is used)"

# App login that exists ONLY inside this database (contained user) — the server admin password is never touched.
APP_USER="radharani_app"
EXISTING_CONN=$(az functionapp config appsettings list -g "$RG" -n "$FUNC" --query "[?name=='ConnectionStrings__Db'].value" -o tsv 2>/dev/null || true)
if [ -z "$EXISTING_CONN" ]; then
  step "Database login $APP_USER (via your Entra admin sign-in)"
  APP_PW="Rr$(openssl rand -hex 16)#7b"
  MYIP=$(curl -s https://api.ipify.org)
  az sql server firewall-rule create -g "$SQL_RG" -s "$SQL" -n CloudShellSetupTemp --start-ip-address "$MYIP" --end-ip-address "$MYIP" -o none
  for i in 1 2 3 4 5; do
    sqlcmd -S "tcp:$SQL.database.windows.net,1433" -d "$DB" --authentication-method ActiveDirectoryDefault -b -Q "
      IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = '$APP_USER')
        CREATE USER [$APP_USER] WITH PASSWORD = '$APP_PW';
      ELSE ALTER USER [$APP_USER] WITH PASSWORD = '$APP_PW';
      ALTER ROLE db_owner ADD MEMBER [$APP_USER];" && break
    echo "   database waking up, retrying in 20s…"; sleep 20
  done
  az sql server firewall-rule delete -g "$SQL_RG" -s "$SQL" -n CloudShellSetupTemp -o none
  [ "$i" = 5 ] && { echo "!! Could not create the database login"; exit 1; }
  NEW_CONN="Server=tcp:$SQL.database.windows.net,1433;Database=$DB;User ID=$APP_USER;Password=$APP_PW;Encrypt=True;TrustServerCertificate=False;Connection Timeout=60;"
fi


step "App settings"
SETTINGS=( "Auth__OwnerEmails=$OWNER_EMAIL" "Auth__DevLogin=false" "Auth__SessionDays=7" "Shop__CashierMaxBillDiscountPercent=5" )
EXISTING=$(az functionapp config appsettings list -g "$RG" -n "$FUNC" --query "[?name=='Auth__TokenSecret'].name" -o tsv)
[ -z "$EXISTING" ] && SETTINGS+=( "Auth__TokenSecret=$(openssl rand -base64 48 | tr -d '\n')" )
[ -n "${NEW_CONN:-}" ] && SETTINGS+=( "ConnectionStrings__Db=$NEW_CONN" )
[ -n "${GOOGLE_CLIENT_ID:-}" ] && SETTINGS+=( "Auth__GoogleClientId=$GOOGLE_CLIENT_ID" )
az functionapp config appsettings set -g "$RG" -n "$FUNC" --settings "${SETTINGS[@]}" -o none

step "CORS for $PAGES_ORIGIN"
az functionapp cors add -g "$RG" -n "$FUNC" --allowed-origins "$PAGES_ORIGIN" -o none 2>/dev/null || true

step "GitHub Actions deploy identity (OIDC, no passwords)"
APP_ID=$(az ad app list --display-name gh-radharani-deploy --query "[0].appId" -o tsv)
if [ -z "$APP_ID" ]; then
  APP_ID=$(az ad app create --display-name gh-radharani-deploy --query appId -o tsv)
  az ad sp create --id "$APP_ID" -o none
  sleep 20   # let the new identity propagate
fi
az ad app federated-credential create --id "$APP_ID" --parameters "{\"name\":\"github-main\",\"issuer\":\"https://token.actions.githubusercontent.com\",\"subject\":\"repo:$REPO:ref:refs/heads/main\",\"audiences\":[\"api://AzureADTokenExchange\"]}" -o none 2>/dev/null || echo "   (federated credential already exists)"
RG_ID=$(az group show -n "$RG" --query id -o tsv)
az role assignment create --assignee "$APP_ID" --role Contributor --scope "$RG_ID" -o none 2>/dev/null || echo "   (role already assigned)"

echo
echo "=================== DONE — copy these into GitHub ==================="
echo "RESULT_API_BASE_URL=https://$HOST"
echo "RESULT_AZURE_FUNCTIONAPP_NAME=$FUNC"
echo "RESULT_AZURE_CLIENT_ID=$APP_ID"
echo "RESULT_AZURE_TENANT_ID=$TENANT_ID"
echo "RESULT_AZURE_SUBSCRIPTION_ID=$SUB_ID"
echo "======================================================================"
