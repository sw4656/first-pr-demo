/**
 * Pure loan-math calculation unit.
 *
 * Ported from the mortgage calculator artifact's client-side JS
 * (calcBase, buildSchedule, calcReinstatement, updateServicing) so the
 * same figures can be computed server-side against data stored in the
 * debtor database. No I/O or DB access happens in this module -- it
 * only takes plain numbers/dates in and returns plain objects out.
 */

const MONTHS_PER_YEAR = 12;
const GRACE_PERIOD_DAYS = 15;
const LATE_CHARGE_RATE = 0.05;

function round2(v) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

function round4(v) {
  return Math.round((v + Number.EPSILON) * 10000) / 10000;
}

/** Parses a "YYYY-MM-DD" string into a local-midnight Date (avoids the
 * UTC-parsing timezone shift that `new Date(str)` produces). */
function parseDateOnly(str) {
  if (!str) return null;
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDateOnly(date) {
  if (!date) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function monthsBetween(d1, d2) {
  return Math.max(0, (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth()));
}

/** Standard fixed-rate monthly P&I payment: M = P[r(1+r)^n]/[(1+r)^n-1]. */
function calcBasePayment(principal, ratePct, termMonths) {
  if (termMonths <= 0) return 0;
  const r = ratePct / 100;
  if (r === 0) return round2(principal / termMonths);
  const mr = r / MONTHS_PER_YEAR;
  const f = Math.pow(1 + mr, termMonths);
  return round2((principal * (mr * f)) / (f - 1));
}

/** Port of the artifact's calculate(): base payment, interest/principal
 * split, per-diem accrual, late charge, and PITI. */
function calcLoan({
  principal,
  ratePct,
  termMonths,
  currentBalance,
  escrowTaxMonthly = 0,
  escrowInsMonthly = 0,
  escrowPmiMonthly = 0,
  escrowOtherMonthly = 0,
  advances = 0,
  nsfFees = 0,
  legalFees = 0,
  otherFees = 0,
  suspenseBalance = 0,
  daysPastDue = 0,
  missedPayments = 0,
  applyPerDiem = true,
  autoLateCharge = true,
  manualLateCharge = 0,
  dayCountConvention = 360,
  propertyValue = null,
}) {
  const r = ratePct / 100;
  const base = calcBasePayment(principal, ratePct, termMonths);
  const interest = round2((currentBalance * r) / MONTHS_PER_YEAR);
  const principalPortion = round2(Math.max(base - interest, 0));
  const perDiem = round4((currentBalance * r) / dayCountConvention);
  const perDiemAccrual = applyPerDiem ? round2(perDiem * daysPastDue) : 0;

  const lateCharge = autoLateCharge
    ? daysPastDue > GRACE_PERIOD_DAYS
      ? round2(base * LATE_CHARGE_RATE)
      : 0
    : manualLateCharge;

  const escrowMonthly = round2(escrowTaxMonthly + escrowInsMonthly + escrowPmiMonthly + escrowOtherMonthly);
  const totalFees = round2(nsfFees + legalFees + otherFees);
  const totalPI = round2(base + perDiemAccrual + advances + lateCharge + totalFees - suspenseBalance);
  const totalPITI = round2(totalPI + escrowMonthly);

  const ltvPct = propertyValue ? round2((currentBalance / propertyValue) * 100) : null;
  const equity = propertyValue ? round2(propertyValue - currentBalance) : null;

  let status;
  if (missedPayments > 3) status = "seriously_delinquent";
  else if (missedPayments > 0) status = "delinquent";
  else if (daysPastDue > 0) status = "past_due";
  else status = "current";

  return {
    basePayment: base,
    interest,
    principalPortion,
    perDiem,
    perDiemAccrual,
    lateCharge,
    totalFees,
    totalPI,
    escrowMonthly,
    totalPITI,
    ltvPct,
    equity,
    status,
  };
}

/** Port of buildSchedule(): full amortization table for the loan's
 * original terms (not the current delinquent balance). */
function buildAmortizationSchedule(principal, ratePct, termMonths, escrowMonthly = 0, originationDate = null) {
  const r = ratePct / 100;
  const base = calcBasePayment(principal, ratePct, termMonths);
  let balance = principal;
  let cumulativeInterest = 0;
  let cumulativePrincipal = 0;
  const schedule = [];

  for (let month = 1; month <= termMonths; month++) {
    const interest = round2((balance * r) / MONTHS_PER_YEAR);
    const principalPaid = round2(Math.min(base - interest, balance));
    balance = round2(Math.max(balance - principalPaid, 0));
    cumulativeInterest = round2(cumulativeInterest + interest);
    cumulativePrincipal = round2(cumulativePrincipal + principalPaid);

    let paymentDate = null;
    if (originationDate) {
      paymentDate = new Date(originationDate.getFullYear(), originationDate.getMonth() + month, 1);
    }

    schedule.push({
      month,
      paymentDate: formatDateOnly(paymentDate),
      payment: round2(principalPaid + interest),
      principal: principalPaid,
      interest,
      escrow: escrowMonthly,
      balance,
      cumulativeInterest,
      cumulativePrincipal,
    });

    if (balance <= 0) break;
  }

  return schedule;
}

/** Port of calcReinstatement(): the full cure-amount waterfall. */
function calcReinstatement({
  loan,
  missedPayments,
  daysPastDue,
  perDiemDays = 0,
  fcCosts = 0,
  titleFees = 0,
  propertyPreservation = 0,
  bankruptcyCosts = 0,
  escrowShortage = 0,
  suspenseCredit = 0,
  partialPaymentCredit = 0,
  advances = 0,
  nsfFees = 0,
  lastPaidInstallment = null,
  dueDate = null,
}) {
  let autoMissed = missedPayments;
  if (lastPaidInstallment && dueDate) {
    autoMissed = Math.max(0, Math.round(monthsBetween(lastPaidInstallment, dueDate) / 30));
  }

  const missedPI = round2(autoMissed * loan.basePayment);
  const missedEscrow = round2(autoMissed * loan.escrowMonthly);
  const latePerPayment = daysPastDue > GRACE_PERIOD_DAYS ? round2(loan.basePayment * LATE_CHARGE_RATE) : 0;
  const lateTotal = round2(autoMissed * latePerPayment);
  const perDiemAccrual = round2(loan.perDiem * perDiemDays);

  const gross = round2(
    fcCosts +
      titleFees +
      propertyPreservation +
      bankruptcyCosts +
      advances +
      nsfFees +
      lateTotal +
      perDiemAccrual +
      missedEscrow +
      missedPI +
      escrowShortage
  );
  const credits = round2(suspenseCredit + partialPaymentCredit);
  const net = round2(Math.max(0, gross - credits));

  const rows = [
    {
      priority: 1,
      category: "Foreclosure Attorney / Legal",
      description: "Court costs, attorney fees, process fees",
      quantity: "-",
      unitAmount: round2(fcCosts + bankruptcyCosts),
      total: round2(fcCosts + bankruptcyCosts),
    },
    {
      priority: 2,
      category: "Title / Recording Fees",
      description: "Title search, trustee fees, recording",
      quantity: "-",
      unitAmount: titleFees,
      total: titleFees,
    },
    {
      priority: 3,
      category: "Property Preservation",
      description: "Inspections, winterization, securing property",
      quantity: "-",
      unitAmount: propertyPreservation,
      total: propertyPreservation,
    },
    {
      priority: 4,
      category: "Corporate Advances",
      description: "Servicer-paid taxes, insurance, and other advances",
      quantity: "-",
      unitAmount: advances,
      total: advances,
    },
    {
      priority: 5,
      category: "NSF / Returned Item Fee",
      description: "Returned payment processing charges",
      quantity: "-",
      unitAmount: nsfFees,
      total: nsfFees,
    },
    {
      priority: 6,
      category: "Late Charges",
      description: `${autoMissed} payments x ${(LATE_CHARGE_RATE * 100).toFixed(0)}% of P&I (after ${GRACE_PERIOD_DAYS}-day grace)`,
      quantity: autoMissed,
      unitAmount: latePerPayment,
      total: lateTotal,
    },
    {
      priority: 7,
      category: "Per Diem Interest Accrual",
      description: `${perDiemDays} days x daily rate`,
      quantity: perDiemDays,
      unitAmount: loan.perDiem,
      total: perDiemAccrual,
    },
    {
      priority: 8,
      category: "Escrow Shortage",
      description: "Annual escrow shortfall per RESPA analysis",
      quantity: "-",
      unitAmount: escrowShortage,
      total: escrowShortage,
    },
    {
      priority: 9,
      category: "Missed Escrow Payments",
      description: `${autoMissed} payments x monthly escrow (T&I)`,
      quantity: autoMissed,
      unitAmount: loan.escrowMonthly,
      total: missedEscrow,
    },
    {
      priority: 10,
      category: "Missed P&I Payments",
      description: `${autoMissed} payments x base P&I payment`,
      quantity: autoMissed,
      unitAmount: loan.basePayment,
      total: missedPI,
    },
  ].filter((row) => row.total > 0);

  return {
    autoMissedPayments: autoMissed,
    grossReinstatement: gross,
    credits,
    netReinstatement: net,
    lineItems: rows,
  };
}

module.exports = {
  MONTHS_PER_YEAR,
  GRACE_PERIOD_DAYS,
  LATE_CHARGE_RATE,
  round2,
  round4,
  parseDateOnly,
  formatDateOnly,
  monthsBetween,
  calcBasePayment,
  calcLoan,
  buildAmortizationSchedule,
  calcReinstatement,
};
