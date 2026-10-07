/**
 * ═══════════════════════════════════════════════════════════════
 *  WebNote Replacement BETA — Express API Server
 *  Asset Management Holdings II, LLC
 *
 *  Connects the calculator front end to Supabase PostgreSQL.
 *  Drop this file in your project root or server/ folder.
 *
 *  Setup:
 *    npm install express cors knex pg dotenv express-session connect-pg-simple
 *    node server.js
 *
 *  Requires server/.env (or root .env):
 *    DATABASE_URL=postgresql://...
 *    DATABASE_SSL=true
 *    SESSION_SECRET=<64 random chars>
 *    PORT=3000
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';
require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const session    = require('express-session');
const pgSession  = require('connect-pg-simple')(session);
const knex       = require('knex')({
  client: 'pg',
  connection: {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  },
  pool: { min: 2, max: 10 },
});

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ───────────────────────────────────────────────────────
app.use(cors({
  origin: true,          // allow requests from same host or localhost
  credentials: true,     // allow session cookies cross-origin in dev
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));   // serves calculator.html from /public

// Sessions stored in PostgreSQL so they survive server restarts
app.use(session({
  store: new pgSession({ pool: knex.client.pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000,   // 8 hours
    sameSite: 'lax',
  },
}));

// ── DB connection check ──────────────────────────────────────────────
knex.raw('SELECT 1')
  .then(() => console.log('[db] Supabase PostgreSQL connected ✓'))
  .catch(err => {
    console.error('[db] Connection failed:', err.message);
    console.error('     Check your DATABASE_URL in .env');
    process.exit(1);
  });

// ── Helpers ──────────────────────────────────────────────────────────

/** Strip $, commas from a currency string and return a float */
function parseMoney(val) {
  if (val == null) return 0;
  const n = parseFloat(String(val).replace(/[$,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

/** Pull indexed summary columns out of the raw 187-field blob */
function extractIndexed(fields, userId) {
  const firstName = fields['brow-first']  || '';
  const mi        = fields['brow-mi']     || '';
  const lastName  = fields['brow-last']   || '';
  const borrower  = [firstName, mi, lastName].filter(Boolean).join(' ').trim()
    || fields['mc-borrower'] || 'Unknown';

  const street = fields['prop-street'] || '';
  const city   = fields['prop-city']   || '';
  const state  = (fields['prop-state'] || '').toUpperCase().slice(0, 2) || null;
  const zip    = fields['prop-zip']    || '';

  return {
    loan_number:       fields['mc-loan-number'] || `WN-${Date.now()}`,
    investor_name:     fields['mc-investor-banner'] || fields['mc-investor'] || '',
    borrower_name:     borrower,
    co_borrower_name:  [fields['brow-co-first'], fields['brow-co-last']]
                         .filter(Boolean).join(' ').trim() || null,
    property_address:  [street, city && state ? `${city}, ${state}` : city || state, zip]
                         .filter(Boolean).join(' ') || null,
    property_city:     city || null,
    property_state:    state,
    property_zip:      zip || null,
    original_principal:parseMoney(fields['mc-principal']),
    current_upb:       parseMoney(fields['mc-balance']),
    annual_rate:       parseFloat(fields['mc-rate'])   || 0,
    amort_term_months: parseInt(fields['mc-term'])     || 0,
    missed_payments:   parseInt(fields['mc-missed'])   || 0,
    days_past_due:     parseInt(fields['mc-days'])     || 0,
    arrears:           parseMoney(fields['bal-arrears']),
    int_bal:           parseMoney(fields['bal-int-bal']),
    late_fee_bal:      parseMoney(fields['bal-late-fee-balance']),
    advance_bal:       parseMoney(fields['bal-advance-balance']),
    suspense_bal:      parseMoney(fields['mc-suspense']),
    deferred_bal:      parseMoney(fields['bal-deferred-balance']),
    impound_bal:       parseMoney(fields['bal-impound']),
    origination_date:  fields['mc-origination']    || null,
    maturity_date:     fields['mc-maturity-date']  || null,
    acquired_date:     fields['mc-acquired-date']  || null,
    next_due_date:     fields['mc-due-date']       || null,
    last_paid_date:    fields['bal-last-paid-date']|| null,
    loan_type: ['Conventional','Adjustable Rate','Per Diem','HELOC','Interest Only']
      .includes(fields['mc-loan-type']) ? fields['mc-loan-type'] : null,
    fc_status: ['none','pre','active','sale','bkr']
      .includes(fields['mc-fc-status']) ? fields['mc-fc-status'] : 'none',
    loan_status: 'active',
    field_data:  JSON.stringify(fields),
    updated_by:  userId || null,
  };
}

// ── Ensure the accounts table exists (auto-create if needed) ─────────
async function ensureSchema() {
  const exists = await knex.schema.hasTable('accounts');
  if (!exists) {
    console.log('[db] Creating accounts table...');
    await knex.schema.createTable('accounts', t => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.string('loan_number', 100).notNullable().unique();
      t.string('investor_name', 255);
      t.string('borrower_name', 255).notNullable().defaultTo('');
      t.string('co_borrower_name', 255);
      t.string('property_address', 500);
      t.string('property_city', 100);
      t.specificType('property_state', 'CHAR(2)');
      t.string('property_zip', 10);
      t.decimal('original_principal', 14, 2).defaultTo(0);
      t.decimal('current_upb', 14, 2).defaultTo(0);
      t.decimal('annual_rate', 8, 5).defaultTo(0);
      t.integer('amort_term_months').defaultTo(0);
      t.integer('missed_payments').defaultTo(0);
      t.integer('days_past_due').defaultTo(0);
      t.decimal('arrears', 14, 2).defaultTo(0);
      t.decimal('int_bal', 14, 2).defaultTo(0);
      t.decimal('late_fee_bal', 14, 2).defaultTo(0);
      t.decimal('advance_bal', 14, 2).defaultTo(0);
      t.decimal('suspense_bal', 14, 2).defaultTo(0);
      t.decimal('deferred_bal', 14, 2).defaultTo(0);
      t.decimal('impound_bal', 14, 2).defaultTo(0);
      t.date('origination_date');
      t.date('maturity_date');
      t.date('acquired_date');
      t.date('next_due_date');
      t.date('last_paid_date');
      t.string('loan_type', 50);
      t.string('fc_status', 50).defaultTo('none');
      t.string('loan_status', 50).defaultTo('active');
      t.jsonb('field_data').defaultTo('{}');
      t.timestamp('deleted_at');
      t.uuid('updated_by');
      t.timestamps(true, true);
    });
    console.log('[db] accounts table created ✓');
  }

  const eventsExist = await knex.schema.hasTable('loan_events');
  if (!eventsExist) {
    console.log('[db] Creating loan_events table...');
    await knex.schema.createTable('loan_events', t => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
      t.string('event_type', 100).notNullable();
      t.decimal('balance_after', 14, 2);
      t.text('description');
      t.jsonb('payload');
      t.string('performed_by_label', 255).defaultTo('system');
      t.timestamp('performed_at').defaultTo(knex.fn.now());
    });
    await knex.schema.table('loan_events', t => {
      t.index(['account_id', 'performed_at']);
    });
    console.log('[db] loan_events table created ✓');
  }
}

// ════════════════════════════════════════════════════════════════════
//  ROUTES
// ════════════════════════════════════════════════════════════════════

/**
 * GET /api/health
 * Quick health check — confirms the server and DB are alive
 */
app.get('/api/health', async (req, res) => {
  try {
    await knex.raw('SELECT 1');
    res.json({ status: 'ok', db: 'connected', ts: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', message: err.message });
  }
});

/**
 * GET /api/accounts
 * Portfolio list — returns summary rows for all active loans.
 * Supports: ?search=, ?status=, ?limit=, ?offset=
 */
app.get('/api/accounts', async (req, res) => {
  try {
    const { search, status, limit = 100, offset = 0 } = req.query;
    const q = knex('accounts')
      .select(
        'id', 'loan_number', 'borrower_name', 'investor_name',
        'property_address', 'property_city', 'property_state',
        'current_upb', 'annual_rate', 'missed_payments',
        'days_past_due', 'loan_status', 'fc_status',
        'next_due_date', 'updated_at'
      )
      .whereNull('deleted_at')
      .orderBy('days_past_due', 'desc')
      .orderBy('updated_at', 'desc')
      .limit(parseInt(limit))
      .offset(parseInt(offset));
    if (search) {
      q.where(function () {
        this.whereILike('borrower_name', `%${search}%`)
            .orWhereILike('loan_number',   `%${search}%`);
      });
    }
    if (status) q.where('loan_status', status);
    const rows = await q;
    res.json({ accounts: rows, count: rows.length });
  } catch (err) {
    console.error('[GET /accounts]', err.message);
    res.status(500).json({ error: 'Failed to load portfolio', detail: err.message });
  }
});

/**
 * POST /api/accounts
 * Create a new loan record.
 * Body: { fields: { ...187 field IDs... } }
 */
app.post('/api/accounts', async (req, res) => {
  try {
    const fields  = req.body.fields || req.body;
    const indexed = extractIndexed(fields, null);
    indexed.created_at = new Date();
    indexed.updated_at = new Date();

    const [row] = await knex('accounts').insert(indexed).returning(['id', 'loan_number']);

    if (row?.id) {
      await knex('loan_events').insert({
        account_id:         row.id,
        event_type:         'loan_created',
        description:        `Loan ${indexed.loan_number} created`,
        performed_by_label: 'system',
      }).catch(() => {});
    }

    res.status(201).json({ success: true, id: row?.id, loan_number: row?.loan_number });
  } catch (err) {
    if (err.code === '23505')
      return res.status(409).json({ error: 'Loan number already exists' });
    console.error('[POST /accounts]', err.message);
    res.status(500).json({ error: 'Failed to create loan', detail: err.message });
  }
});

/**
 * GET /api/accounts/:id
 * Load one loan — returns the full field_data blob.
 * The calculator uses this to repopulate all 187 fields on load.
 */
app.get('/api/accounts/:id', async (req, res) => {
  try {
    const row = await knex('accounts')
      .where({ id: req.params.id })
      .whereNull('deleted_at')
      .first();
    if (!row) return res.status(404).json({ error: 'Loan not found' });
    const fields = typeof row.field_data === 'string'
      ? JSON.parse(row.field_data) : (row.field_data || {});
    res.json({ id: row.id, fields, loan_number: row.loan_number });
  } catch (err) {
    console.error('[GET /accounts/:id]', err.message);
    res.status(500).json({ error: 'Failed to load loan', detail: err.message });
  }
});

/**
 * PUT /api/accounts/:id
 * Save / update a loan.  Atomic: updates account + inserts audit event.
 */
app.put('/api/accounts/:id', async (req, res) => {
  try {
    const { id }  = req.params;
    const fields  = req.body.fields || req.body;
    const indexed = extractIndexed(fields, null);
    indexed.updated_at = new Date();

    await knex.transaction(async trx => {
      const updated = await trx('accounts')
        .where({ id }).whereNull('deleted_at').update(indexed);
      if (!updated) throw new Error('NOT_FOUND');

      await trx('loan_events').insert({
        account_id:         id,
        event_type:         'loan_saved',
        balance_after:      parseMoney(fields['mc-balance']),
        description:        `Saved — UPB $${parseMoney(fields['mc-balance']).toLocaleString()}`,
        payload:            JSON.stringify({
          loan_number:     indexed.loan_number,
          current_upb:     indexed.current_upb,
          missed_payments: indexed.missed_payments,
        }),
        performed_by_label: 'user',
      }).catch(() => {});
    });

    res.json({ success: true, id });
  } catch (err) {
    if (err.message === 'NOT_FOUND')
      return res.status(404).json({ error: 'Loan not found' });
    if (err.code === '23505')
      return res.status(409).json({ error: 'Loan number already exists' });
    console.error('[PUT /accounts/:id]', err.message);
    res.status(500).json({ error: 'Failed to save loan', detail: err.message });
  }
});

/**
 * DELETE /api/accounts/:id
 * Soft-delete — sets deleted_at, never removes the row.
 */
app.delete('/api/accounts/:id', async (req, res) => {
  try {
    const updated = await knex('accounts')
      .where({ id: req.params.id }).whereNull('deleted_at')
      .update({ deleted_at: new Date(), updated_at: new Date() });
    if (!updated) return res.status(404).json({ error: 'Loan not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /accounts/:id]', err.message);
    res.status(500).json({ error: 'Failed to delete loan', detail: err.message });
  }
});

/**
 * GET /api/accounts/:id/events
 * Audit history for a single loan.
 */
app.get('/api/accounts/:id/events', async (req, res) => {
  try {
    const events = await knex('loan_events')
      .where({ account_id: req.params.id })
      .orderBy('performed_at', 'desc')
      .limit(100);
    res.json({ events });
  } catch (err) {
    console.error('[GET /events]', err.message);
    res.status(500).json({ error: 'Failed to load events', detail: err.message });
  }
});

/**
 * GET /api/portfolio/summary
 * Delinquency bucket counts and total UPB — powers the dashboard strip.
 */
app.get('/api/portfolio/summary', async (req, res) => {
  try {
    const rows = await knex('accounts')
      .whereNull('deleted_at')
      .where('loan_status', 'active')
      .select(
        knex.raw(`
          COUNT(*) AS total_loans,
          SUM(current_upb) AS total_upb,
          SUM(CASE WHEN days_past_due = 0 THEN 1 ELSE 0 END) AS current_count,
          SUM(CASE WHEN days_past_due BETWEEN 1 AND 29 THEN 1 ELSE 0 END) AS dpd_1_29,
          SUM(CASE WHEN days_past_due BETWEEN 30 AND 59 THEN 1 ELSE 0 END) AS dpd_30_59,
          SUM(CASE WHEN days_past_due BETWEEN 60 AND 89 THEN 1 ELSE 0 END) AS dpd_60_89,
          SUM(CASE WHEN days_past_due >= 90 THEN 1 ELSE 0 END) AS dpd_90_plus
        `)
      )
      .first();
    res.json(rows);
  } catch (err) {
    console.error('[GET /summary]', err.message);
    res.status(500).json({ error: 'Failed to load summary', detail: err.message });
  }
});

// ── Start ────────────────────────────────────────────────────────────
ensureSchema().then(() => {
  app.listen(PORT, () => {
    console.log(`\n╔══════════════════════════════════════════╗`);
    console.log(`║  WebNote API running on port ${PORT}        ║`);
    console.log(`║  Calculator: http://localhost:${PORT}       ║`);
    console.log(`║  Health:     http://localhost:${PORT}/api/health ║`);
    console.log(`╚══════════════════════════════════════════╝\n`);
  });
}).catch(err => {
  console.error('Schema setup failed:', err.message);
  process.exit(1);
});
