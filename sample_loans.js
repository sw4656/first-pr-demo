/**
 * ═══════════════════════════════════════════════════════════════
 *  WebNote Replacement BETA — Sample Loan Data Loader
 *  Asset Management Holdings II, LLC
 *
 *  Run this script ONCE to populate your database with
 *  10 realistic sample loans for testing and demonstration.
 *
 *  Usage (from your project root folder):
 *    node sample_loans.js
 *
 *  Requires your .env file to be present with DATABASE_URL.
 *  Run AFTER the server has been started at least once
 *  (so the accounts table exists).
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';
require('dotenv').config();

const knex = require('knex')({
  client: 'pg',
  connection: {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true'
      ? { rejectUnauthorized: false } : false,
  },
});

// ── Helper: round to 2 decimal places ────────────────────────────
function r2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }

// ── Helper: compute P/I payment ──────────────────────────────────
function calcBase(P, r, n) {
  if (!P || !n || n <= 0) return 0;
  if (r === 0) return r2(P / n);
  const mr = r / 12;
  const f  = Math.pow(1 + mr, n);
  return r2(P * (mr * f) / (f - 1));
}

// ── Helper: compute per diem ─────────────────────────────────────
function perDiem(upb, rate) { return r2(upb * rate / 360); }

// ── Helper: format as currency string ────────────────────────────
function fmt(v) {
  return v.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ── Helper: build field_data blob from loan params ───────────────
function buildFields(loan) {
  const pi  = calcBase(loan.principal, loan.rate / 100, loan.term);
  const pd  = perDiem(loan.upb, loan.rate / 100);
  const arr = r2(loan.missed * pi);

  return {
    // ── Banner ──────────────────────────────────────────────────
    'mc-loan-number':       loan.loanNumber,
    'mc-investor-banner':   loan.investor,
    'mc-borrower':          loan.borrowerLast + ', ' + loan.borrowerFirst,

    // ── Borrower ────────────────────────────────────────────────
    'brow-first':           loan.borrowerFirst,
    'brow-last':            loan.borrowerLast,
    'brow-co-first':        loan.coBorrowerFirst || '',
    'brow-co-last':         loan.coBorrowerLast  || '',

    // ── Property ────────────────────────────────────────────────
    'prop-street':          loan.street,
    'prop-city':            loan.city,
    'prop-state':           loan.state,
    'prop-zip':             loan.zip,
    'prop-county':          loan.county || '',
    'prop-type':            loan.propType || 'SFR',

    // ── Terms ───────────────────────────────────────────────────
    'mc-principal':         fmt(loan.principal),
    'mc-acquired-amount':   fmt(loan.acquired || loan.principal * 0.65),
    'mc-rate':              loan.rate.toFixed(3),
    'mc-term':              String(loan.term),
    'mc-origination':       loan.originDate,
    'mc-acquired-date':     loan.acquiredDate,
    'mc-loan-type':         loan.loanType || 'Conventional',
    'terms-pi-payment':     fmt(pi),

    // ── Balances ────────────────────────────────────────────────
    'mc-balance':           fmt(loan.upb),
    'bal-run-upb':          fmt(loan.upb),
    'bal-per-diem-display': fmt(pd),
    'bal-payoff-display':   fmt(r2(loan.upb + (loan.intBal || 0) +
                              (loan.lateBal || 0) + (loan.advBal || 0))),
    'bal-int-bal':          fmt(loan.intBal  || 0),
    'bal-late-fee-balance': fmt(loan.lateBal || 0),
    'bal-advance-balance':  fmt(loan.advBal  || 0),
    'mc-suspense':          fmt(loan.suspense || 0),
    'bal-arrears':          fmt(arr),
    'bal-deferred-balance': fmt(loan.deferBal || 0),
    'bal-impound':          fmt(loan.impound  || 0),
    'bal-mia':              fmt(loan.mia      || 0),
    'bal-accrued-cost':     fmt(loan.accruedCost || 0),

    // ── Status ──────────────────────────────────────────────────
    'mc-missed':            String(loan.missed || 0),
    'mc-days':              String(loan.daysPD || 0),
    'mc-fc-status':         loan.fcStatus || 'none',
    'mc-perdiem-toggle':    loan.daysPD > 0,
    'mc-late-auto':         loan.missed > 0,

    // ── Advances ────────────────────────────────────────────────
    'sc-adv-tax':           fmt(loan.advTax   || 0),
    'sc-adv-ins':           fmt(loan.advIns   || 0),
    'sc-adv-prop':          fmt(loan.advProp  || 0),
    'sc-adv-legal':         fmt(loan.advLegal || 0),
    'sc-adv-bpo':           fmt(loan.advBpo   || 0),
    'sc-adv-nsf':           fmt(0),
    'sc-adv-other':         fmt(0),
    'sc-adv-recovered':     fmt(0),

    // ── Property Info ────────────────────────────────────────────
    'prop-bpo-amt':         fmt(loan.bpo || 0),
    'prop-avm-amt':         fmt(0),
    'prop-tax-amt':         fmt(0),
    'prop-1st-amt':         fmt(loan.upb),
    'prop-2nd-amt':         fmt(loan.second || 0),
    'prop-3rd-amt':         fmt(0),
    'prop-last-val-amt':    fmt(loan.bpo || 0),

    // ── Servicer ────────────────────────────────────────────────
    'sc-servicer-name':     'Asset Management Holdings II, LLC',
    'sc-acct-rep':          loan.rep || 'S. Webster',
    'sc-pool':              loan.pool || 'AMH-2024-A',

    // ── Misc ────────────────────────────────────────────────────
    'mc-investor':          loan.investor,
    'dc-360':               true,
    'dc-365':               false,
  };
}

// ── Helper: build indexed summary row ───────────────────────────
function buildIndexed(loan, fields) {
  const pi  = calcBase(loan.principal, loan.rate / 100, loan.term);
  const arr = r2(loan.missed * pi);
  return {
    loan_number:       loan.loanNumber,
    investor_name:     loan.investor,
    borrower_name:     loan.borrowerLast + ', ' + loan.borrowerFirst,
    co_borrower_name:  loan.coBorrowerFirst
      ? loan.coBorrowerLast + ', ' + loan.coBorrowerFirst : null,
    property_address:  loan.street + ', ' + loan.city + ', ' + loan.state + ' ' + loan.zip,
    property_city:     loan.city,
    property_state:    loan.state,
    property_zip:      loan.zip,
    original_principal:loan.principal,
    current_upb:       loan.upb,
    annual_rate:       loan.rate,
    amort_term_months: loan.term,
    missed_payments:   loan.missed || 0,
    days_past_due:     loan.daysPD || 0,
    arrears:           arr,
    int_bal:           loan.intBal  || 0,
    late_fee_bal:      loan.lateBal || 0,
    advance_bal:       loan.advBal  || 0,
    suspense_bal:      loan.suspense || 0,
    deferred_bal:      loan.deferBal || 0,
    impound_bal:       loan.impound  || 0,
    origination_date:  loan.originDate   || null,
    maturity_date:     loan.maturityDate || null,
    acquired_date:     loan.acquiredDate || null,
    loan_type:         loan.loanType || 'Conventional',
    fc_status:         loan.fcStatus || 'none',
    loan_status:       loan.loanStatus || 'active',
    field_data:        JSON.stringify(fields),
    created_at:        new Date(),
    updated_at:        new Date(),
  };
}

// ════════════════════════════════════════════════════════════════
//  SAMPLE LOANS
//  10 loans covering a realistic private-note portfolio:
//  performing, delinquent, in FC, HELOC, IO, and paid-ahead
// ════════════════════════════════════════════════════════════════
const LOANS = [

  // ── 1. Performing — standard conventional ───────────────────
  {
    loanNumber:    'AMH-2019-001',
    investor:      'JFAM Capital LLC',
    borrowerFirst: 'Robert',   borrowerLast: 'Hargrove',
    street:        '2847 Magnolia Drive',
    city:          'Baton Rouge', state: 'LA', zip: '70808',
    county:        'East Baton Rouge',
    principal:     285000,  upb:     241763.45,
    rate:          7.250,   term:    360,
    originDate:    '2019-03-15', acquiredDate: '2021-06-01',
    maturityDate:  '2049-03-15',
    acquired:      185000,
    missed:        0,        daysPD: 0,
    bpo:           310000,
    loanType:      'Conventional', fcStatus: 'none',
    rep:           'S. Webster',   pool: 'AMH-2021-A',
  },

  // ── 2. Mildly delinquent — 2 payments missed ────────────────
  {
    loanNumber:    'AMH-2018-002',
    investor:      'Pinewood Note Fund I',
    borrowerFirst: 'Maria',    borrowerLast:   'Castellano',
    coBorrowerFirst:'Anthony', coBorrowerLast: 'Castellano',
    street:        '514 Crescent Oak Lane',
    city:          'Memphis', state: 'TN', zip: '38117',
    county:        'Shelby',
    principal:     195000,  upb:    162340.88,
    rate:          8.500,   term:   360,
    originDate:    '2018-07-20', acquiredDate: '2020-11-15',
    maturityDate:  '2048-07-20',
    acquired:      118000,
    missed:        2,        daysPD: 62,
    lateBal:       r2(calcBase(195000, 0.085, 360) * 0.05),
    intBal:        r2(162340.88 * 0.085 / 12),
    advBal:        0,
    bpo:           198000,
    loanType:      'Conventional', fcStatus: 'pre',
    rep:           'S. Webster',   pool: 'AMH-2020-B',
  },

  // ── 3. Seriously delinquent — 5 payments missed ─────────────
  {
    loanNumber:    'AMH-2017-003',
    investor:      'JFAM Capital LLC',
    borrowerFirst: 'Darnell',  borrowerLast: 'Washington',
    street:        '1033 Pecan Street',
    city:          'Jackson', state: 'MS', zip: '39206',
    county:        'Hinds',
    principal:     142000,  upb:    128450.22,
    rate:          9.750,   term:   360,
    originDate:    '2017-04-01', acquiredDate: '2019-08-20',
    maturityDate:  '2047-04-01',
    acquired:      88000,
    missed:        5,        daysPD: 152,
    lateBal:       r2(calcBase(142000, 0.0975, 360) * 0.05 * 5),
    intBal:        r2(128450.22 * 0.0975 / 12 * 5),
    advBal:        3200,
    advTax:        1800,    advProp: 1400,
    advLegal:      2500,
    advBpo:        450,
    bpo:           155000,
    loanType:      'Conventional', fcStatus: 'active',
    loanStatus:    'in_fc',
    rep:           'S. Webster',   pool: 'AMH-2019-A',
  },

  // ── 4. Performing — low rate refinance ───────────────────────
  {
    loanNumber:    'AMH-2021-004',
    investor:      'Silverbrook Capital Partners',
    borrowerFirst: 'Jennifer', borrowerLast: 'Okafor',
    street:        '7724 Willow Creek Court',
    city:          'Nashville', state: 'TN', zip: '37215',
    county:        'Davidson',
    principal:     425000,  upb:    408217.63,
    rate:          5.875,   term:   360,
    originDate:    '2021-09-10', acquiredDate: '2023-02-28',
    maturityDate:  '2051-09-10',
    acquired:      310000,
    missed:        0,        daysPD: 0,
    bpo:           490000,
    second:        45000,
    loanType:      'Conventional', fcStatus: 'none',
    rep:           'S. Webster',   pool: 'AMH-2023-A',
  },

  // ── 5. HELOC — performing, partially drawn ───────────────────
  {
    loanNumber:    'AMH-2022-005',
    investor:      'Pinewood Note Fund I',
    borrowerFirst: 'Thomas',  borrowerLast: 'Bergmann',
    street:        '3312 Oakwood Terrace',
    city:          'Atlanta', state: 'GA', zip: '30305',
    county:        'Fulton',
    principal:     150000,  upb:    87500.00,
    rate:          10.000,  term:   360,
    originDate:    '2022-01-15', acquiredDate: '2022-01-15',
    maturityDate:  '2042-01-15',
    acquired:      150000,
    missed:        0,        daysPD: 0,
    bpo:           385000,
    loanType:      'HELOC',  fcStatus: 'none',
    rep:           'S. Webster', pool: 'AMH-2022-A',
  },

  // ── 6. Interest-Only — within IO period ─────────────────────
  {
    loanNumber:    'AMH-2023-006',
    investor:      'Silverbrook Capital Partners',
    borrowerFirst: 'Patricia', borrowerLast: 'Dumont',
    coBorrowerFirst:'Gerald',  coBorrowerLast:'Dumont',
    street:        '9801 Lakefront Boulevard',
    city:          'New Orleans', state: 'LA', zip: '70124',
    county:        'Orleans',
    principal:     520000,  upb:    520000.00,
    rate:          7.000,   term:   360,
    originDate:    '2023-06-01', acquiredDate: '2023-06-01',
    maturityDate:  '2053-06-01',
    acquired:      520000,
    missed:        0,        daysPD: 0,
    bpo:           615000,
    loanType:      'Interest Only', fcStatus: 'none',
    rep:           'S. Webster',    pool: 'AMH-2023-B',
  },

  // ── 7. Bankruptcy — active Chapter 13 ───────────────────────
  {
    loanNumber:    'AMH-2016-007',
    investor:      'JFAM Capital LLC',
    borrowerFirst: 'Carlos',   borrowerLast: 'Reyes',
    street:        '228 Birchwood Avenue',
    city:          'Birmingham', state: 'AL', zip: '35209',
    county:        'Jefferson',
    principal:     178000,  upb:    155682.40,
    rate:          10.500,  term:   360,
    originDate:    '2016-11-01', acquiredDate: '2018-05-15',
    maturityDate:  '2046-11-01',
    acquired:      102000,
    missed:        3,        daysPD: 95,
    lateBal:       r2(calcBase(178000, 0.105, 360) * 0.05 * 3),
    intBal:        r2(155682.40 * 0.105 / 12 * 3),
    advBal:        4750,
    advTax:        2200,    advIns:  1100,
    advLegal:      1450,
    advBpo:        350,
    bpo:           172000,
    loanType:      'Conventional', fcStatus: 'bkr',
    loanStatus:    'in_fc',
    rep:           'S. Webster',   pool: 'AMH-2018-A',
  },

  // ── 8. Performing — short term balloon ───────────────────────
  {
    loanNumber:    'AMH-2022-008',
    investor:      'Pinewood Note Fund I',
    borrowerFirst: 'Sandra',   borrowerLast: 'Kimura',
    street:        '4455 Maple Glen Road',
    city:          'Louisville', state: 'KY', zip: '40207',
    county:        'Jefferson',
    principal:     310000,  upb:    298441.17,
    rate:          8.000,   term:   120,
    originDate:    '2022-04-01', acquiredDate: '2022-04-01',
    maturityDate:  '2032-04-01',
    acquired:      310000,
    missed:        0,        daysPD: 0,
    bpo:           355000,
    loanType:      'Conventional', fcStatus: 'none',
    rep:           'S. Webster',   pool: 'AMH-2022-A',
  },

  // ── 9. Watch list — 1 payment missed, on grace ───────────────
  {
    loanNumber:    'AMH-2020-009',
    investor:      'Silverbrook Capital Partners',
    borrowerFirst: 'Marcus',   borrowerLast: 'Tillman',
    coBorrowerFirst:'Denise',  coBorrowerLast:'Tillman',
    street:        '617 Sycamore Springs Court',
    city:          'Charlotte', state: 'NC', zip: '28209',
    county:        'Mecklenburg',
    principal:     238000,  upb:    207883.55,
    rate:          7.625,   term:   360,
    originDate:    '2020-02-01', acquiredDate: '2021-09-10',
    maturityDate:  '2050-02-01',
    acquired:      158000,
    missed:        1,        daysPD: 18,
    lateBal:       r2(calcBase(238000, 0.07625, 360) * 0.05),
    intBal:        r2(207883.55 * 0.07625 / 12),
    advBpo:        425,
    advBal:        425,
    bpo:           265000,
    loanType:      'Conventional', fcStatus: 'none',
    rep:           'S. Webster',   pool: 'AMH-2021-B',
  },

  // ── 10. REO / Post-FC — awaiting disposition ─────────────────
  {
    loanNumber:    'AMH-2015-010',
    investor:      'JFAM Capital LLC',
    borrowerFirst: 'Barbara',  borrowerLast: 'Fontaine',
    street:        '1129 Elm Street',
    city:          'Shreveport', state: 'LA', zip: '71101',
    county:        'Caddo',
    principal:     98000,   upb:    89124.00,
    rate:          11.000,  term:   360,
    originDate:    '2015-08-01', acquiredDate: '2017-03-01',
    maturityDate:  '2045-08-01',
    acquired:      54000,
    missed:        12,       daysPD: 365,
    lateBal:       r2(calcBase(98000, 0.11, 360) * 0.05 * 12),
    intBal:        r2(89124.00 * 0.11 / 12 * 12),
    advBal:        8900,
    advTax:        3200,    advIns:  1800,
    advProp:       2400,    advLegal: 1500,
    advBpo:        450,
    bpo:           112000,
    loanType:      'Conventional', fcStatus: 'sale',
    loanStatus:    'reo',
    rep:           'S. Webster',   pool: 'AMH-2017-A',
    mia:           r2(89124.00 * 0.11 / 12 * 12),
  },

];

// ════════════════════════════════════════════════════════════════
//  LOAD INTO DATABASE
// ════════════════════════════════════════════════════════════════
async function loadSampleLoans() {
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║  WebNote Sample Loan Loader                ║');
  console.log('╚════════════════════════════════════════════╝\n');

  // Verify connection
  await knex.raw('SELECT 1');
  console.log('[db] Connected to Supabase ✓\n');

  let created = 0;
  let skipped = 0;

  for (const loan of LOANS) {
    try {
      // Check if loan already exists
      const existing = await knex('accounts')
        .where({ loan_number: loan.loanNumber })
        .first();

      if (existing) {
        console.log(`  ⊘ SKIP  ${loan.loanNumber} — already exists`);
        skipped++;
        continue;
      }

      // Build field blob and indexed row
      const fields  = buildFields(loan);
      const indexed = buildIndexed(loan, fields);

      // Insert
      const [row] = await knex('accounts')
        .insert(indexed)
        .returning(['id', 'loan_number']);

      // Log creation event
      await knex('loan_events').insert({
        account_id:         row.id,
        event_type:         'loan_created',
        description:        `Sample loan loaded: ${loan.loanNumber}`,
        performed_by_label: 'sample_loader',
      }).catch(() => {});

      const pi  = calcBase(loan.principal, loan.rate / 100, loan.term);
      const ltv = loan.bpo ? (loan.upb / loan.bpo * 100).toFixed(1) + '%' : '—';
      console.log(
        `  ✓ ${loan.loanNumber.padEnd(15)} ` +
        `${(loan.borrowerLast + ', ' + loan.borrowerFirst).padEnd(22)} ` +
        `UPB $${Math.round(loan.upb).toLocaleString().padStart(9)} ` +
        `${loan.rate.toFixed(3)}% ` +
        `${loan.missed > 0 ? loan.missed + ' missed' : 'current'.padEnd(8)} ` +
        `LTV ${ltv}`
      );
      created++;

    } catch (err) {
      if (err.code === '23505') {
        console.log(`  ⊘ SKIP  ${loan.loanNumber} — duplicate`);
        skipped++;
      } else {
        console.error(`  ✗ ERROR ${loan.loanNumber}: ${err.message}`);
      }
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Created: ${created} loans`);
  console.log(`  Skipped: ${skipped} (already existed)`);
  console.log(`  Total in portfolio: ${created + skipped}`);
  console.log(`${'─'.repeat(60)}\n`);
  console.log('Done. Open http://localhost:3000 and click Portfolio.');
  console.log('Run this script again any time — duplicates are skipped.\n');

  await knex.destroy();
}

loadSampleLoans().catch(err => {
  console.error('\n[ERROR]', err.message);
  if (err.message.includes('password')) {
    console.error('Check your DATABASE_URL in .env');
  }
  process.exit(1);
});
