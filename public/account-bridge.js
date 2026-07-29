/*
 * Bridges the WebNote calculator face page to the loan servicing backend.
 * Loads/saves the full set of on-page fields (by element id) as a single
 * JSON blob per account, so this file needs no knowledge of individual
 * loan fields beyond a short blocklist of transient UI-state controls.
 */
(function () {
  var API_BASE = '/api/accounts';
  var TRANSIENT_IDS = new Set([
    'nav-search', 'sched-filter', 'sched-show', 'amort-jump', 'amort-show-sel',
  ]);

  var state = { accountId: null };

  function serializeFields() {
    var data = {};
    document.querySelectorAll('input[id], select[id], textarea[id]').forEach(function (el) {
      if (TRANSIENT_IDS.has(el.id)) return;
      if (el.type === 'checkbox') {
        data[el.id] = el.checked;
      } else if (el.type === 'radio') {
        if (el.checked) data[el.id] = el.value;
      } else {
        data[el.id] = el.value;
      }
    });
    return data;
  }

  function populateFields(data) {
    Object.keys(data || {}).forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var val = data[id];
      if (el.type === 'checkbox') {
        el.checked = !!val;
      } else if (el.type === 'radio') {
        el.checked = el.value === val;
      } else {
        el.value = val == null ? '' : val;
      }
    });
  }

  function safeCall(name) {
    try {
      if (typeof window[name] === 'function') window[name]();
    } catch (e) {
      console.error('account-bridge: ' + name + ' failed', e);
    }
  }

  function recalculateAll() {
    safeCall('runCalculate');
    safeCall('calcReinstatement');
    safeCall('updateServicing');
    safeCall('updateSvcBadges');
    safeCall('updateDates');
    safeCall('buildServiceSchedule');
    safeCall('renderScheduleTable');
    safeCall('renderAmortRows');
    safeCall('updateFpStatusBadge');
    safeCall('_navUpdatePills');
  }

  function setLabel(text) {
    var el = document.getElementById('acct-bridge-label');
    if (el) el.textContent = text;
  }

  function currentLoanLabel(data) {
    var num = (data['mc-loan-number-bar'] || data['mc-loan-number'] || '').trim();
    return num ? '#' + num : 'Unsaved';
  }

  function loadAccount(id) {
    fetch(API_BASE + '/' + encodeURIComponent(id))
      .then(function (res) {
        if (!res.ok) throw new Error('Account not found (' + res.status + ')');
        return res.json();
      })
      .then(function (account) {
        state.accountId = account.id;
        populateFields(account.data);
        recalculateAll();
        setLabel(currentLoanLabel(account.data));
      })
      .catch(function (err) {
        console.error('account-bridge: failed to load account', err);
        setLabel('Load failed');
        alert('Could not load this loan account: ' + err.message);
      });
  }

  window.acctBridgeSave = function () {
    var data = serializeFields();
    var req = state.accountId
      ? fetch(API_BASE + '/' + encodeURIComponent(state.accountId), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: data }),
        })
      : fetch(API_BASE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: data }),
        });

    req
      .then(function (res) {
        if (!res.ok) throw new Error('Save failed (' + res.status + ')');
        return res.json();
      })
      .then(function (account) {
        var wasNew = !state.accountId;
        state.accountId = account.id;
        setLabel(currentLoanLabel(account.data) + ' — Saved ✓');
        if (wasNew) {
          var url = new URL(window.location.href);
          url.searchParams.set('account', account.id);
          window.history.replaceState({}, '', url);
        }
      })
      .catch(function (err) {
        console.error('account-bridge: save failed', err);
        alert('Could not save this loan account: ' + err.message);
      });
  };

  window.acctBridgeNew = function () {
    if (!confirm('Start a new blank loan account? Unsaved changes on this page will be lost.')) return;
    window.location.href = '/calculator.html';
  };

  window.acctBridgeOpen = function () {
    window.location.href = '/index.html';
  };

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      window.acctBridgeSave();
    }
  });

  var params = new URLSearchParams(window.location.search);
  var accountId = params.get('account');
  if (accountId) {
    loadAccount(accountId);
  } else {
    setLabel('Unsaved — click Save to add to portfolio');
  }
})();
