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
  login.html            Staff sign-in page
  index.html             Portfolio dashboard — list, search, sort, create, delete accounts
  calculator.html         The WebNote calculator face page (per-account, opened via ?account=<id>)
  account-bridge.js       Loads/saves the calculator's on-page fields to/from the backend
server/
  src/db.js               Postgres connection pool + schema (accounts, users)
  src/auth.js             Login/logout/me routes + requireAuth session middleware
  src/fields.js            Maps calculator field ids -> indexed/searchable account columns
  src/routes/accounts.js   REST API: list/create/read/update/delete loan accounts
  src/index.js             Express app: sessions, auth, /api/accounts, and the public/ static site
  scripts/create-user.js              Creates/updates a staff login (no self-service signup)
  scripts/migrate-sqlite-to-postgres.js  One-time copy of legacy SQLite data into Postgres
  data/                    Legacy SQLite database file, if present (gitignored)
```

## Authentication

This app is for internal staff only (no borrower/investor accounts). There's
no self-service signup — an admin creates one login per staff member with the
`create-user` script (below), and everything under `/` and `/api/accounts`
requires a signed-in session.

Sessions are stored in Postgres (via `connect-pg-simple`) rather than in
memory, so restarting the server doesn't log everyone out.

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

Requires a Postgres database (14+). Locally, the quickest path is Docker:

```bash
docker run --name loan-servicing-db -e POSTGRES_PASSWORD=devpass \
  -e POSTGRES_DB=loan_servicing -p 5432:5432 -d postgres:16
```

Then:

```bash
cd server
npm install
cp .env.example .env
# edit .env: set DATABASE_URL (e.g. postgres://postgres:devpass@localhost:5432/loan_servicing)
# and SESSION_SECRET (node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# If you have an existing server/data/loans.db from before the Postgres
# migration, copy its rows into Postgres:
node scripts/migrate-sqlite-to-postgres.js

# Create a login for yourself (repeat once per staff member, up to ~7-8 users):
node scripts/create-user.js you@company.com "Your Name"

npm start          # http://localhost:3000
```

Open `http://localhost:3000/` — you'll be redirected to `/login.html` until
you sign in. Click **+ New Loan Account** to open a blank calculator, fill it
in, and click **Save** (or Ctrl/Cmd+S) to persist it. Each account's
calculator lives at `/calculator.html?account=<id>`.

## API

| Method | Path                  | Description                                   |
|--------|-----------------------|------------------------------------------------|
| GET    | `/api/accounts`       | List accounts. Query: `q`, `status`, `sort`, `dir` |
| POST   | `/api/accounts`       | Create an account. Body: `{ "data": { ... } }` |
| GET    | `/api/accounts/:id`   | Fetch one account, including its full field blob |
| PUT    | `/api/accounts/:id`   | Replace an account's field blob                |
| DELETE | `/api/accounts/:id`   | Delete an account                              |

## Roadmap toward asset management software

Staff authentication and the Postgres migration are done. Natural next
steps: per-role authorization (not every staff login needs the same
access), an audit log of field-level changes, document storage for the
"File Documents" tab (currently just links), payment/transaction history as
first-class rows instead of a JSON blob, and portfolio-level reporting
(aggregate UPB, roll rates, delinquency buckets) across all accounts.
