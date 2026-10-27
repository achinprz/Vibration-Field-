/* VibeMon — offline save queue (IndexedDB) + sync */

// ======= OFFLINE QUEUE MODULE =======
/* A reading is ALWAYS kept somewhere safe before the screen says "saved":
     • online and the upload works          -> straight into Supabase
     • no signal / weak signal / upload fails -> this phone's queue (IndexedDB) and retried automatically
     • the queue itself cannot be written    -> localStorage emergency copy (moved into the queue on the next start)
   The queue is retried when the connection returns, when the app is opened or brought back to the front, and every
   45 seconds while anything is waiting. A queued reading is checked against Supabase by Report ID before it is sent,
   so a reading whose upload "failed" but had really arrived is never inserted twice. */
const OfflineQ = (function() {
  const DB_NAME = 'VibeMon_OfflineQ';
  const STORE   = 'queue';
  const DB_VER  = 1;
  const EMERGENCY_KEY = 'vibemon_emergency_queue_v1';
  const SAVE_TIMEOUT_MS = 20000;   // a save that has not answered in this time is treated as a weak-signal failure and queued
  const SYNC_TIMEOUT_MS = 25000;
  const RETRY_EVERY_MS  = 45000;
  let _db = null, _syncing = false;

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

  const _isWaiting = r => r.status === 'pending' || r.status === 'failed';

  // -- Pill UI --
  function _pill(cls, text) {
    const el = document.getElementById('vm-offline-pill');
    if (!el) return;
    el.className = 'pill-' + cls;
    el.textContent = text;
    el.style.display = text ? '' : 'none';
  }

  async function _refreshPill() {
    let waiting = [];
    try { waiting = (await _getAll()).filter(_isWaiting); } catch(e) { /* ignore */ }
    if (!navigator.onLine) { _pill('off', '📵 Offline' + (waiting.length ? ` · ${waiting.length} queued` : '')); return; }
    if (waiting.length === 0) { _pill('', ''); return; }
    const failed = waiting.filter(r => r.status === 'failed').length;
    if (failed) _pill('fail', `⚠️ ${waiting.length} not uploaded — tap to retry`);
    else _pill('pend', `⏳ ${waiting.length} pending`);
  }

  // -- Build the Supabase rows for one saved session --
  // 'now' is the moment the reading was TAKEN, written as local time exactly like an online save ("YYYY-MM-DD HH:MM:SS").
  function _rowsFor(payload, readings, now) {
    return (readings || []).map(pt => ({
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
  }

  async function _insertRows(rows) {
    let { error } = await _supabase.from('readings').insert(rows);
    if (error && _isMissingLabelSourceCol(error)) {
      // supabase/readings_label_source.sql hasn't been run yet — retry without the column rather than failing every save.
      rows.forEach(r => delete r.label_source);
      ({ error } = await _supabase.from('readings').insert(rows));
    }
    if (error) throw new Error(error.message || 'Save failed');
  }

  // A Not-running / Standby mark (supabase/not_running.sql) — saved with the same safety net as a reading
  function _statusRow(p, now) {
    return { report_id: p.reportId, equipment: p.equipment, unit: p.unit || '', area: p.area || '', date: p.date, status: p.status, remarks: p.remarks || '',
      username: p.username || '', inspector: p.inspector || '', created_on: now || p.createdLocal || _localNowStr() };
  }
  async function _insertStatus(row) {
    const { error } = await _supabase.from('equipment_status_log').insert([row]);
    if (error) throw new Error(error.message || 'Save failed');
  }
  // Returns 'server' (uploaded now), 'queued' (kept on this phone, uploads automatically) or 'none' (could not be stored anywhere)
  async function handleSaveStatus(payload) {
    payload.kind = 'status';
    payload.createdLocal = payload.createdLocal || _localNowStr();
    const queueIt = async () => {
      try { await enqueue(payload, payload.reportId); return 'queued'; }
      catch(err) { return _emergencySave(payload, payload.reportId) ? 'queued' : 'none'; }
    };
    if (!navigator.onLine) return queueIt();
    try { await _withTimeout(_insertStatus(_statusRow(payload)), SAVE_TIMEOUT_MS); return 'server'; }
    catch(err) { console.warn('status save failed — queued', err); return queueIt(); }
  }

  function _withTimeout(promise, ms) {
    let t;
    const timer = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('No answer from the server (weak signal)')), ms); });
    return Promise.race([promise, timer]).finally(() => clearTimeout(t));
  }

  // Did this report already reach Supabase? (a save whose answer was lost on a weak link may have arrived after all)
  async function _alreadyOnServer(reportId, table) {
    const { data, error } = await _supabase.from(table || 'readings').select('report_id').eq('report_id', reportId).limit(1);
    if (error) throw new Error(error.message || 'Check failed');
    return !!(data && data.length);
  }

  // -- Send one queued record --
  async function _sendOne(rec) {
    const payload = rec.payload;
    // The reading's own time: stamped when it was taken (older queue entries: the time it was queued) — never the sync time.
    const now = payload.createdLocal || _localISOString(new Date(rec.queuedAt || Date.now())).replace('T', ' ');
    if (payload.kind === 'status') {                       // a Not-running / Standby mark
      if (await _withTimeout(_alreadyOnServer(payload.reportId, 'equipment_status_log'), SYNC_TIMEOUT_MS)) return;
      try { await _withTimeout(_insertStatus(_statusRow(payload, now)), SYNC_TIMEOUT_MS); }
      catch(e) { if (/duplicate key|23505|already exists/i.test(e.message || '')) return; throw e; }
      return;
    }
    if (await _withTimeout(_alreadyOnServer(payload.reportId), SYNC_TIMEOUT_MS)) return;
    try { await _withTimeout(_insertRows(_rowsFor(payload, payload.readings || [], now)), SYNC_TIMEOUT_MS); }
    catch(e) { if (/duplicate key|23505|already exists/i.test(e.message || '')) return; throw e; }   // it arrived in the meantime — done
  }

  // -- Detect "column does not exist" (Postgres 42703) for label_source specifically --
  function _isMissingLabelSourceCol(error) {
    const msg = (error && error.message || '') + ' ' + (error && error.details || '');
    return error && (error.code === '42703' || /label_source/i.test(msg)) && /column|does not exist/i.test(msg);
  }

  // -- Sync all waiting records --
  async function syncAll(manual) {
    if (!navigator.onLine) { if (manual) showToast('📵 Still offline — cannot sync', 'blue'); return; }
    if (_syncing) { if (manual) showToast('⏳ Already syncing…', 'blue'); return; }
    let all;
    try { all = await _getAll(); } catch(e) { return; }
    const pend = all.filter(_isWaiting).sort((a, b) => String(a.queuedAt).localeCompare(String(b.queuedAt)));
    if (!pend.length) { if (manual) showToast('✅ Nothing to sync — queue is empty', 'green'); return; }
    _syncing = true;
    _pill('pend', `⏳ Syncing ${pend.length}…`);
    let ok = 0, fail = 0;
    try {
      for (const rec of pend) {
        try {
          await _sendOne(rec);
          await _delete(rec.id);
          ok++;
        } catch(e) {
          rec.status = 'failed'; rec.lastErr = e.message; rec.tries = (rec.tries || 0) + 1; rec.lastTry = new Date().toISOString();
          try { await _put(rec); } catch(e2) {}
          fail++;
          if (/weak signal|Failed to fetch|NetworkError|network/i.test(e.message)) break;   // the link is down — do not hammer every record
        }
      }
    } finally { _syncing = false; }
    if (fail === 0) {
      _pill('synced', `✅ Synced ${ok}`);
      if (manual || ok > 0) showToast(`✅ ${ok} offline reading${ok!==1?'s':''} uploaded to Supabase. Reloading data…`, 'green');
      setTimeout(() => {
        _pill('', '');
        if (typeof loadData === 'function') loadData(); else _refreshPill();
      }, 1200);
    } else {
      _refreshPill();
      if (manual || ok > 0) showToast(`⚠️ ${ok} uploaded, ${fail} still waiting — will retry automatically`, 'blue');
    }
  }

  // -- Enqueue a save (rejects if the phone's storage cannot be written) --
  async function enqueue(payload, reportId) {
    const rec = { id: reportId, payload, status: 'pending', queuedAt: new Date().toISOString(), lastErr: '', tries: 0 };
    await _put(rec);
    await _refreshPill();
  }

  // Last-resort copy when IndexedDB itself is unavailable (private mode, storage full…)
  function _emergencySave(payload, reportId) {
    try {
      const list = JSON.parse(localStorage.getItem(EMERGENCY_KEY) || '[]');
      list.push({ id: reportId, payload, queuedAt: new Date().toISOString() });
      localStorage.setItem(EMERGENCY_KEY, JSON.stringify(list));
      return true;
    } catch(e) { return false; }
  }
  async function _emergencyMigrate() {
    let list;
    try { list = JSON.parse(localStorage.getItem(EMERGENCY_KEY) || '[]'); } catch(e) { return; }
    if (!list.length) return;
    const left = [];
    for (const r of list) {
      try { await _put({ id: r.id, payload: r.payload, status: 'pending', queuedAt: r.queuedAt, lastErr: '', tries: 0 }); }
      catch(e) { left.push(r); }
    }
    try { if (left.length) localStorage.setItem(EMERGENCY_KEY, JSON.stringify(left)); else localStorage.removeItem(EMERGENCY_KEY); } catch(e) {}
    _refreshPill();
  }

  // Readings for this machine already waiting on this phone for a date (used by the duplicate check in entry-guardrails.js)
  async function pendingFor(equipment, date) {
    try { return (await _getAll()).filter(r => _isWaiting(r) && r.payload && r.payload.kind !== 'status' && r.payload.equipment === equipment && r.payload.date === date); }
    catch(e) { return []; }
  }

  async function summary() {
    let all = [];
    try { all = (await _getAll()).filter(_isWaiting); } catch(e) {}
    if (!all.length) return 'Nothing is waiting on this phone.';
    return all.map(r => `• ${r.payload.equipment}${r.payload.kind === 'status' ? ' [not running]' : ''} (${r.payload.date}) —${r.status === 'failed' ? 'not uploaded yet: ' + (r.lastErr || 'unknown') : 'waiting for connection'}`).join('\n');
  }

  // -- Duplicate guard (kept for older callers) --
  async function alreadySynced(reportId) {
    try {
      const all = await _getAll();
      return all.some(r => r.id === reportId && r.status !== 'pending' && r.status !== 'failed');
    } catch(e) { return false; }
  }

  // Put one finished reading safely into the queue and tell the engineer the truth about where it is.
  async function _queueIt(payload, reportId, readings, e, why, detail) {
    let where = 'queue';
    try { await enqueue(payload, reportId); }
    catch(err) {
      console.warn('OfflineQ enqueue error', err);
      where = _emergencySave(payload, reportId) ? 'emergency' : 'none';
    }
    const head = why === 'offline' ? '📵 No internet' : '📶 Weak signal — the upload did not go through' + (detail ? ` (${detail})` : '');
    if (where === 'none') {
      alert(`⚠️ NOT SAVED — this phone could not store the reading.\n\n${head}\n\nPlease note these values and enter them again later:\n${e.name}\n` +
        readings.map(r => `${r.point}: ` + ['H_Vel','V_Vel','A_Vel','Acc','H_Dis','V_Dis','A_Dis'].filter(k => r[k] !== '' && r[k] != null).map(k => `${k.replace('_',' ')} ${r[k]}`).join(', ')).join('\n'));
      return false;
    }
    showToast('📵 Reading kept on this phone — uploads automatically when the signal is back.', 'blue');
    alert(`${head}\n\n✅ Reading kept safely on this phone.\nReport ID: ${reportId}\n${readings.length} point(s) for ${e.name}\n\nIt will upload automatically when the connection is back. The pill at the top shows how many are waiting.`);
    return true;
  }

  // -- Main entry point called by saveSession() --
  async function handleSave(payload, gsUrl, saveBtn, reportId, readings, e) {
    // the moment the reading was taken, in local time — used for created_on whether it uploads now or later
    payload.createdLocal = payload.createdLocal || _localNowStr();
    const resetBtn = () => { if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 Save & Export'; } };
    if (!navigator.onLine) {
      await _queueIt(payload, reportId, readings, e, 'offline');
      resetBtn();
      return;
    }
    // Online path: insert directly. navigator.onLine is true on a weak link too, so ANY failure — error, time-out, dropped
    // connection — puts the reading in the queue instead of losing it.
    let insertErr = null;
    try { await _withTimeout(_insertRows(_rowsFor(payload, readings, payload.createdLocal)), SAVE_TIMEOUT_MS); }
    catch(err) { insertErr = err; }
    resetBtn();
    if (insertErr) {
      console.error('Supabase insert error:', insertErr);
      await _queueIt(payload, reportId, readings, e, 'failed', insertErr.message);
    } else {
      const decTag = payload.isDecoupled ? ' 🔗 [DECOUPLED TRIAL]' : '';
      alert(`✅ Saved to Supabase! Report ID: ${reportId}\n${readings.length} points for ${e.name}${decTag}\n\nUse "Export Excel" in History tab to download.`);
    }
  }

  // -- Init: connectivity events, retry timer, pill click --
  function init() {
    window.addEventListener('online', () => {
      _refreshPill();
      syncAll(false); // sends queued entries; on success, syncAll will call loadData()
      // If no queued entries, still exit offline mode and reload data
      _getAll().then(all => {
        const hasPending = all.some(_isWaiting);
        if (!hasPending && typeof loadData === 'function') {
          showToast('🌐 Back online — reloading data…', 'green');
          setTimeout(() => loadData(), 800);
        }
      }).catch(() => {
        if (typeof loadData === 'function') setTimeout(() => loadData(), 800);
      });
    });
    window.addEventListener('offline', () => {
      _refreshPill();
      document.body.classList.add('offline-mode');
      READINGS = [];
      showTab('entry');
      showToast('📵 Gone offline — switched to Entry-only mode', 'blue');
    });
    const pill = document.getElementById('vm-offline-pill');
    if (pill) pill.addEventListener('click', async () => {
      if (!navigator.onLine) { alert('📵 Offline — waiting on this phone:\n\n' + await summary()); return; }
      const failedAny = (await _getAll().catch(() => [])).some(r => r.status === 'failed');
      if (failedAny) alert('Waiting on this phone:\n\n' + await summary() + '\n\nRetrying now…');
      syncAll(true);
    });

    // A weak link never fires an "online" event, so also retry on a timer and whenever the app comes to the front.
    const tryNow = () => { if (navigator.onLine && !_syncing) _getAll().then(all => { if (all.some(_isWaiting)) syncAll(false); }).catch(() => {}); };
    setInterval(tryNow, RETRY_EVERY_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { _refreshPill(); tryNow(); } });

    // Ask the browser not to evict the queue when the phone is short of space
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch(e) {}

    _emergencyMigrate().finally(() => { _refreshPill(); setTimeout(tryNow, 4000); });
  }

  return { init, handleSave, handleSaveStatus, syncAll, enqueue, pendingFor, summary, _refreshPill };
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
