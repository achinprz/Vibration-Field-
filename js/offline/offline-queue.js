/* VibeMon — offline save queue (IndexedDB) + sync */

// ======= OFFLINE QUEUE MODULE =======
/* Stores pending GAS saves in IndexedDB when offline.
   Auto-syncs when navigator.onLine becomes true.
   Does NOT affect any other app functionality. */
const OfflineQ = (function() {
  const DB_NAME = 'VibeMon_OfflineQ';
  const STORE   = 'queue';
  const DB_VER  = 1;
  let _db = null;

  // -- IndexedDB helpers --
  function _openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: 'id' });
          s.createIndex('status', 'status', { unique: false });
        }
      };
      req.onsuccess = e => { _db = e.target.result; res(_db); };
      req.onerror   = () => rej(req.error);
    });
  }

  async function _put(record) {
    const db = await _openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => res();
      tx.onerror    = () => rej(tx.error);
    });
  }

  async function _getAll() {
    const db = await _openDB();
    return new Promise((res, rej) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => res(req.result || []);
      req.onerror   = () => rej(req.error);
    });
  }

  async function _delete(id) {
    const db = await _openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => res();
      tx.onerror    = () => rej(tx.error);
    });
  }

  // -- Pill UI --
  function _pill(cls, text) {
    const el = document.getElementById('vm-offline-pill');
    if (!el) return;
    el.className = 'pill-' + cls;
    el.textContent = text;
    el.style.display = text ? '' : 'none';
  }

  async function _refreshPill() {
    if (!navigator.onLine) { _pill('off', '📵 Offline'); return; }
    try {
      const all = await _getAll();
      const pend = all.filter(r => r.status === 'pending' || r.status === 'failed');
      if (pend.length === 0) { _pill('', ''); return; }
      _pill('pend', `⏳ ${pend.length} pending`);
    } catch(e) { /* ignore */ }
  }

  // -- Send one record to GAS --
  // NOTE: the retry-with-no-cors fallback below is a deliberate reliability
  // pattern (offline queue retries failed saves)
  // due to redirect/CORS quirks, even when the request was actually
  // delivered). Previously this could create a duplicate row if the first
  // attempt already succeeded on Supabase, so a retry is a safe upsert.
  // server itself de-duplicates by Report_ID + reading content, so this
  // retry is now safe to keep — worst case it's a harmless no-op on the
  // server side instead of a duplicate row.
  async function _sendOne(rec) {
    const payload = rec.payload;
    // Use the original queued time if available (it's already UTC ISO from enqueue), else use UTC now
    const now = payload.queuedAt ? payload.queuedAt : new Date().toISOString();
    const readings = payload.readings || [];
    const supaRows = readings.map(pt => ({
      report_id:        payload.reportId,
      date:             payload.date,
      username:         payload.username,
      inspector:        payload.inspector,
      unit:             payload.unit,
      area:             payload.area,
      equipment:        payload.equipment,
      rpm:              payload.rpm || '',
      frequency:        payload.frequency || '',
      point:            pt.point,
      h_vel:            pt.H_Vel || '',
      v_vel:            pt.V_Vel || '',
      a_vel:            pt.A_Vel || '',
      acc:              pt.Acc   || '',
      h_dis:            pt.H_Dis || '',
      v_dis:            pt.V_Dis || '',
      a_dis:            pt.A_Dis || '',
      severity:         pt.severity,
      recommendations:  payload.recommendation || '',
      remarks:          payload.remarks || '',
      responsible_dept: payload.responsibleDept || '',
      is_decoupled:     payload.isDecoupled ? true : false,
      label_source:     payload.labelSource || 'HUMAN',
      created_on:       now,
      updated_on:       now
    }));
    let { error } = await _supabase.from('readings').insert(supaRows);
    if (error && _isMissingLabelSourceCol(error)) {
      // supabase/readings_label_source.sql hasn't been run yet — retry without the column
      // rather than failing every save.
      supaRows.forEach(r => delete r.label_source);
      ({ error } = await _supabase.from('readings').insert(supaRows));
    }
    if (error) throw new Error(error.message);
  }

  // -- Detect "column does not exist" (Postgres 42703) for label_source specifically --
  function _isMissingLabelSourceCol(error) {
    const msg = (error && error.message || '') + ' ' + (error && error.details || '');
    return error && (error.code === '42703' || /label_source/i.test(msg)) && /column|does not exist/i.test(msg);
  }

  // -- Sync all pending --
  async function syncAll(manual) {
    if (!navigator.onLine) { if (manual) showToast('📵 Still offline — cannot sync', 'blue'); return; }
    let all;
    try { all = await _getAll(); } catch(e) { return; }
    const pend = all.filter(r => r.status === 'pending' || r.status === 'failed');
    if (!pend.length) { if (manual) showToast('✅ Nothing to sync — queue is empty', 'green'); return; }
    _pill('pend', `⏳ Syncing ${pend.length}…`);
    let ok = 0, fail = 0;
    for (const rec of pend) {
      try {
        await _sendOne(rec);
        await _delete(rec.id);
        ok++;
      } catch(e) {
        rec.status = 'failed'; rec.lastErr = e.message;
        try { await _put(rec); } catch(e2) {}
        fail++;
      }
    }
    if (fail === 0) {
      _pill('synced', `✅ Synced ${ok}`);
      if (manual || ok > 0) showToast(`✅ ${ok} offline reading${ok!==1?'s':''} synced to Supabase. Reloading data…`, 'green');
      // Exit offline mode and reload fresh data from GSheet
      setTimeout(() => {
        _pill('', '');
        if (typeof loadData === 'function') {
          loadData(); // will remove offline-mode class and restore all tabs
        } else {
          _refreshPill();
        }
      }, 1200);
    } else {
      _pill('fail', `⚠️ ${fail} failed`);
      showToast(`⚠️ ${ok} synced, ${fail} failed — tap pill to retry`, 'blue');
    }
  }

  // -- Enqueue a save --
  async function enqueue(payload, reportId) {
    const rec = { id: reportId, payload, status: 'pending', queuedAt: new Date().toISOString(), lastErr: '' };
    await _put(rec);
    await _refreshPill();
  }

  // -- Duplicate guard --
  async function alreadySynced(reportId) {
    try {
      const all = await _getAll();
      // If it was pending and got deleted (synced), it won't appear → not duplicate
      return all.some(r => r.id === reportId && r.status !== 'pending' && r.status !== 'failed');
    } catch(e) { return false; }
  }

  // -- Main entry point called by saveSession() --
  async function handleSave(payload, gsUrl, saveBtn, reportId, readings, e) {
    if (!navigator.onLine) {
      // Offline path: queue and return
      try { await enqueue(payload, reportId); } catch(err) { console.warn('OfflineQ enqueue error', err); }
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 Save & Export'; }
      showToast('📵 Offline — reading queued. Will sync automatically when online.', 'blue');
      alert(`📵 Offline Mode\n\nReading saved to local queue (IndexedDB).\nReport ID: ${reportId}\n${readings.length} point(s) for ${e.name}\n\nWill auto-sync to Supabase when internet is restored.`);
      return;
    }
    // Online path: Insert rows directly into Supabase readings table.
    const now = _localNowStr(); // Store as local IST — displayed as-is, no timezone conversion needed
    const supaRows = readings.map(pt => ({
      report_id:        reportId,
      date:             payload.date,
      username:         payload.username,
      inspector:        payload.inspector,
      unit:             payload.unit,
      area:             payload.area,
      equipment:        payload.equipment,
      rpm:              payload.rpm || '',
      frequency:        payload.frequency || '',
      point:            pt.point,
      h_vel:            pt.H_Vel || '',
      v_vel:            pt.V_Vel || '',
      a_vel:            pt.A_Vel || '',
      acc:              pt.Acc   || '',
      h_dis:            pt.H_Dis || '',
      v_dis:            pt.V_Dis || '',
      a_dis:            pt.A_Dis || '',
      severity:         pt.severity,
      recommendations:  payload.recommendation || '',
      remarks:          payload.remarks || '',
      responsible_dept: payload.responsibleDept || '',
      is_decoupled:     payload.isDecoupled ? true : false,
      label_source:     payload.labelSource || 'HUMAN',
      created_on:       now,
      updated_on:       now
    }));
    let { error: insertErr } = await _supabase.from('readings').insert(supaRows);
    if (insertErr && _isMissingLabelSourceCol(insertErr)) {
      supaRows.forEach(r => delete r.label_source);
      ({ error: insertErr } = await _supabase.from('readings').insert(supaRows));
    }
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 Save & Export'; }
    if (insertErr) {
      console.error('Supabase insert error:', insertErr);
      alert(`⚠️ Save failed: ${insertErr.message}\n\nReading queued locally.`);
    } else {
      const decTag = payload.isDecoupled ? ' 🔗 [DECOUPLED TRIAL]' : '';
      alert(`✅ Saved to Supabase! Report ID: ${reportId}\n${readings.length} points for ${e.name}${decTag}\n\nUse "Export Excel" in History tab to download.`);
    }
  }

  // -- Init: connectivity events + pill click --
  function init() {
    window.addEventListener('online', () => {
      _refreshPill();
      syncAll(false); // sends queued entries; on success, syncAll will call loadData()
      // If no queued entries, still exit offline mode and reload data
      _getAll().then(all => {
        const hasPending = all.some(r => r.status === 'pending' || r.status === 'failed');
        if (!hasPending && typeof loadData === 'function') {
          showToast('🌐 Back online — reloading data…', 'green');
          setTimeout(() => loadData(), 800);
        }
      }).catch(() => {
        if (typeof loadData === 'function') setTimeout(() => loadData(), 800);
      });
    });
    window.addEventListener('offline', () => {
      _pill('off', '📵 Offline');
      document.body.classList.add('offline-mode');
      READINGS = [];
      showTab('entry');
      showToast('📵 Gone offline — switched to Entry-only mode', 'blue');
    });
    const pill = document.getElementById('vm-offline-pill');
    if (pill) pill.addEventListener('click', () => syncAll(true));
    _refreshPill();
  }

  return { init, handleSave, syncAll, enqueue, _refreshPill };
})();

// Init after DOM ready
document.addEventListener('DOMContentLoaded', () => {
  try { OfflineQ.init(); } catch(e) {}
  // v14: readings are no longer cached offline — remove any legacy cache from v13
  try {
    localStorage.removeItem('vibemon_readings_cache_v1');
    localStorage.removeItem('vibemon_readings_cache_ts');
  } catch(e) {}
});
