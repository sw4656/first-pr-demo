// Maps the calculator face page's <input>/<select> element ids (the "data" blob
// posted from the browser) onto indexed columns in the accounts table, so the
// portfolio dashboard can list/search/sort without deserializing every blob.
const CORE_FIELD_MAP = {
  loan_number: ['mc-loan-number-bar', 'mc-loan-number'],
  borrower_name: ['mc-borrower', 'mc-borrower-bar'],
  coborrower_name: ['mc-coborrower'],
  property_address: ['mc-address', 'mc-address-bar'],
  investor: ['mc-investor', 'mc-investor-banner'],
  servicer: ['sc-servicer-name'],
  loan_type: ['mc-loan-type'],
  interest_rate: ['mc-rate'],
  principal_balance: ['mc-balance'],
  origination_date: ['mc-origination'],
  maturity_date: ['mc-maturity-date'],
  performance_status: ['svc-performance-status'],
  settlement_status: ['svc-settlement-status'],
};

function firstNonEmpty(data, keys) {
  for (const key of keys) {
    const val = data[key];
    if (val !== undefined && val !== null && String(val).trim() !== '') return val;
  }
  return null;
}

function toNumberOrNull(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function extractCoreFields(data) {
  const out = {};
  for (const [column, ids] of Object.entries(CORE_FIELD_MAP)) {
    const raw = firstNonEmpty(data, ids);
    out[column] = column === 'interest_rate' || column === 'principal_balance'
      ? toNumberOrNull(raw)
      : raw;
  }
  return out;
}

module.exports = { extractCoreFields, CORE_FIELD_MAP };
