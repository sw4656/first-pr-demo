'use strict';

/**
 * Loan Modification Calculator
 *
 * Computes a standard fixed-rate amortization payment and full monthly
 * payment breakdown (interest vs. principal) for a modified loan, given
 * a principal balance, a modified note rate, a default date, and a
 * modified maturity date.
 *
 * Conventions follow standard mortgage-servicing practice, consistent
 * with the rest of this repo's calculator (public/calculator.html):
 *   - 30/360 day-count basis by default for per diem / accrued interest.
 *   - Monthly rate = annual rate / 12.
 *   - Standard amortizing annuity formula for the level payment.
 *   - Final scheduled payment is corrected so the balance clears to
 *     exactly $0.00 (absorbs rounding drift).
 *
 * Usage:
 *   const { calculateLoanModification } = require('./loanModification');
 *
 *   const result = calculateLoanModification({
 *     principal: 250000,
 *     annualInterestRate: 4.5,       // percent
 *     defaultDate: '2025-01-15',      // last date the loan was current
 *     maturityDate: '2055-08-01',     // modified maturity date
 *   });
 *
 *   result.monthlyPayment   // level P&I payment
 *   result.schedule         // full month-by-month breakdown
 */

const DEFAULT_DAY_COUNT_BASIS = 360; // 30/360 convention

/** Round to cents. */
function r2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Round to 4 decimal places (per diem rates). */
function r4(value) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

/** Parse a Date or 'YYYY-MM-DD' string into a Date at local midnight. */
function toDate(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === 'string') {
    const [y, m, d] = value.split('-').map(Number);
    if (y && m && d) return new Date(y, m - 1, d);
  }
  throw new Error(`Invalid date: ${value}`);
}

function addMonths(date, months) {
  const d = new Date(date.getTime());
  d.setMonth(d.getMonth() + months);
  return d;
}

/** Whole calendar months between two dates (b - a), truncated. */
function monthsBetween(a, b) {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Standard fixed-rate amortizing payment (annuity formula).
 *   M = P * r / (1 - (1 + r)^-n)
 * Falls back to a straight-line payment when the rate is 0%.
 */
function calculateMonthlyPayment(principal, monthlyRate, termMonths) {
  if (monthlyRate === 0) return r2(principal / termMonths);
  const factor = Math.pow(1 + monthlyRate, termMonths);
  return r2((principal * monthlyRate * factor) / (factor - 1));
}

/**
 * Simple interest accrued between two dates on a 30/360 (or Actual/365)
 * basis. Used to capitalize arrears interest from the default date up to
 * the first modified payment date, and for per diem quoting.
 */
function calculateAccruedInterest(principal, annualInterestRate, fromDate, toDate_, dayCountBasis) {
  const days = Math.max(0, Math.round((toDate_ - fromDate) / (1000 * 60 * 60 * 24)));
  const perDiemRate = r4((principal * (annualInterestRate / 100)) / dayCountBasis);
  return { days, perDiemRate, accruedInterest: r2(perDiemRate * days) };
}

/**
 * Build the full month-by-month payment breakdown for a modified loan.
 *
 * @param {Object} params
 * @param {number} params.principal - Modified principal balance to amortize.
 * @param {number} params.annualInterestRate - Modified note rate, as a percent (e.g. 4.5).
 * @param {string|Date} params.defaultDate - Date the loan went into default (last current date).
 * @param {string|Date} params.maturityDate - Modified maturity date.
 * @param {string|Date} [params.firstPaymentDate] - First payment date of the new schedule.
 *        Defaults to one month after the default date.
 * @param {number} [params.dayCountBasis=360] - Day-count basis for per diem/accrued interest (360 or 365).
 * @param {boolean} [params.capitalizeArrears=false] - If true, adds interest accrued between
 *        defaultDate and firstPaymentDate to the principal before amortizing.
 * @returns {Object} Summary and full amortization schedule.
 */
function calculateLoanModification(params) {
  const {
    principal,
    annualInterestRate,
    defaultDate,
    maturityDate,
    firstPaymentDate,
    dayCountBasis = DEFAULT_DAY_COUNT_BASIS,
    capitalizeArrears = false,
  } = params;

  if (!(principal > 0)) throw new Error('principal must be a positive number');
  if (!(annualInterestRate >= 0)) throw new Error('annualInterestRate must be a non-negative number');

  const defaultD = toDate(defaultDate);
  const maturityD = toDate(maturityDate);
  const firstPaymentD = firstPaymentDate ? toDate(firstPaymentDate) : addMonths(defaultD, 1);

  const termMonths = monthsBetween(firstPaymentD, maturityD) + 1;
  if (termMonths < 1) throw new Error('maturityDate must fall after the first payment date');

  const arrears = calculateAccruedInterest(
    principal,
    annualInterestRate,
    defaultD,
    firstPaymentD,
    dayCountBasis
  );

  const modifiedPrincipal = capitalizeArrears ? r2(principal + arrears.accruedInterest) : r2(principal);

  const monthlyRate = annualInterestRate / 100 / 12;
  const monthlyPayment = calculateMonthlyPayment(modifiedPrincipal, monthlyRate, termMonths);

  const schedule = [];
  let balance = modifiedPrincipal;
  let totalInterest = 0;
  let totalPrincipal = 0;

  for (let period = 1; period <= termMonths; period++) {
    const dueDate = addMonths(firstPaymentD, period - 1);
    const interest = r2(balance * monthlyRate);
    let principalPortion = r2(monthlyPayment - interest);
    let payment = monthlyPayment;

    // Final-payment rounding correction: clear the balance to exactly $0.00.
    if (period === termMonths || principalPortion >= balance) {
      principalPortion = balance;
      payment = r2(interest + principalPortion);
    }

    balance = r2(balance - principalPortion);
    totalInterest = r2(totalInterest + interest);
    totalPrincipal = r2(totalPrincipal + principalPortion);

    schedule.push({
      period,
      dueDate: toISODate(dueDate),
      payment,
      interest,
      principal: principalPortion,
      balance,
    });

    if (balance <= 0) break;
  }

  return {
    principal: r2(principal),
    modifiedPrincipal,
    annualInterestRate,
    monthlyRate,
    dayCountBasis,
    defaultDate: toISODate(defaultD),
    firstPaymentDate: toISODate(firstPaymentD),
    maturityDate: toISODate(maturityD),
    termMonths,
    monthlyPayment,
    arrears,
    totalInterest,
    totalPrincipal,
    totalOfPayments: r2(totalInterest + totalPrincipal),
    payoffDate: schedule.length ? schedule[schedule.length - 1].dueDate : null,
    schedule,
  };
}

module.exports = {
  calculateLoanModification,
  calculateMonthlyPayment,
  calculateAccruedInterest,
};

// ── CLI demo ────────────────────────────────────────────────────────────
// Run directly with: node src/loanModification.js
if (require.main === module) {
  const result = calculateLoanModification({
    principal: 250000,
    annualInterestRate: 4.5,
    defaultDate: '2025-01-15',
    maturityDate: '2055-08-01',
    capitalizeArrears: true,
  });

  console.log('Loan Modification Summary');
  console.log('--------------------------------');
  console.log(`Original Principal:     $${result.principal.toFixed(2)}`);
  console.log(`Arrears Capitalized:    $${result.arrears.accruedInterest.toFixed(2)} (${result.arrears.days} days)`);
  console.log(`Modified Principal:     $${result.modifiedPrincipal.toFixed(2)}`);
  console.log(`Interest Rate:          ${result.annualInterestRate}%`);
  console.log(`Term:                   ${result.termMonths} months`);
  console.log(`First Payment Date:     ${result.firstPaymentDate}`);
  console.log(`Maturity Date:          ${result.maturityDate}`);
  console.log(`Monthly P&I Payment:    $${result.monthlyPayment.toFixed(2)}`);
  console.log(`Total Interest:         $${result.totalInterest.toFixed(2)}`);
  console.log(`Total of Payments:      $${result.totalOfPayments.toFixed(2)}`);
  console.log('');
  console.log('First 3 payments:');
  console.table(result.schedule.slice(0, 3));
  console.log('Last payment:');
  console.table(result.schedule.slice(-1));
}
