const express = require("express");
const { z } = require("zod");

const calc = require("./calculations");
const repo = require("./repository");
const { DebtorCreate, DebtorUpdate, PaymentCreate, ReinstatementInput } = require("./schemas");

const app = express();
app.use(express.json());

function validate(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    const err = new Error("Validation failed");
    err.status = 422;
    err.details = result.error.issues;
    throw err;
  }
  return result.data;
}

function requireDebtor(req, res, next) {
  const id = Number(req.params.debtorId);
  const debtor = repo.getDebtorById(id);
  if (!debtor) return res.status(404).json({ detail: "Debtor not found" });
  req.debtor = debtor;
  next();
}

function runLoanCalc(debtor) {
  return calc.calcLoan({
    principal: debtor.principal,
    ratePct: debtor.ratePct,
    termMonths: debtor.termMonths,
    currentBalance: debtor.currentBalance,
    escrowTaxMonthly: debtor.escrowTaxMonthly,
    escrowInsMonthly: debtor.escrowInsMonthly,
    escrowPmiMonthly: debtor.escrowPmiMonthly,
    escrowOtherMonthly: debtor.escrowOtherMonthly,
    advances: debtor.advances,
    nsfFees: debtor.nsfFees,
    legalFees: debtor.legalFees,
    otherFees: debtor.otherFees,
    suspenseBalance: debtor.suspenseBalance,
    daysPastDue: debtor.daysPastDue,
    missedPayments: debtor.missedPayments,
    dayCountConvention: debtor.dayCountConvention,
    propertyValue: debtor.propertyValue,
  });
}

// ── Debtors ────────────────────────────────────────────────────────

app.post("/debtors", (req, res) => {
  const payload = validate(DebtorCreate, req.body);
  if (repo.getDebtorByLoanNumber(payload.loanNumber)) {
    return res.status(409).json({ detail: "loan_number already exists" });
  }
  const debtor = repo.createDebtor(payload);
  res.status(201).json(debtor);
});

app.get("/debtors", (req, res) => {
  const offset = Number(req.query.offset) || 0;
  const limit = Number(req.query.limit) || 50;
  res.json(repo.listDebtors({ offset, limit }));
});

app.get("/debtors/:debtorId", requireDebtor, (req, res) => {
  res.json(req.debtor);
});

app.patch("/debtors/:debtorId", requireDebtor, (req, res) => {
  const payload = validate(DebtorUpdate, req.body);
  res.json(repo.updateDebtor(req.debtor.id, payload));
});

app.delete("/debtors/:debtorId", requireDebtor, (req, res) => {
  repo.deleteDebtor(req.debtor.id);
  res.status(204).end();
});

// ── Payment history ──────────────────────────────────────────────────

app.post("/debtors/:debtorId/payments", requireDebtor, (req, res) => {
  const payload = validate(PaymentCreate, req.body);
  const payment = repo.addPayment(req.debtor.id, payload);
  res.status(201).json(payment);
});

app.get("/debtors/:debtorId/payments", requireDebtor, (req, res) => {
  res.json(repo.listPayments(req.debtor.id));
});

// ── Calculation unit ─────────────────────────────────────────────────

app.post("/debtors/:debtorId/calculate", requireDebtor, (req, res) => {
  const result = runLoanCalc(req.debtor);
  repo.addCalculationRun(req.debtor.id, result);
  res.json(result);
});

app.get("/debtors/:debtorId/amortization", requireDebtor, (req, res) => {
  const debtor = req.debtor;
  const result = runLoanCalc(debtor);
  const schedule = calc.buildAmortizationSchedule(
    debtor.principal,
    debtor.ratePct,
    debtor.termMonths,
    result.escrowMonthly,
    calc.parseDateOnly(debtor.originationDate)
  );
  res.json(schedule);
});

app.post("/debtors/:debtorId/reinstatement", requireDebtor, (req, res) => {
  const payload = validate(ReinstatementInput, req.body);
  const debtor = req.debtor;
  const loan = runLoanCalc(debtor);
  const result = calc.calcReinstatement({
    loan,
    missedPayments: debtor.missedPayments,
    daysPastDue: debtor.daysPastDue,
    perDiemDays: payload.perDiemDays,
    fcCosts: payload.fcCosts,
    titleFees: payload.titleFees,
    propertyPreservation: payload.propertyPreservation,
    bankruptcyCosts: payload.bankruptcyCosts,
    escrowShortage: payload.escrowShortage,
    suspenseCredit: payload.suspenseCredit,
    partialPaymentCredit: payload.partialPaymentCredit,
    advances: debtor.advances,
    nsfFees: debtor.nsfFees,
    lastPaidInstallment: calc.parseDateOnly(payload.lastPaidInstallment),
    dueDate: calc.parseDateOnly(payload.dueDate),
  });

  repo.setReinstatementOnLatestRun(debtor.id, result.netReinstatement);
  res.json(result);
});

app.get("/debtors/:debtorId/calculation-runs", requireDebtor, (req, res) => {
  res.json(repo.listCalculationRuns(req.debtor.id));
});

// ── Error handling ───────────────────────────────────────────────────

app.use((err, req, res, next) => {
  if (err instanceof z.ZodError || err.status === 422) {
    return res.status(422).json({ detail: err.details ?? err.message });
  }
  console.error(err);
  res.status(500).json({ detail: "Internal server error" });
});

if (require.main === module) {
  const PORT = process.env.PORT || 8000;
  app.listen(PORT, () => console.log(`Loan Servicing API listening on :${PORT}`));
}

module.exports = app;
