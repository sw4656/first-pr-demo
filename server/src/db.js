const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'loans.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    loan_number TEXT,
    borrower_name TEXT,
    coborrower_name TEXT,
    property_address TEXT,
    investor TEXT,
    servicer TEXT,
    loan_type TEXT,
    interest_rate REAL,
    principal_balance REAL,
    origination_date TEXT,
    maturity_date TEXT,
    performance_status TEXT,
    settlement_status TEXT,
    data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_accounts_loan_number ON accounts(loan_number);
  CREATE INDEX IF NOT EXISTS idx_accounts_borrower_name ON accounts(borrower_name);
  CREATE INDEX IF NOT EXISTS idx_accounts_performance_status ON accounts(performance_status);
`);

module.exports = db;
