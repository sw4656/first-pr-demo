/**
 * ═══════════════════════════════════════════════════════════════
 *  WebNote Replacement BETA — Account Bridge
 *  Asset Management Holdings II, LLC
 *
 *  Connects the calculator.html front end to the Express API.
 *  Replaces localStorage with real Supabase/PostgreSQL persistence.
 *  Falls back to localStorage when the server is unreachable.
 *
 *  Load this AFTER calculator.html's own <script> block:
 *    <script src="account-bridge.js"></script>
 *
 *  The server must be running at API_BASE below.
 *  For local dev: API_BASE = 'http://localhost:3000/api'
 *  For production: API_BASE = 'https://your-api.render.com/api'
 * ═══════════════════════════════════════════════════════════════
 */

(function WebNoteBridge() {
  'use strict';

  // ── CONFIG ───────────────────────────────────────────────────────
  // Change this to your deployed API URL when you go to production
  const API_BASE = 'http://localhost:3000/api';

  // How many milliseconds before a save request times out
  const TIMEOUT_MS = 8000;

  // ── STATE ────────────────────────────────────────────────────────
  let _currentId   = null;   // UUID of the loan currently open
  let _isOnline    = true;   // whether the server is reachable
  let _saveQueue   = [];     // pending saves when offline

  // ── LABEL HELPER ─────────────────────────────────────────────────
  function _setLabel(msg, color) {
    const el = document.getElementById('acct-bridge-label');
    if (!el) return;
    el.textContent = msg;
    el.style.background = color || '#7A3A00';
    el.style.color = '#FFF';
  }

  function _labelSaved()   { _setLabel('Saved ✓',   '#1A5C2A'); setTimeout(()=>_setLabel('Saved','#1A5C2A'), 2500); }
  function _labelSaving()  { _setLabel('Saving…',   '#2A4A8A'); }
  function _labelUnsaved() { _setLabel('Unsaved',   '#7A3A00'); }
  function _labelOffline() { _setLabel('Offline',   '#880000'); }
  function _labelError(m)  { _setLabel('Error: ' + m.slice(0,20), '#880000'); }

  // Mark unsaved on any field change
  document.addEventListener('input', () => {
    if (_currentId) _labelUnsaved();
  });

  // ── FIELD COLLECTION ─────────────────────────────────────────────
  function _collect() {
    const d = {};
    document.querySelectorAll('input[id],select[id],textarea[id]').forEach(el => {
      if (!el.id || el.id === 'amort-jump') return;
      d[el.id] = el.type === 'checkbox' ? el.checked : (el.value || '');
    });
    return d;
  }

  // ── FIELD POPULATION ─────────────────────────────────────────────
  const _DOLLAR = new Set([
    'mc-principal','mc-acquired-amount','mc-late','mc-annual-fee','mc-balloon-amount',
    'bal-arrears','bal-int-bal','bal-interim','bal-late-fee-balance','bal-advance-balance',
    'bal-retainer','mc-suspense','bal-charge-off','mc-balance','bal-mia','bal-accrued-cost',
    'bal-deferred-balance','bal-impound','bal-last-paid-amount',
    'sc-adv-tax','sc-adv-ins','sc-adv-prop','sc-adv-hoa','sc-adv-legal','sc-adv-title',
    'sc-adv-bpo','sc-adv-nsf','sc-adv-svcfee','sc-adv-other','sc-adv-recovered',
    'heloc-credit-limit','heloc-drawn',
    'mod-upb','mod-deferred-bal','mod-principal-reduction',
    'prop-bpo-amt','prop-avm-amt','prop-tax-amt',
    'prop-1st-amt','prop-2nd-amt','prop-3rd-amt','prop-hoa-fee',
  ]);

  function _populate(data) {
    Object.keys(data).forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.type === 'checkbox') { el.checked = !!data[id]; return; }
      el.value = data[id];
      if (_DOLLAR.has(id) && el.value && el.value !== '0.00') {
        const n = parseFloat((el.value || '').replace(/[$,]/g, ''));
        if (!isNaN(n))
          el.value = n.toLocaleString('en-US', {
            minimumFractionDigits: 2, maximumFractionDigits: 2
          });
      }
    });
    // Fire sync functions after populating
    setTimeout(() => {
      if (typeof _syncBorrowerName    === 'function') _syncBorrowerName();
      if (typeof _syncCoBorrowerName  === 'function') _syncCoBorrowerName();
      if (typeof _syncPropertyAddress === 'function') _syncPropertyAddress();
      if (typeof _syncDisplayFields   === 'function') _syncDisplayFields();
      if (typeof calculate            === 'function') calculate();
      if (typeof calcReinstatement    === 'function') calcReinstatement();
      if (typeof initDollarFields     === 'function') initDollarFields();
      if (typeof _calcPropSummary     === 'function') _calcPropSummary();
      if (typeof _onLoanTypeChange    === 'function') _onLoanTypeChange();
    }, 150);
  }

  // ── HTTP HELPERS ─────────────────────────────────────────────────
  async function _request(method, path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const opts = {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      };
      if (body) opts.body = JSON.stringify(body);
      const res  = await fetch(API_BASE + path, opts);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      _isOnline = true;
      return data;
    } catch (err) {
      if (err.name === 'AbortError' || err.message.includes('fetch')) {
        _isOnline = false;
        _labelOffline();
        console.warn('[bridge] Server unreachable — using localStorage fallback');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── SAVE ─────────────────────────────────────────────────────────
  async function acctBridgeSave() {
    const fields = _collect();
    _labelSaving();
    try {
      if (_currentId) {
        // Update existing loan
        await _request('PUT', `/accounts/${_currentId}`, { fields });
      } else {
        // Create new loan
        const data    = await _request('POST', '/accounts', { fields });
        _currentId    = data.id;
        // Update URL so a refresh reopens this loan
        const url = new URL(window.location.href);
        url.searchParams.set('loan', _currentId);
        window.history.replaceState({}, '', url.toString());
      }
      _labelSaved();
      // Also write to localStorage as offline backup
      try {
        localStorage.setItem('wnb_backup_' + _currentId, JSON.stringify(fields));
      } catch (e) { /* storage full — ignore */ }
    } catch (err) {
      // Offline fallback: save to localStorage
      if (!_isOnline) {
        const id = _currentId || ('WN' + Date.now().toString(36).toUpperCase());
        _currentId = id;
        localStorage.setItem('wnb_offline_' + id, JSON.stringify(fields));
        _labelOffline();
        _saveQueue.push(id);
        console.log('[bridge] Saved offline — will sync when server returns');
      } else {
        _labelError(err.message);
        console.error('[bridge] Save failed:', err.message);
      }
    }
  }

  // ── LOAD ─────────────────────────────────────────────────────────
  async function acctBridgeLoad(id) {
    if (!id) return;
    _setLabel('Loading…', '#2A4A8A');
    try {
      const data = await _request('GET', `/accounts/${id}`);
      _currentId = id;
      _populate(data.fields);
      _setLabel('Loaded ✓', '#1A5C2A');
      setTimeout(() => _setLabel('Saved', '#1A5C2A'), 2000);
    } catch (err) {
      // Try localStorage backup
      const backup = localStorage.getItem('wnb_backup_' + id)
        || localStorage.getItem('wnb_offline_' + id);
      if (backup) {
        _currentId = id;
        _populate(JSON.parse(backup));
        _setLabel('Offline copy', '#7A3A00');
        console.warn('[bridge] Loaded from localStorage backup');
      } else {
        _labelError('Not found');
        console.error('[bridge] Load failed and no backup:', err.message);
      }
    }
  }

  // ── NEW LOAN ─────────────────────────────────────────────────────
  function acctBridgeNew() {
    if (_currentId) {
      if (!confirm('Save current loan first?')) {
        if (!confirm('Discard changes?')) return;
      } else {
        acctBridgeSave();
      }
    }
    _currentId = null;
    // Clear all fields
    document.querySelectorAll('input[id],select[id],textarea[id]').forEach(el => {
      if (!el.id || el.id === 'amort-jump') return;
      if (el.type === 'checkbox') el.checked = false;
      else if (_DOLLAR.has(el.id)) el.value = '0.00';
      else el.value = '';
    });
    ['terms-pi-payment','bal-run-upb','bal-payoff-display',
     'bal-per-diem-display','bal-red-payoff'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '—';
    });
    if (typeof calculate === 'function') calculate();
    _labelUnsaved();
    // Clear loan= from URL
    const url = new URL(window.location.href);
    url.searchParams.delete('loan');
    window.history.replaceState({}, '', url.toString());
  }

  // ── PORTFOLIO MODAL ───────────────────────────────────────────────
  async function acctBridgeOpen() {
    const old = document.getElementById('_bridgePortModal');
    if (old) old.remove();

    // Show loading indicator
    const loading = document.createElement('div');
    loading.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9999;display:flex;align-items:center;justify-content:center;';
    loading.innerHTML = '<div style="background:#FFF;border-radius:8px;padding:30px 40px;font-size:14px;font-weight:bold;color:#1A3070;">Loading portfolio…</div>';
    document.body.appendChild(loading);

    let loans = [];
    try {
      const data = await _request('GET', '/accounts?limit=200');
      loans = data.accounts || [];
      loading.remove();
    } catch (err) {
      loading.remove();
      // Offline: show localStorage loans
      loans = _offlinePortfolio();
      if (!loans.length) {
        alert('Cannot reach server and no offline loans saved.');
        return;
      }
    }

    const fmt   = v => v > 0 ? '$' + Math.round(v).toLocaleString('en-US') : '—';
    const fmtD  = s => s ? new Date(s).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : '—';
    const sc    = m => m >= 4 ? '#880000' : m > 0 ? '#7A4800' : '#145220';

    const rows = loans.length
      ? loans.map(l => `
        <tr onclick="window._bridgeLoadId('${l.id}')"
            style="cursor:pointer;border-bottom:1px solid #E8EEF6;"
            onmouseover="this.style.background='#EBF2FF'"
            onmouseout="this.style.background=''">
          <td style="padding:8px 12px;font-family:Courier New,monospace;font-weight:bold;color:#1A3070;">${l.loan_number||'—'}</td>
          <td style="padding:8px 12px;font-weight:bold;">${l.borrower_name||'—'}</td>
          <td style="padding:8px 12px;font-size:11px;color:#6677AA;">${l.property_address||'—'}</td>
          <td style="padding:8px 12px;font-family:Courier New,monospace;">${fmt(l.current_upb)}</td>
          <td style="padding:8px 12px;font-family:Courier New,monospace;">${l.annual_rate ? l.annual_rate.toFixed(3)+'%' : '—'}</td>
          <td style="padding:8px 12px;font-family:Courier New,monospace;font-weight:bold;color:${sc(l.missed_payments||0)};">${l.missed_payments||0}</td>
          <td style="padding:8px 12px;font-size:11px;color:#6677AA;">${fmtD(l.updated_at)}</td>
        </tr>`).join('')
      : `<tr><td colspan="7" style="padding:40px;text-align:center;color:#6677AA;">No loans saved yet.</td></tr>`;

    const m = document.createElement('div');
    m.id = '_bridgePortModal';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;';
    m.innerHTML = `
      <div style="background:#FFF;border-radius:8px;width:92%;max-width:960px;
                  max-height:82vh;display:flex;flex-direction:column;
                  box-shadow:0 8px 40px rgba(0,0,0,.3);overflow:hidden;">
        <div style="background:#1A3070;color:#FFF;padding:12px 18px;
                    display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
          <span style="font-size:14px;font-weight:bold;">
            &#128196; Loan Portfolio
            <span style="font-size:11px;opacity:.6;margin-left:8px;">${loans.length} loan${loans.length!==1?'s':''}</span>
          </span>
          <div style="display:flex;gap:8px;">
            <button onclick="window.acctBridgeNew();document.getElementById('_bridgePortModal').remove()"
              style="background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.4);
                     color:#FFF;border-radius:4px;padding:4px 12px;cursor:pointer;font-size:12px;">
              &#10133; New Loan
            </button>
            <button onclick="document.getElementById('_bridgePortModal').remove()"
              style="background:rgba(255,255,255,.15);border:none;color:#FFF;
                     border-radius:4px;padding:4px 12px;cursor:pointer;font-size:13px;">&times;</button>
          </div>
        </div>
        <div style="overflow-y:auto;flex:1;">
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead style="position:sticky;top:0;">
              <tr style="background:#F0F4F8;border-bottom:2px solid #C8DCFF;">
                ${['Loan #','Borrower','Property','UPB','Rate','Missed','Updated']
                  .map(h=>`<th style="padding:7px 12px;text-align:left;font-size:10px;
                    font-weight:bold;color:#6677AA;text-transform:uppercase;
                    letter-spacing:.05em;white-space:nowrap;">${h}</th>`).join('')}
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div style="padding:8px 16px;border-top:1px solid #D0D8E8;font-size:10px;
                    color:#6677AA;text-align:center;flex-shrink:0;">
          Click any row to open &bull; Data stored in Supabase PostgreSQL
        </div>
      </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m) m.remove(); });
  }

  // ── OFFLINE PORTFOLIO (localStorage) ─────────────────────────────
  function _offlinePortfolio() {
    const loans = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key.startsWith('wnb_offline_') && !key.startsWith('wnb_backup_')) continue;
      try {
        const f = JSON.parse(localStorage.getItem(key));
        loans.push({
          id:           key.replace('wnb_offline_','').replace('wnb_backup_',''),
          loan_number:  f['mc-loan-number'] || key,
          borrower_name:f['mc-borrower']    || '',
          current_upb:  parseFloat((f['mc-balance']||'').replace(/[$,]/g,''))||0,
          annual_rate:  parseFloat(f['mc-rate'])||0,
          missed_payments: parseInt(f['mc-missed'])||0,
          updated_at:   null,
        });
      } catch (e) { /* skip corrupt entries */ }
    }
    return loans;
  }

  // ── OFFLINE SYNC ──────────────────────────────────────────────────
  async function _syncOfflineQueue() {
    if (!_saveQueue.length) return;
    console.log(`[bridge] Syncing ${_saveQueue.length} offline save(s)…`);
    for (const id of [..._saveQueue]) {
      const raw = localStorage.getItem('wnb_offline_' + id);
      if (!raw) continue;
      try {
        const fields = JSON.parse(raw);
        await _request('PUT', `/accounts/${id}`, { fields });
        localStorage.removeItem('wnb_offline_' + id);
        _saveQueue = _saveQueue.filter(q => q !== id);
        console.log('[bridge] Synced offline save:', id);
      } catch (err) { /* still offline — try again later */ }
    }
  }

  // Retry offline saves every 30 seconds
  setInterval(_syncOfflineQueue, 30000);

  // ── URL HANDLER ───────────────────────────────────────────────────
  const _urlLoan = new URLSearchParams(window.location.search).get('loan');
  if (_urlLoan) setTimeout(() => acctBridgeLoad(_urlLoan), 400);

  // ── HEALTH CHECK ──────────────────────────────────────────────────
  async function _checkHealth() {
    try {
      const res = await fetch(API_BASE + '/health', { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        _isOnline = true;
        await _syncOfflineQueue();
      }
    } catch (e) {
      _isOnline = false;
      _labelOffline();
    }
  }
  _checkHealth();
  setInterval(_checkHealth, 60000);

  // ── EXPOSE TO WINDOW ──────────────────────────────────────────────
  window.acctBridgeSave  = acctBridgeSave;
  window.acctBridgeNew   = acctBridgeNew;
  window.acctBridgeOpen  = acctBridgeOpen;
  window.acctBridgeLoad  = acctBridgeLoad;
  window._bridgeLoadId   = id => { acctBridgeLoad(id); document.getElementById('_bridgePortModal')?.remove(); };

  console.log('[bridge] WebNote Account Bridge loaded — API:', API_BASE);

})();
