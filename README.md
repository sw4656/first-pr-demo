# first-pr-demo — Loan Servicing Portfolio

A backend that hosts the "WebNote Replacement BETA" loan servicing calculator
(the single-page HTML "face page") and catalogues an arbitrary number of loan
servicing accounts behind it. This is the first slice of a longer-term asset
management platform: a portfolio of loan accounts, each with its own full
calculator state (payment terms, balances, escrow, servicing contacts,
property valuation, reinstatement figures, service schedule, etc.).

## Architecture

```
public/
  index.html          Portfolio dashboard — list, search, sort, create, delete accounts
  calculator.html      The WebNote calculator face page (per-account, opened via ?account=<id>)
  account-bridge.js    Loads/saves the calculator's on-page fields to/from the backend
server/
  src/db.js            SQLite schema (better-sqlite3)
  src/fields.js         Maps calculator field ids -> indexed/searchable account columns
  src/routes/accounts.js  REST API: list/create/read/update/delete loan accounts
  src/index.js          Express app: serves /api/accounts and the public/ static site
  data/                SQLite database file lives here (gitignored)
```

**How an account's data is stored.** The calculator page has ~175 input/select
fields (loan terms, borrower info, balances, servicing contacts, property
valuation, reinstatement figures, etc.). Rather than hand-maintaining a schema
column per field, `account-bridge.js` serializes every field on the page by
its element `id` into one JSON object and POSTs/PUTs it to
`/api/accounts/:id`. The server stores that full blob in the `data` column and
also extracts a handful of commonly-queried fields (loan number, borrower
name, property address, investor, rate, balance, status, ...) into indexed
columns so the portfolio dashboard can list/search/sort without deserializing
every row. On load, the bridge script fetches the blob and repopulates every
field by id, then re-runs the page's own calculation functions.

## Running locally

```bash
cd server
npm install
npm start          # http://localhost:3000
```

Open `http://localhost:3000/` for the portfolio dashboard. Click **+ New Loan
Account** to open a blank calculator, fill it in, and click **Save** (or
Ctrl/Cmd+S) to persist it. Each account's calculator lives at
`/calculator.html?account=<id>`.

## API

| Method | Path                  | Description                                   |
|--------|-----------------------|------------------------------------------------|
| GET    | `/api/accounts`       | List accounts. Query: `q`, `status`, `sort`, `dir` |
| POST   | `/api/accounts`       | Create an account. Body: `{ "data": { ... } }` |
| GET    | `/api/accounts/:id`   | Fetch one account, including its full field blob |
| PUT    | `/api/accounts/:id`   | Replace an account's field blob                |
| DELETE | `/api/accounts/:id`   | Delete an account                              |

## Roadmap toward asset management software

This first pass is intentionally a single-tenant CRUD backend. Natural next
steps: authentication/authorization (multi-user, per-investor access), an
audit log of field-level changes, document storage for the "File Documents"
tab (currently just links), payment/transaction history as first-class rows
instead of a JSON blob, and portfolio-level reporting (aggregate UPB, roll
rates, delinquency buckets) across all accounts.
