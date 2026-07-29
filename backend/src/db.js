const path = require("path");
const Database = require("better-sqlite3");

const DB_PATH = path.join(__dirname, "..", "loan_servicing.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS debtors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_number TEXT UNIQUE NOT NULL,
    borrower_name TEXT NOT NULL,
    ssn TEXT,
    address TEXT,
    phone TEXT,
    email TEXT,
    lender TEXT,
    investor TEXT,
    lien_position TEXT,
    loan_type TEXT,
    origination_date TEXT,
    principal REAL NOT NULL DEFAULT 0,
    rate_pct REAL NOT NULL DEFAULT 0,
    term_months INTEGER NOT NULL DEFAULT 360,
    day_count_convention INTEGER NOT NULL DEFAULT 360,
    current_balance REAL NOT NULL DEFAULT 0,
    property_value REAL,
    escrow_tax_monthly REAL NOT NULL DEFAULT 0,
    escrow_ins_monthly REAL NOT NULL DEFAULT 0,
    escrow_pmi_monthly REAL NOT NULL DEFAULT 0,
    escrow_other_monthly REAL NOT NULL DEFAULT 0,
    advances REAL NOT NULL DEFAULT 0,
    nsf_fees REAL NOT NULL DEFAULT 0,
    legal_fees REAL NOT NULL DEFAULT 0,
    other_fees REAL NOT NULL DEFAULT 0,
    suspense_balance REAL NOT NULL DEFAULT 0,
    missed_payments INTEGER NOT NULL DEFAULT 0,
    days_past_due INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    debtor_id INTEGER NOT NULL REFERENCES debtors(id) ON DELETE CASCADE,
    due_date TEXT NOT NULL,
    received_date TEXT,
    amount_due REAL NOT NULL DEFAULT 0,
    amount_received REAL NOT NULL DEFAULT 0,
    late_charge REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'on_time'
  );

  CREATE TABLE IF NOT EXISTS calculation_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    debtor_id INTEGER NOT NULL REFERENCES debtors(id) ON DELETE CASCADE,
    computed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    base_payment REAL NOT NULL,
    escrow_monthly REAL NOT NULL,
    total_piti REAL NOT NULL,
    per_diem REAL NOT NULL,
    status TEXT NOT NULL,
    reinstatement_net REAL
  );

  CREATE INDEX IF NOT EXISTS idx_payments_debtor_id ON payments(debtor_id);
  CREATE INDEX IF NOT EXISTS idx_calc_runs_debtor_id ON calculation_runs(debtor_id);
`);

module.exports = db;
