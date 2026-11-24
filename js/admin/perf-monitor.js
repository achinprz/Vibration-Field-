/* VibeMon — load-time monitor + Supabase storage meter (Admin Panel → ⏱ Performance & storage).
   • Every login (and every app re-open) is timed: how long each Supabase request took, how long the screen needed to draw
     the data afterwards, and the total from pressing Login until the data was on screen. One small row per login is kept in
     Supabase (table app_perf_log) and the last 40 on the device itself.
   • The storage meter shows how much of the Supabase database is used (function vibemon_db_usage()), against the plan limit.
   Both need supabase/perf_monitor.sql run once; without it the timings still work (device-only) and the meter shows row counts. */

const PerfMon = (function () {
  const LOCAL_KEY = 'vibemon_perf_local_v1';
  const STEP_LABELS = { master: 'Equipment master', recs: 'Recommendations', schedule: 'Schedule', readings: 'Readings', settings: 'Settings', status: 'Not-running log', holidays: 'Holidays' };
  let pendingKind = null, firstLoad = true, loginT0 = 0, testing = false, last = null, serverOk = true, serverMsg = '';

  function loginStart() { pendingKind = 'login'; loginT0 = performance.now(); }
  function test() { testing = true; if (typeof loadData === 'function') loadData(); }

  function netInfo() {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!c) return navigator.onLine ? 'online' : 'offline';
    return [c.effectiveType, c.downlink ? c.downlink + ' Mb/s' : '', c.rtt ? c.rtt + ' ms rtt' : ''].filter(Boolean).join(' · ');
  }
  function deviceInfo() {
    const ua = navigator.userAgent || '', mobile = /Android|iPhone|iPad|Mobile/i.test(ua);
    const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : 'Other';
    const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
    return [mobile ? 'Phone' : 'PC', os, br].filter(Boolean).join(' ');
  }

  // called at the start of loadData(); returns a handle used to time each request and the final draw
  function start() {
    const kind = pendingKind || (testing ? 'test' : firstLoad ? 'reopen' : 'refresh');
    const t0 = performance.now(), login0 = (kind === 'login' && loginT0) ? loginT0 : t0;
    pendingKind = null; firstLoad = false; loginT0 = 0; testing = false;
    const steps = []; let tFetchEnd = 0;
    return {
      track(key, promise) {
        const s = performance.now(), rec = { key, ms: 0, ok: true };
        steps.push(rec);
        return Promise.resolve(promise).then(v => { rec.ms = Math.round(performance.now() - s); return v; },
                                             e => { rec.ms = Math.round(performance.now() - s); rec.ok = false; throw e; });
      },
      fetched() { tFetchEnd = performance.now(); },
      finish(info) {
        if (!tFetchEnd) tFetchEnd = performance.now();
        requestAnimationFrame(() => requestAnimationFrame(() => {   // after the browser has painted the refreshed screen
          const t1 = performance.now();
          let req = 0, bytes = 0;
          try { performance.getEntriesByType('resource').forEach(e => { if (e.startTime >= t0 - 5 && /supabase\.(co|in)/.test(e.name)) { req++; bytes += e.transferSize || e.encodedBodySize || 0; } }); } catch (e) {}
          const rec = {
            when: new Date().toISOString(), kind, username: (typeof AUTH !== 'undefined' && AUTH.username) || '', role: (typeof AUTH !== 'undefined' && AUTH.role) || '',
            total_ms: Math.round(t1 - login0), auth_ms: Math.round(t0 - login0), fetch_ms: Math.round(tFetchEnd - t0), render_ms: Math.round(t1 - tFetchEnd),
            readings: (info && info.readings) || 0, ok: !(info && info.ok === false), offline: !!(info && info.offline),
            requests: req, kb: bytes ? Math.round(bytes / 1024) : null, net: netInfo(), device: deviceInfo(),
            steps: steps.map(s => ({ k: s.key, ms: s.ms, ok: s.ok }))
          };
          last = rec; saveLocal(rec);
          if ((kind === 'login' || kind === 'reopen') && rec.ok && !rec.offline) saveServer(rec);
          try { if (document.querySelector('#admin-panel-modal.open .ap-pane.on[data-ap="perf"]')) perfRender(); } catch (e) {}
        }));
      }
    };
  }

  function saveLocal(rec) {
    try { const a = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); a.unshift(rec); localStorage.setItem(LOCAL_KEY, JSON.stringify(a.slice(0, 40))); } catch (e) {}
  }
  function readLocal() { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch (e) { return []; } }

  async function saveServer(rec) {
    try {
      const { error } = await _supabase.from('app_perf_log').insert({
        username: rec.username, role: rec.role, kind: rec.kind, total_ms: rec.total_ms, auth_ms: rec.auth_ms, fetch_ms: rec.fetch_ms, render_ms: rec.render_ms,
        readings: rec.readings, requests: rec.requests, kb: rec.kb, net: rec.net, device: rec.device, steps: rec.steps });
      if (error) throw error;
      serverOk = true;
    } catch (e) { serverOk = false; serverMsg = e.message || String(e); console.warn('perf log not saved to Supabase (run supabase/perf_monitor.sql?):', serverMsg); }
  }

  async function fetchLog() {
    try {
      const { data, error } = await _supabase.from('app_perf_log').select('*').order('created_on', { ascending: false }).limit(300);
      if (error) throw error;
      return { ok: true, rows: data || [] };
    } catch (e) { return { ok: false, err: e.message || String(e), rows: [] }; }
  }

  // database size: exact through the SQL function, otherwise a row-count estimate
  async function fetchUsage() {
    try {
      const { data, error } = await _supabase.rpc('vibemon_db_usage');
      if (error) throw error;
      return { exact: true, db_bytes: Number(data.db_bytes) || 0, tables: (data.tables || []).map(t => ({ name: t.name, bytes: Number(t.bytes) || 0, rows: Number(t.rows) || 0 })) };
    } catch (e) {
      const names = ['readings', 'equipment_master', 'recommendations', 'equipment_status_log', 'vibe_schedule', 'users', 'app_settings', 'app_perf_log'], tables = [];
      for (const n of names) {
        try { const { count, error } = await _supabase.from(n).select('*', { count: 'exact', head: true }); if (!error && count != null) tables.push({ name: n, rows: count, bytes: 0 }); } catch (e2) {}
      }
      const EST = { readings: 650 };   // rough bytes per reading row incl. index; everything else is tiny
      tables.forEach(t => { t.bytes = t.rows * (EST[t.name] || 300); });
      return { exact: false, err: e.message || String(e), db_bytes: tables.reduce((s, t) => s + t.bytes, 0), tables };
    }
  }

  return { loginStart, test, start, last: () => last, readLocal, fetchLog, fetchUsage, saveServerOk: () => ({ ok: serverOk, msg: serverMsg }), STEP_LABELS };
})();

// ══════════════ Admin Panel pane ══════════════
function _pmFmtMs(ms) { return ms == null ? '—' : ms >= 1000 ? (ms / 1000).toFixed(ms >= 10000 ? 0 : 1) + ' s' : Math.round(ms) + ' ms'; }
function _pmFmtBytes(b) { return b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b >= 1024 ? Math.round(b / 1024) + ' KB' : b + ' B'; }
function _pmPct(arr, p) { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }
// traffic-light colours that stay readable on both themes
function _pmLvl(level) { const light = document.documentElement.classList.contains('theme-light'); return light ? ['#1a7f37', '#9a6700', '#cf222e'][level] : ['#3fb950', '#e3b341', '#f85149'][level]; }
function _pmColor(ms) { return _pmLvl(ms < 3000 ? 0 : ms < 8000 ? 1 : 2); }
const PM_LIMIT_KEY = 'db_limit_mb';

async function perfRender() {
  const host = document.getElementById('perf-body'); if (!host) return;
  host.innerHTML = '<div style="color:var(--muted);font-size:12px">Loading…</div>';
  const [log, usage, lim] = await Promise.all([PerfMon.fetchLog(), PerfMon.fetchUsage(), (async () => {
    try { const { data } = await _supabase.from('app_settings').select('value').eq('key', PM_LIMIT_KEY).limit(1); return parseFloat(data && data[0] && data[0].value) || 500; } catch (e) { return 500; }
  })()]);
  host.innerHTML = _pmLastCard() + _pmLogCard(log) + _pmStorageCard(usage, lim);
}

function _pmLastCard() {
  const r = PerfMon.last() || PerfMon.readLocal()[0];
  const btn = `<button class="btn btn-sm btn-primary" onclick="PerfMon.test();showToast('⏱ Running the speed test…','blue')">▶ Run speed test now</button>`;
  if (!r) return _pmCard('⏱ This device — last load', btn, '<div style="color:var(--muted);font-size:12px">Nothing measured yet on this device. Press <b>Run speed test</b>, or log in again.</div>');
  const total = Math.max(r.fetch_ms + r.render_ms, 1), steps = (r.steps || []).slice().sort((a, b) => b.ms - a.ms), maxStep = Math.max(1, ...steps.map(s => s.ms), r.render_ms);
  const bar = (label, ms, col) => `<div style="display:flex;align-items:center;gap:8px;font-size:12px;margin:3px 0"><span style="width:130px;color:var(--muted)">${escHtml(label)}</span><div style="flex:1;height:10px;background:var(--surface2,rgba(100,116,139,.15));border-radius:5px;overflow:hidden"><div style="width:${Math.max(2, ms / maxStep * 100)}%;height:100%;background:${col}"></div></div><span style="width:62px;text-align:right;font-weight:600">${_pmFmtMs(ms)}</span></div>`;
  const body = `<div style="display:flex;flex-wrap:wrap;gap:18px;align-items:flex-end;margin-bottom:8px">
      <div><div style="font-size:11px;color:var(--muted)">Total, login → data on screen</div><div style="font-size:30px;font-weight:800;color:${_pmColor(r.total_ms)}">${_pmFmtMs(r.total_ms)}</div></div>
      <div style="font-size:12px;line-height:1.7;color:var(--muted)">Sign-in check ${_pmFmtMs(r.auth_ms)} · fetching ${_pmFmtMs(r.fetch_ms)} · drawing ${_pmFmtMs(r.render_ms)}<br>${r.readings.toLocaleString('en-IN')} readings · ${r.requests} requests${r.kb ? ' · ' + r.kb + ' KB' : ''}<br>${escHtml(r.device)} · ${escHtml(r.net)} · <b>${escHtml(r.kind)}</b> · ${new Date(r.when).toLocaleString()}</div></div>
    ${steps.map(s => bar(PerfMon.STEP_LABELS[s.k] || s.k, s.ms, s.ok ? 'var(--accent-blue,#0969da)' : 'var(--red,#cf222e)')).join('')}${bar('Drawing the screen', r.render_ms, '#8250df')}
    <div style="font-size:11px;color:var(--muted);margin-top:6px">The requests run at the same time, so the "fetching" time is roughly the slowest one (normally Readings).</div>`;
  return _pmCard('⏱ This device — last load', btn, body);
}

function _pmLogCard(log) {
  const local = PerfMon.readLocal();
  let rows = log.ok ? log.rows.map(r => ({ when: r.created_on, kind: r.kind, username: r.username, role: r.role, total_ms: r.total_ms, fetch_ms: r.fetch_ms, render_ms: r.render_ms, readings: r.readings, device: r.device, net: r.net })) : local.filter(r => r.kind === 'login' || r.kind === 'reopen');
  const logins = rows.filter(r => r.kind === 'login'), tot = (logins.length ? logins : rows).map(r => r.total_ms).filter(x => x > 0);
  const stat = (l, v) => `<div style="padding:6px 12px;border:1px solid var(--border);border-radius:8px"><div style="font-size:10.5px;color:var(--muted)">${l}</div><div style="font-size:18px;font-weight:800;color:${v == null ? 'var(--muted)' : _pmColor(v)}">${_pmFmtMs(v)}</div></div>`;
  const countBox = `<div style="padding:6px 12px;border:1px solid var(--border);border-radius:8px"><div style="font-size:10.5px;color:var(--muted)">Logins measured</div><div style="font-size:18px;font-weight:800">${tot.length}</div></div>`;
  const avg = tot.length ? tot.reduce((a, b) => a + b, 0) / tot.length : null;
  const warn = !log.ok ? `<div class="alert-box alert-warn" style="margin-bottom:8px"><div>⚠️ The shared login log is not set up yet (${escHtml(log.err)}). Run <code>supabase/perf_monitor.sql</code> once in the Supabase SQL Editor. Until then only this device's own timings are shown.</div></div>` : '';
  const top = rows.slice(0, 30);
  const maxT = Math.max(1, ...top.map(r => r.total_ms));
  const spark = top.length > 1 ? `<div style="display:flex;align-items:flex-end;gap:2px;height:46px;margin:8px 0" title="Newest on the right">${top.slice().reverse().map(r => `<div title="${escHtml(new Date(r.when).toLocaleString() + ' · ' + r.username + ' · ' + _pmFmtMs(r.total_ms))}" style="flex:1;min-width:3px;height:${Math.max(4, r.total_ms / maxT * 100)}%;background:${_pmColor(r.total_ms)};border-radius:2px 2px 0 0"></div>`).join('')}</div>` : '';
  const body = warn + `<div style="display:flex;flex-wrap:wrap;gap:10px">${countBox}${stat('Average', avg)}${stat('Median', _pmPct(tot, 0.5))}${stat('Slowest 1 in 20', _pmPct(tot, 0.95))}${stat('Slowest ever', tot.length ? Math.max(...tot) : null)}</div>${spark}
    <div class="tbl-wrap" style="max-height:300px;overflow:auto"><table class="ehi-table" style="width:100%"><thead><tr><th>When</th><th>User</th><th>Total</th><th>Fetch</th><th>Draw</th><th>Readings</th><th>Device / network</th></tr></thead><tbody>
      ${top.map(r => `<tr><td style="white-space:nowrap">${escHtml(new Date(r.when).toLocaleString())}${r.kind === 'reopen' ? ' <small style="color:var(--muted)">(re-open)</small>' : ''}</td><td>${escHtml(r.username || '—')}</td><td style="font-weight:700;color:${_pmColor(r.total_ms)}">${_pmFmtMs(r.total_ms)}</td><td>${_pmFmtMs(r.fetch_ms)}</td><td>${_pmFmtMs(r.render_ms)}</td><td>${(r.readings || 0).toLocaleString('en-IN')}</td><td style="font-size:11px">${escHtml(r.device || '')} · ${escHtml(r.net || '')}</td></tr>`).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:14px">No logins measured yet.</td></tr>'}
    </tbody></table></div>
    <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button class="btn btn-sm" onclick="pmPurgeLog()">🗑 Delete log entries older than 90 days</button><span style="font-size:11px;color:var(--muted)">${log.ok ? 'Showing the shared log from every device (latest 300).' : 'Showing this device only.'}</span></div>`;
  return _pmCard('📊 Login times — all devices', '', body);
}

function _pmStorageCard(u, limitMb) {
  const limit = limitMb * 1048576, pct = Math.min(100, u.db_bytes / limit * 100), col = _pmLvl(pct < 60 ? 0 : pct < 80 ? 1 : 2);
  // growth estimate from the readings this device has loaded (rows per month × bytes per row)
  let growth = '';
  const rt = u.tables.find(t => t.name === 'readings');
  if (rt && rt.rows > 0 && typeof READINGS !== 'undefined' && READINGS.length) {
    const now = new Date(), months = {};
    READINGS.forEach(r => { const m = (r.date || '').slice(0, 7); if (m) months[m] = (months[m] || 0) + 1; });
    const cur = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const full = Object.keys(months).filter(m => m < cur).sort().slice(-3);
    if (full.length) {
      const perMonth = full.reduce((s, m) => s + months[m], 0) / full.length, mb = perMonth * (rt.bytes / rt.rows) / 1048576, left = (limit - u.db_bytes) / 1048576;
      growth = `<div style="font-size:12px;margin-top:8px">📈 About <b>${Math.round(perMonth).toLocaleString('en-IN')}</b> new readings a month (average of the last ${full.length} full month${full.length > 1 ? 's' : ''}) ≈ <b>${mb.toFixed(1)} MB/month</b>. ` +
        (mb > 0 && left > 0 ? `At that pace the ${limitMb} MB limit is reached in about <b>${Math.floor(left / mb)} months</b> (without any clean-up).` : left <= 0 ? `<b style="color:${_pmLvl(2)}">The limit has been reached.</b>` : '') + '</div>';
    }
  }
  const note = u.exact ? '' : `<div class="alert-box alert-warn" style="margin-bottom:8px"><div>⚠️ <b>Estimate only.</b> Exact sizes need the SQL function — run <code>supabase/perf_monitor.sql</code> once in the Supabase SQL Editor (${escHtml(u.err || '')}). The figures below are row counts × a typical row size.</div></div>`;
  const maxB = Math.max(1, ...u.tables.map(t => t.bytes));
  const body = note + `<div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:12px"><div style="font-size:30px;font-weight:800;color:${col}">${pct.toFixed(1)}%</div><div style="font-size:13px">${_pmFmtBytes(u.db_bytes)} used of ${limitMb} MB${u.exact ? '' : ' (estimate)'}</div></div>
    <div style="height:14px;background:var(--surface2,rgba(100,116,139,.15));border-radius:7px;overflow:hidden;margin:6px 0"><div style="width:${pct}%;height:100%;background:${col}"></div></div>
    <div style="font-size:12px;color:var(--muted)">${pct < 60 ? 'Plenty of room.' : pct < 80 ? 'Getting full — plan a clean-up (Data retention) or a bigger plan.' : `<b style="color:${_pmLvl(2)}">Almost full — free space or upgrade the plan soon.</b>`}</div>${growth}
    <div style="margin-top:10px;font-size:12px;font-weight:700">Where the space goes</div>
    ${u.tables.slice().sort((a, b) => b.bytes - a.bytes).map(t => `<div style="display:flex;align-items:center;gap:8px;font-size:12px;margin:3px 0"><span style="width:150px;color:var(--muted)">${escHtml(t.name)}</span><div style="flex:1;height:8px;background:var(--surface2,rgba(100,116,139,.15));border-radius:4px;overflow:hidden"><div style="width:${Math.max(1, t.bytes / maxB * 100)}%;height:100%;background:var(--accent-blue,#0969da)"></div></div><span style="width:150px;text-align:right">${_pmFmtBytes(t.bytes)} · ${t.rows.toLocaleString('en-IN')} rows</span></div>`).join('')}
    <div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label style="font-size:12px;color:var(--muted)">Plan limit (MB) <input type="number" id="pm-limit" value="${limitMb}" min="50" step="50" style="width:90px;margin-left:4px"></label>
      <button class="btn btn-sm" onclick="pmSaveLimit()">Save limit</button><span id="pm-limit-msg" style="font-size:11px;color:var(--muted)">Free plan = 500 MB · Pro plan = 8,192 MB</span></div>`;
  return _pmCard('🗄 Supabase database — how full is it?', '<button class="btn btn-sm" onclick="perfRender()">🔄 Refresh</button>', body);
}

function _pmCard(title, right, body) {
  return `<div style="border:1px solid var(--border);border-radius:10px;margin-bottom:14px;overflow:hidden"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding:9px 14px;background:var(--surface2,rgba(100,116,139,.12));border-bottom:1px solid var(--border)"><b style="font-size:13px">${title}</b><span>${right}</span></div><div style="padding:12px 14px">${body}</div></div>`;
}

async function pmSaveLimit() {
  const v = parseFloat(document.getElementById('pm-limit').value), msg = document.getElementById('pm-limit-msg');
  if (!(v >= 50)) { msg.textContent = '⚠️ Enter a number of MB (50 or more).'; return; }
  try {
    const { error } = await _supabase.from('app_settings').upsert({ key: PM_LIMIT_KEY, value: String(v), updated_by: (AUTH && AUTH.username) || 'admin', updated_on: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
    perfRender();
  } catch (e) { msg.textContent = '⚠️ Could not save: ' + (e.message || e); }
}

async function pmPurgeLog() {
  if (!(AUTH && AUTH.role === 'admin')) return;
  if (!confirm('Delete login-time log entries older than 90 days? This cannot be undone.')) return;
  try {
    const cut = new Date(Date.now() - 90 * 864e5).toISOString();
    const { error } = await _supabase.from('app_perf_log').delete().lt('created_on', cut);
    if (error) throw error;
    showToast('Old log entries deleted', 'green'); perfRender();
  } catch (e) { showToast('Could not delete: ' + (e.message || e), 'red'); }
}
