const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      loan_number TEXT,
      borrower_name TEXT,
      coborrower_name TEXT,
      property_address TEXT,
      investor TEXT,
      servicer TEXT,
      loan_type TEXT,
      interest_rate DOUBLE PRECISION,
      principal_balance DOUBLE PRECISION,
      origination_date TEXT,
      maturity_date TEXT,
      performance_status TEXT,
      settlement_status TEXT,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_accounts_loan_number ON accounts(loan_number);
    CREATE INDEX IF NOT EXISTS idx_accounts_borrower_name ON accounts(borrower_name);
    CREATE INDEX IF NOT EXISTS idx_accounts_performance_status ON accounts(performance_status);

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

module.exports = { pool, init };
