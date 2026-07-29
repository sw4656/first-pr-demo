/** Data-access layer: translates between the camelCase objects used by
 * the API/calculation layers and the snake_case SQLite columns. */

const db = require("./db");

const DEBTOR_COLUMNS = [
  ["loanNumber", "loan_number"],
  ["borrowerName", "borrower_name"],
  ["ssn", "ssn"],
  ["address", "address"],
  ["phone", "phone"],
  ["email", "email"],
  ["lender", "lender"],
  ["investor", "investor"],
  ["lienPosition", "lien_position"],
  ["loanType", "loan_type"],
  ["originationDate", "origination_date"],
  ["principal", "principal"],
  ["ratePct", "rate_pct"],
  ["termMonths", "term_months"],
  ["dayCountConvention", "day_count_convention"],
  ["currentBalance", "current_balance"],
  ["propertyValue", "property_value"],
  ["escrowTaxMonthly", "escrow_tax_monthly"],
  ["escrowInsMonthly", "escrow_ins_monthly"],
  ["escrowPmiMonthly", "escrow_pmi_monthly"],
  ["escrowOtherMonthly", "escrow_other_monthly"],
  ["advances", "advances"],
  ["nsfFees", "nsf_fees"],
  ["legalFees", "legal_fees"],
  ["otherFees", "other_fees"],
  ["suspenseBalance", "suspense_balance"],
  ["missedPayments", "missed_payments"],
  ["daysPastDue", "days_past_due"],
];

function debtorRowToApi(row) {
  if (!row) return null;
  const out = { id: row.id, createdAt: row.created_at, updatedAt: row.updated_at };
  for (const [camel, snake] of DEBTOR_COLUMNS) out[camel] = row[snake];
  return out;
}

function createDebtor(data) {
  const cols = DEBTOR_COLUMNS.map(([, snake]) => snake);
  const placeholders = cols.map((c) => `@${c}`).join(", ");
  const params = {};
  for (const [camel, snake] of DEBTOR_COLUMNS) params[snake] = data[camel] ?? null;

  const stmt = db.prepare(`INSERT INTO debtors (${cols.join(", ")}) VALUES (${placeholders})`);
  const result = stmt.run(params);
  return getDebtorById(result.lastInsertRowid);
}

function getDebtorById(id) {
  const row = db.prepare("SELECT * FROM debtors WHERE id = ?").get(id);
  return debtorRowToApi(row);
}

function getDebtorByLoanNumber(loanNumber) {
  const row = db.prepare("SELECT * FROM debtors WHERE loan_number = ?").get(loanNumber);
  return debtorRowToApi(row);
}

function listDebtors({ offset = 0, limit = 50 } = {}) {
  const rows = db.prepare("SELECT * FROM debtors ORDER BY id LIMIT ? OFFSET ?").all(limit, offset);
  return rows.map(debtorRowToApi);
}

function updateDebtor(id, patch) {
  const entries = DEBTOR_COLUMNS.filter(([camel]) => patch[camel] !== undefined);
  if (entries.length === 0) return getDebtorById(id);

  const setClause = entries.map(([, snake]) => `${snake} = @${snake}`).join(", ");
  const params = { id };
  for (const [camel, snake] of entries) params[snake] = patch[camel];

  db.prepare(`UPDATE debtors SET ${setClause}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = @id`).run(
    params
  );
  return getDebtorById(id);
}

function deleteDebtor(id) {
  db.prepare("DELETE FROM debtors WHERE id = ?").run(id);
}

function paymentRowToApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    debtorId: row.debtor_id,
    dueDate: row.due_date,
    receivedDate: row.received_date,
    amountDue: row.amount_due,
    amountReceived: row.amount_received,
    lateCharge: row.late_charge,
    status: row.status,
  };
}

function addPayment(debtorId, data) {
  const stmt = db.prepare(`
    INSERT INTO payments (debtor_id, due_date, received_date, amount_due, amount_received, late_charge, status)
    VALUES (@debtorId, @dueDate, @receivedDate, @amountDue, @amountReceived, @lateCharge, @status)
  `);
  const result = stmt.run({
    debtorId,
    dueDate: data.dueDate,
    receivedDate: data.receivedDate ?? null,
    amountDue: data.amountDue,
    amountReceived: data.amountReceived,
    lateCharge: data.lateCharge,
    status: data.status,
  });
  return paymentRowToApi(db.prepare("SELECT * FROM payments WHERE id = ?").get(result.lastInsertRowid));
}

function listPayments(debtorId) {
  const rows = db.prepare("SELECT * FROM payments WHERE debtor_id = ? ORDER BY due_date").all(debtorId);
  return rows.map(paymentRowToApi);
}

function calcRunRowToApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    debtorId: row.debtor_id,
    computedAt: row.computed_at,
    basePayment: row.base_payment,
    escrowMonthly: row.escrow_monthly,
    totalPITI: row.total_piti,
    perDiem: row.per_diem,
    status: row.status,
    reinstatementNet: row.reinstatement_net,
  };
}

function addCalculationRun(debtorId, result) {
  const stmt = db.prepare(`
    INSERT INTO calculation_runs (debtor_id, base_payment, escrow_monthly, total_piti, per_diem, status)
    VALUES (@debtorId, @basePayment, @escrowMonthly, @totalPITI, @perDiem, @status)
  `);
  const inserted = stmt.run({
    debtorId,
    basePayment: result.basePayment,
    escrowMonthly: result.escrowMonthly,
    totalPITI: result.totalPITI,
    perDiem: result.perDiem,
    status: result.status,
  });
  return inserted.lastInsertRowid;
}

function setReinstatementOnLatestRun(debtorId, netReinstatement) {
  db.prepare(`
    UPDATE calculation_runs SET reinstatement_net = ?
    WHERE id = (SELECT id FROM calculation_runs WHERE debtor_id = ? ORDER BY computed_at DESC LIMIT 1)
  `).run(netReinstatement, debtorId);
}

function listCalculationRuns(debtorId) {
  const rows = db
    .prepare("SELECT * FROM calculation_runs WHERE debtor_id = ? ORDER BY computed_at DESC")
    .all(debtorId);
  return rows.map(calcRunRowToApi);
}

module.exports = {
  createDebtor,
  getDebtorById,
  getDebtorByLoanNumber,
  listDebtors,
  updateDebtor,
  deleteDebtor,
  addPayment,
  listPayments,
  addCalculationRun,
  setReinstatementOnLatestRun,
  listCalculationRuns,
};
