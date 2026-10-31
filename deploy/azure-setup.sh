#!/usr/bin/env bash
# One-time Azure setup for Radha Rani Multi Store — run in Azure Cloud Shell (bash):
#   curl -sL https://raw.githubusercontent.com/gautam958/RadhaRaniMultiStore/main/deploy/azure-setup.sh | bash
# Creates: resource group, Azure SQL (serverless, free offer), storage, Function App (Flex Consumption, .NET 10),
# app settings, CORS for GitHub Pages, and an OIDC identity so GitHub Actions can deploy without passwords.
# Safe to re-run: existing resources are reused. Secrets are generated here and never printed.
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

step "Azure SQL server $SQL"
if ! az sql server show -g "$RG" -n "$SQL" -o none 2>/dev/null; then
  SQLPW="Rr$(openssl rand -hex 14)#9a"
  az sql server create -g "$RG" -n "$SQL" -l "$LOC" -u rradmin -p "$SQLPW" -o none
  NEW_SQL_PASSWORD=1
fi
az sql server firewall-rule create -g "$RG" -s "$SQL" -n AllowAzureServices --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0 -o none

step "Database $DB (serverless, free offer, auto-pause)"
if ! az sql db show -g "$RG" -s "$SQL" -n "$DB" -o none 2>/dev/null; then
  az sql db create -g "$RG" -s "$SQL" -n "$DB" \
    --edition GeneralPurpose --compute-model Serverless --family Gen5 --capacity 2 \
    --use-free-limit --free-limit-exhaustion-behavior AutoPause --backup-storage-redundancy Local -o none \
  || { echo "!! Free-offer database could not be created (the free offer allows one per subscription)."; exit 1; }
fi

step "Storage account $ST"
az storage account create -g "$RG" -n "$ST" -l "$LOC" --sku Standard_LRS --min-tls-version TLS1_2 --allow-blob-public-access false -o none

step "Function App $FUNC (Flex Consumption, .NET 10 isolated)"
if ! az functionapp show -g "$RG" -n "$FUNC" -o none 2>/dev/null; then
  az functionapp create -g "$RG" -n "$FUNC" --storage-account "$ST" --flexconsumption-location "$LOC" \
    --runtime dotnet-isolated --runtime-version 10.0 --instance-memory 2048 -o none
fi
HOST=$(az functionapp show -g "$RG" -n "$FUNC" --query defaultHostName -o tsv)

step "App settings"
SETTINGS=( "Auth__OwnerEmails=$OWNER_EMAIL" "Auth__DevLogin=false" "Auth__SessionDays=7" "Shop__CashierMaxBillDiscountPercent=5" )
EXISTING=$(az functionapp config appsettings list -g "$RG" -n "$FUNC" --query "[?name=='Auth__TokenSecret'].name" -o tsv)
[ -z "$EXISTING" ] && SETTINGS+=( "Auth__TokenSecret=$(openssl rand -base64 48 | tr -d '\n')" )
if [ "${NEW_SQL_PASSWORD:-0}" = 1 ]; then
  SETTINGS+=( "ConnectionStrings__Db=Server=tcp:$SQL.database.windows.net,1433;Database=$DB;User ID=rradmin;Password=$SQLPW;Encrypt=True;TrustServerCertificate=False;Connection Timeout=60;" )
fi
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
