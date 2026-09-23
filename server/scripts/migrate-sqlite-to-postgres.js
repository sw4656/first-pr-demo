// One-time migration: copies loan accounts from the legacy on-disk SQLite
// database (server/data/loans.db) into the Postgres `accounts` table.
// Safe to re-run: existing rows are matched by id and overwritten.
//
// Usage:
//   DATABASE_URL=postgres://... node server/scripts/migrate-sqlite-to-postgres.js
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { pool, init } = require('../src/db');

const SQLITE_PATH = path.join(__dirname, '..', 'data', 'loans.db');

async function main() {
  if (!fs.existsSync(SQLITE_PATH)) {
    console.log(`No legacy SQLite database found at ${SQLITE_PATH} — nothing to migrate.`);
    process.exit(0);
  }

  await init();

  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  const rows = sqlite.prepare('SELECT * FROM accounts').all();
  sqlite.close();

  console.log(`Found ${rows.length} account(s) in the legacy SQLite database. Migrating...`);

  let migrated = 0;
  for (const row of rows) {
    let data;
    try {
      data = JSON.parse(row.data || '{}');
    } catch (err) {
      console.warn(`Skipping account ${row.id}: could not parse its data blob (${err.message})`);
      continue;
    }

    await pool.query(`
      INSERT INTO accounts (
        id, loan_number, borrower_name, coborrower_name, property_address, investor,
        servicer, loan_type, interest_rate, principal_balance, origination_date,
        maturity_date, performance_status, settlement_status, data, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT (id) DO UPDATE SET
        loan_number = EXCLUDED.loan_number, borrower_name = EXCLUDED.borrower_name,
        coborrower_name = EXCLUDED.coborrower_name, property_address = EXCLUDED.property_address,
        investor = EXCLUDED.investor, servicer = EXCLUDED.servicer, loan_type = EXCLUDED.loan_type,
        interest_rate = EXCLUDED.interest_rate, principal_balance = EXCLUDED.principal_balance,
        origination_date = EXCLUDED.origination_date, maturity_date = EXCLUDED.maturity_date,
        performance_status = EXCLUDED.performance_status, settlement_status = EXCLUDED.settlement_status,
        data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
    `, [
      row.id, row.loan_number, row.borrower_name, row.coborrower_name, row.property_address,
      row.investor, row.servicer, row.loan_type, row.interest_rate, row.principal_balance,
      row.origination_date, row.maturity_date, row.performance_status, row.settlement_status,
      data, row.created_at, row.updated_at,
    ]);
    migrated += 1;
  }

  console.log(`Migrated ${migrated} of ${rows.length} account(s) into Postgres.`);
  await pool.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
