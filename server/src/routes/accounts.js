/**
 * routes/accounts.js  —  PostgreSQL version
 *
 * Drop-in replacement for the existing accounts.js route file.
 * All five core routes preserved; SQLite synchronous calls
 * replaced with async Knex queries.
 *
 * Routes:
 *   GET    /api/accounts          — portfolio list
 *   POST   /api/accounts          — create new loan
 *   GET    /api/accounts/:id      — load one loan (all 187 fields)
 *   PUT    /api/accounts/:id      — save / update loan
 *   DELETE /api/accounts/:id      — soft-delete loan
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Parse a currency-formatted string to a float.
 * Strips $, commas, and whitespace.  Returns 0 on failure.
 */
function parseMoney(val) {
  if (val === null || val === undefined) return 0;
  const n = parseFloat(String(val).replace(/[$,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

/**
 * Extract the indexed summary columns from the raw field_data blob.
 * These columns power portfolio queries without touching the JSONB.
 */
function extractIndexed(fields, userId) {
  // Assemble borrower name from split fields
  const firstName  = fields['brow-first']  || '';
  const mi         = fields['brow-mi']     || '';
  const lastName   = fields['brow-last']   || '';
  const borrower   = [firstName, mi, lastName].filter(Boolean).join(' ').trim()
    || fields['mc-borrower'] || '';

  const coBorrFirst = fields['brow-co-first'] || '';
  const coBorrLast  = fields['brow-co-last']  || '';
  const coBorrower  = [coBorrFirst, coBorrLast].filter(Boolean).join(' ').trim();

  // Assemble property address
  const street = fields['prop-street'] || '';
  const city   = fields['prop-city']   || '';
  const state  = fields['prop-state']  || '';
  const zip    = fields['prop-zip']    || '';
  const addr   = [street, city && state ? `${city}, ${state}` : city || state, zip]
    .filter(Boolean).join(' ');

  return {
    loan_number:        fields['mc-loan-number']    || `LOAN-${Date.now()}`,
    investor_name:      fields['mc-investor-banner'] || fields['mc-investor'] || '',
    borrower_name:      borrower,
    co_borrower_name:   coBorrower,
    property_address:   addr,
    property_city:      city,
    property_state:     (state || '').toUpperCase().slice(0, 2) || null,
    property_zip:       zip,

    original_principal: parseMoney(fields['mc-principal']),
    current_upb:        parseMoney(fields['mc-balance']),
    annual_rate:        parseFloat(fields['mc-rate'])     || 0,
    amort_term_months:  parseInt(fields['mc-term'])       || 0,
    missed_payments:    parseInt(fields['mc-missed'])     || 0,
    days_past_due:      parseInt(fields['mc-days'])       || 0,
    arrears:            parseMoney(fields['bal-arrears']),
    int_bal:            parseMoney(fields['bal-int-bal']),
    late_fee_bal:       parseMoney(fields['bal-late-fee-balance']),
    advance_bal:        parseMoney(fields['bal-advance-balance']),
    suspense_bal:       parseMoney(fields['mc-suspense']),
    deferred_bal:       parseMoney(fields['bal-deferred-balance']),
    impound_bal:        parseMoney(fields['bal-impound']),

    origination_date:   fields['mc-origination']    || null,
    maturity_date:      fields['mc-maturity-date']  || null,
    acquired_date:      fields['mc-acquired-date']  || null,
    next_due_date:      fields['mc-due-date']        || null,
    last_paid_date:     fields['bal-last-paid-date'] || null,

    loan_type:  ['Conventional','Adjustable Rate','Per Diem']
      .includes(fields['mc-loan-type']) ? fields['mc-loan-type'] : null,
    fc_status:  ['none','pre','active','sale','bkr']
      .includes(fields['mc-fc-status']) ? fields['mc-fc-status'] : 'none',

    field_data: JSON.stringify(fields),
    updated_by: userId || null,
  };
}

// ── GET /api/accounts  —  portfolio list ─────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { search, status, fc_status, limit = 100, offset = 0 } = req.query;

    const query = db('accounts as a')
      .leftJoin('users as u', 'u.id', 'a.assigned_to')
      .select(
        'a.id', 'a.loan_number', 'a.borrower_name', 'a.investor_name',
        'a.property_address', 'a.property_city', 'a.property_state',
        'a.current_upb', 'a.annual_rate', 'a.missed_payments',
        'a.days_past_due', 'a.loan_status', 'a.fc_status',
        'a.next_due_date', 'a.acquired_date', 'a.updated_at',
        'u.full_name as assigned_to_name',
        // Delinquency bucket computed inline
        db.raw(`
          CASE
            WHEN a.days_past_due = 0              THEN 'current'
            WHEN a.days_past_due BETWEEN 1 AND 29 THEN '1-29'
            WHEN a.days_past_due BETWEEN 30 AND 59 THEN '30-59'
            WHEN a.days_past_due BETWEEN 60 AND 89 THEN '60-89'
            WHEN a.days_past_due BETWEEN 90 AND 119 THEN '90-119'
            ELSE '120+'
          END AS delinquency_bucket
        `)
      )
      .whereNull('a.deleted_at')
      .orderBy('a.days_past_due', 'desc')
      .orderBy('a.updated_at', 'desc')
      .limit(parseInt(limit))
      .offset(parseInt(offset));

    if (search) {
      query.where(function () {
        this.whereILike('a.borrower_name', `%${search}%`)
            .orWhereILike('a.loan_number',   `%${search}%`)
            .orWhereILike('a.property_address', `%${search}%`);
      });
    }
    if (status)    query.where('a.loan_status', status);
    if (fc_status) query.where('a.fc_status',   fc_status);

    const rows = await query;
    res.json({ accounts: rows, count: rows.length });
  } catch (err) {
    console.error('[GET /accounts]', err);
    res.status(500).json({ error: 'Failed to load portfolio' });
  }
});

// ── POST /api/accounts  —  create new loan ────────────────────────────
router.post('/', async (req, res) => {
  try {
    const fields  = req.body.fields || req.body || {};
    const userId  = req.session?.userId || null;
    const indexed = extractIndexed(fields, userId);
    indexed.created_by = userId;

    const [row] = await db('accounts')
      .insert(indexed)
      .returning(['id', 'loan_number', 'created_at']);

    // Write creation event to audit log
    if (row?.id) {
      await db('loan_events').insert({
        account_id:   row.id,
        event_type:   'loan_created',
        description:  `Loan ${indexed.loan_number} created`,
        payload:      JSON.stringify({ loan_number: indexed.loan_number }),
        performed_by: userId || (await db('users').select('id').first())?.id,
      }).catch(() => {}); // non-fatal if no user yet
    }

    res.status(201).json({ success: true, id: row?.id, loan_number: row?.loan_number });
  } catch (err) {
    if (err.code === '23505') {          // unique_violation (duplicate loan number)
      return res.status(409).json({ error: 'Loan number already exists' });
    }
    console.error('[POST /accounts]', err);
    res.status(500).json({ error: 'Failed to create loan' });
  }
});

// ── GET /api/accounts/:id  —  load one loan ───────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const row = await db('accounts')
      .where({ id: req.params.id })
      .whereNull('deleted_at')
      .first();

    if (!row) return res.status(404).json({ error: 'Loan not found' });

    // Return field_data blob — the bridge uses this to populate the face page
    const fields = typeof row.field_data === 'string'
      ? JSON.parse(row.field_data)
      : (row.field_data || {});

    res.json({ id: row.id, fields, loan_number: row.loan_number });
  } catch (err) {
    console.error('[GET /accounts/:id]', err);
    res.status(500).json({ error: 'Failed to load loan' });
  }
});

// ── PUT /api/accounts/:id  —  save / update loan ─────────────────────
router.put('/:id', async (req, res) => {
  try {
    const { id }  = req.params;
    const fields  = req.body.fields || req.body || {};
    const userId  = req.session?.userId || null;
    const indexed = extractIndexed(fields, userId);

    // Atomic transaction: update account + insert audit event
    await db.transaction(async trx => {
      const updated = await trx('accounts')
        .where({ id })
        .whereNull('deleted_at')
        .update(indexed);

      if (!updated) throw new Error('Loan not found or already deleted');

      await trx('loan_events').insert({
        account_id:   id,
        event_type:   'loan_saved',
        balance_after: parseMoney(fields['mc-balance']),
        description:  `Loan saved by user`,
        payload:      JSON.stringify({
          loan_number:    indexed.loan_number,
          current_upb:    indexed.current_upb,
          missed_payments:indexed.missed_payments,
        }),
        performed_by: userId || (await trx('users').select('id').first())?.id,
      }).catch(() => {}); // non-fatal if no user configured yet
    });

    res.json({ success: true, id });
  } catch (err) {
    if (err.message === 'Loan not found or already deleted') {
      return res.status(404).json({ error: err.message });
    }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Loan number already exists' });
    }
    console.error('[PUT /accounts/:id]', err);
    res.status(500).json({ error: 'Failed to save loan' });
  }
});

// ── DELETE /api/accounts/:id  —  soft-delete ──────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.session?.userId || null;

    const updated = await db('accounts')
      .where({ id: req.params.id })
      .whereNull('deleted_at')
      .update({
        deleted_at: db.fn.now(),
        updated_by: userId,
      });

    if (!updated) return res.status(404).json({ error: 'Loan not found' });

    await db('loan_events').insert({
      account_id:  req.params.id,
      event_type:  'loan_deleted',
      description: 'Loan soft-deleted',
      payload:     JSON.stringify({ deleted_by: userId }),
      performed_by: userId || (await db('users').select('id').first())?.id,
    }).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /accounts/:id]', err);
    res.status(500).json({ error: 'Failed to delete loan' });
  }
});

// ── GET /api/accounts/:id/events  —  audit history ───────────────────
router.get('/:id/events', async (req, res) => {
  try {
    const events = await db('loan_events as e')
      .join('users as u', 'u.id', 'e.performed_by')
      .select(
        'e.id', 'e.event_type', 'e.amount', 'e.principal',
        'e.interest_amt', 'e.escrow_amt', 'e.fees_amt',
        'e.balance_before', 'e.balance_after',
        'e.description', 'e.performed_at',
        'u.full_name as performed_by'
      )
      .where('e.account_id', req.params.id)
      .orderBy('e.performed_at', 'desc')
      .limit(200);

    res.json({ events });
  } catch (err) {
    console.error('[GET /accounts/:id/events]', err);
    res.status(500).json({ error: 'Failed to load events' });
  }
});

module.exports = router;
