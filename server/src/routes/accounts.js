const express = require('express');
const crypto = require('crypto');
const db = require('../db');
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

// GET /api/accounts?q=&status=&sort=&dir=
router.get('/', (req, res) => {
  const { q, status, sort, dir } = req.query;
  const where = [];
  const params = {};

  if (q) {
    where.push(`(
      loan_number LIKE @q OR borrower_name LIKE @q OR
      coborrower_name LIKE @q OR property_address LIKE @q OR investor LIKE @q
    )`);
    params.q = `%${q}%`;
  }
  if (status) {
    where.push('performance_status = @status');
    params.status = status;
  }

  const sortCol = SORTABLE.has(sort) ? sort : 'updated_at';
  const sortDir = dir === 'asc' ? 'ASC' : 'DESC';

  const sql = `
    SELECT ${LIST_COLUMNS} FROM accounts
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${sortCol} ${sortDir}
  `;

  const rows = db.prepare(sql).all(params);
  res.json({ accounts: rows });
});

// GET /api/accounts/:id  (full record, including the raw field-value blob)
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Account not found' });
  res.json({ ...row, data: JSON.parse(row.data) });
});

// POST /api/accounts  { data?: { <field-id>: value, ... } }
router.post('/', (req, res) => {
  const data = (req.body && typeof req.body.data === 'object' && req.body.data) || {};
  const core = extractCoreFields(data);
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO accounts (
      id, loan_number, borrower_name, coborrower_name, property_address, investor,
      servicer, loan_type, interest_rate, principal_balance, origination_date,
      maturity_date, performance_status, settlement_status, data
    ) VALUES (
      @id, @loan_number, @borrower_name, @coborrower_name, @property_address, @investor,
      @servicer, @loan_type, @interest_rate, @principal_balance, @origination_date,
      @maturity_date, @performance_status, @settlement_status, @data
    )
  `).run({ id, ...core, data: JSON.stringify(data) });

  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  res.status(201).json({ ...row, data: JSON.parse(row.data) });
});

// PUT /api/accounts/:id  { data: { <field-id>: value, ... } }
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT id FROM accounts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Account not found' });

  const data = (req.body && typeof req.body.data === 'object' && req.body.data) || {};
  const core = extractCoreFields(data);

  db.prepare(`
    UPDATE accounts SET
      loan_number = @loan_number, borrower_name = @borrower_name,
      coborrower_name = @coborrower_name, property_address = @property_address,
      investor = @investor, servicer = @servicer, loan_type = @loan_type,
      interest_rate = @interest_rate, principal_balance = @principal_balance,
      origination_date = @origination_date, maturity_date = @maturity_date,
      performance_status = @performance_status, settlement_status = @settlement_status,
      data = @data, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = @id
  `).run({ id: req.params.id, ...core, data: JSON.stringify(data) });

  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  res.json({ ...row, data: JSON.parse(row.data) });
});

// DELETE /api/accounts/:id
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM accounts WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Account not found' });
  res.status(204).end();
});

module.exports = router;
