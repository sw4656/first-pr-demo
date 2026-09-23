const express = require('express');
const crypto = require('crypto');
const { pool } = require('../db');
const { extractCoreFields } = require('../fields');

const router = express.Router();

const LIST_COLUMNS = `
  id, loan_number, borrower_name, coborrower_name, property_address, investor,
  servicer, loan_type, interest_rate, principal_balance, origination_date,
  maturity_date, performance_status, settlement_status, created_at, updated_at
`;

const SORTABLE = new Set([
  'loan_number', 'borrower_name', 'property_address', 'investor',
  'interest_rate', 'principal_balance', 'origination_date', 'maturity_date',
  'performance_status', 'created_at', 'updated_at',
]);

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

function coreFieldValues(core) {
  return [
    core.loan_number, core.borrower_name, core.coborrower_name, core.property_address,
    core.investor, core.servicer, core.loan_type, core.interest_rate, core.principal_balance,
    core.origination_date, core.maturity_date, core.performance_status, core.settlement_status,
  ];
}

// GET /api/accounts?q=&status=&sort=&dir=
router.get('/', asyncHandler(async (req, res) => {
  const { q, status, sort, dir } = req.query;
  const where = [];
  const params = [];

  if (q) {
    params.push(`%${q}%`);
    const p = params.length;
    where.push(`(
      loan_number ILIKE $${p} OR borrower_name ILIKE $${p} OR
      coborrower_name ILIKE $${p} OR property_address ILIKE $${p} OR investor ILIKE $${p}
    )`);
  }
  if (status) {
    params.push(status);
    where.push(`performance_status = $${params.length}`);
  }

  const sortCol = SORTABLE.has(sort) ? sort : 'updated_at';
  const sortDir = dir === 'asc' ? 'ASC' : 'DESC';

  const sql = `
    SELECT ${LIST_COLUMNS} FROM accounts
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${sortCol} ${sortDir}
  `;

  const { rows } = await pool.query(sql, params);
  res.json({ accounts: rows });
}));

// GET /api/accounts/:id  (full record, including the raw field-value blob)
router.get('/:id', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM accounts WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Account not found' });
  res.json(rows[0]);
}));

// POST /api/accounts  { data?: { <field-id>: value, ... } }
router.post('/', asyncHandler(async (req, res) => {
  const data = (req.body && typeof req.body.data === 'object' && req.body.data) || {};
  const core = extractCoreFields(data);
  const id = crypto.randomUUID();

  await pool.query(`
    INSERT INTO accounts (
      id, loan_number, borrower_name, coborrower_name, property_address, investor,
      servicer, loan_type, interest_rate, principal_balance, origination_date,
      maturity_date, performance_status, settlement_status, data
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
  `, [id, ...coreFieldValues(core), data]);

  const { rows } = await pool.query('SELECT * FROM accounts WHERE id = $1', [id]);
  res.status(201).json(rows[0]);
}));

// PUT /api/accounts/:id  { data: { <field-id>: value, ... } }
router.put('/:id', asyncHandler(async (req, res) => {
  const { rows: existing } = await pool.query('SELECT id FROM accounts WHERE id = $1', [req.params.id]);
  if (!existing[0]) return res.status(404).json({ error: 'Account not found' });

  const data = (req.body && typeof req.body.data === 'object' && req.body.data) || {};
  const core = extractCoreFields(data);

  await pool.query(`
    UPDATE accounts SET
      loan_number = $1, borrower_name = $2, coborrower_name = $3, property_address = $4,
      investor = $5, servicer = $6, loan_type = $7, interest_rate = $8, principal_balance = $9,
      origination_date = $10, maturity_date = $11, performance_status = $12, settlement_status = $13,
      data = $14, updated_at = now()
    WHERE id = $15
  `, [...coreFieldValues(core), data, req.params.id]);

  const { rows } = await pool.query('SELECT * FROM accounts WHERE id = $1', [req.params.id]);
  res.json(rows[0]);
}));

// DELETE /api/accounts/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM accounts WHERE id = $1', [req.params.id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Account not found' });
  res.status(204).end();
}));

module.exports = router;
