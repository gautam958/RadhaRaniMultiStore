# Radha Rani Multi Store — POS, Inventory & Digital Ledger (Phase 1)

Counter billing (POS) + admin dashboard for a physical shop. Works on laptop, tablet and phone (installable PWA).
The online storefront is Phase 2.

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite + TypeScript, PWA, camera barcode scanning (`html5-qrcode`) |
| API | .NET 10 Azure Functions (isolated worker, ASP.NET Core integration) |
| Database | SQL Server / Azure SQL via EF Core 10 |
| Login | Google Sign-In → API verifies the Google ID token → issues a 7-day shop session token |

## What's in Phase 1

- **Billing (POS)**: scan with the phone camera or a USB scanner, tap item cards (image, MRP, discount, stock), qty stepper, bill discount (cashier capped at 5%), Cash / UPI / Card / Udhaar, a UPI QR with the amount filled in, cash change calculator, 80 mm thermal print, WhatsApp bill.
- **Dashboard**: today's sales and payment split, cash in drawer, gross profit (Owner only), low-stock and out-of-stock list, 7-day trend, top sellers, udhaar to collect, supplier dues.
- **Items**: add and edit from mobile with a camera photo and barcode scan, MRP / selling / cost price, discount %, GST/HSN, low-stock level, opening stock, Excel/CSV import and export, stock history per item.
- **Stock**: Stock In from a supplier bill (updates cost price, optionally selling price, records supplier dues); recount and damage adjustments with a reason.
- **Ledger**: day book with opening and closing cash and a drawer cash match; expenses; customer khata (udhaar, payments, statement, WhatsApp reminder, old balance carried over from the paper register); supplier dues and payments.
- **Staff roles**: Cashier, Manager, Owner. Only the Owner sees cost, profit and stock value.

### Design rules that keep the books correct
- Stock only changes through `StockService.Apply`, which writes a `StockMovement` row **and** atomically updates `Product.QtyOnHand` in a single SQL `UPDATE`.
- Sales, purchases and cancellations run in one DB transaction covering the bill, stock and ledger.
- Prices are never trusted from the browser; the API recalculates every bill.
- Bills are never deleted. A cancel (void) reverses stock and money, with a reason.
- `LedgerEntry` is a single-entry cash book. Mode `Credit` (udhaar) moves party balances but never cash in hand.

## Run locally (Mac) — no Docker
Locally the app uses **SQLite** (a single file, `data/radharani.db`, created automatically). In Azure it uses **SQL Server / Azure SQL**.
The API picks the provider from the connection string: `Data Source=…/x.db` → SQLite, anything else → SQL Server.

Needs: .NET 10 SDK and Node.js. Azure Functions Core Tools is installed automatically into `~/.azure-functions-core-tools`.

**Double-click `Start Radha Rani.command`** in Finder (or run `./start-local.sh`). It builds the API, starts it on :7071,
starts the web app on :5173 and opens the browser. Sign in with the owner email using **Local test sign-in**
(enabled only locally via `Auth__DevLogin=true` + localhost). Stop with `./stop-local.sh`. Logs are in `logs/`.

To use Google sign-in locally: create an OAuth **Web** client (origin `http://localhost:5173`), put the client ID in
`api/RadhaRani.Api/local.settings.json` → `Auth__GoogleClientId` and `web/.env` → `VITE_GOOGLE_CLIENT_ID`.

To point local dev at a real SQL Server / Azure SQL instead, set `ConnectionStrings:Db` to that server — tables are created on start-up.

> Schema is created/upgraded automatically at start-up for both SQLite and SQL Server (`Data/DbSchema.cs`) — no EF migrations needed.

## First day setup checklist
1. Staff → add each person's Gmail and role.
2. Items → **Download template**, fill it in Excel (name, barcode, prices, qty), then **Import Excel**.
3. Day Book → **Set opening cash** with the float in the drawer.
4. Khata → **Old balance** for customers carried over from the paper register.
5. Print a test bill on the thermal printer (Chrome print dialog → printer → paper 80 mm, margins none).

## Live deployment (GitHub Pages + Azure)
| Part | Where | Deploys |
|---|---|---|
| Web app (React PWA) | GitHub Pages — `https://gautam958.github.io/RadhaRaniMultiStore/` | `.github/workflows/pages.yml` on every push to `main` touching `web/` |
| API (.NET 10 isolated) | Azure Functions (Flex Consumption, Central India) | `.github/workflows/api.yml` on every push touching `api/` (OIDC login, no stored passwords) |
| Database | Azure SQL Database (serverless, free offer, auto-pause) | Tables are created/upgraded automatically at API start-up (`Data/DbSchema.cs`) |

**GitHub repository settings** (Settings → Secrets and variables → Actions):
- Variables: `API_BASE_URL` (Function App URL), `GOOGLE_CLIENT_ID`, `AZURE_FUNCTIONAPP_NAME`, optional `SHOP_NAME`, `SHOP_ADDRESS`, `SHOP_PHONE`, `SHOP_GSTIN`, `UPI_ID`
- Secrets: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`

**Function App settings:** `ConnectionStrings__Db`, `Auth__GoogleClientId`, `Auth__OwnerEmails`, `Auth__TokenSecret`, `Auth__DevLogin=false`; CORS allows `https://gautam958.github.io`.

**Schema changes:** when you add an entity property, add a line to `DbSchema.Columns` — it is applied to both the local SQLite file and Azure SQL on the next start.

## API overview (all under `/api`)
| Area | Endpoints |
|---|---|
| Auth | `POST auth/google`, `GET me`, `GET/POST users` (Owner) |
| Catalog | `GET/POST/PUT categories`, `GET products?search=&status=Low|OutOfStock|NeedsReorder&categoryId=`, `GET products/{id}`, `GET products/code/{barcode}`, `POST/PUT products`, `PUT/GET products/{id}/image`, `POST products/import` |
| Stock | `POST stock/adjust`, `GET stock/movements?productId=`, `POST/GET purchases`, `GET/POST suppliers`, `POST suppliers/{id}/payments` |
| POS | `POST sales`, `GET sales?date=`, `GET sales/{id}`, `POST sales/{id}/void` |
| Ledger | `GET/POST customers`, `GET customers/{id}/statement`, `POST customers/{id}/payments`, `GET ledger/daybook?date=`, `POST ledger/expense`, `POST ledger/opening` |
| Dashboard | `GET dashboard` |

## Next phases
- **Phase 2:** customer storefront (cart, Razorpay/UPI checkout, store pickup), reusing the same catalog and stock.
- **Phase 3:** offline billing queue (IndexedDB sync), GST reports (GSTR-1 summary), P&L by month and category, purchase-order suggestions from sales velocity, product variants (size and colour).
- Move product images to Azure Blob + CDN once the catalog grows beyond a few thousand photos.
