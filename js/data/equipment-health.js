/* VibeMon — Equipment Health Index (EHI): one 0-100 score per machine from its recent inspection sessions.
   Used by: the trend page (badge beside the name), the History "Worst Health" popup, and catch-up priority (dynamic-recovery.js).

   How the score is made
   • One inspection session = one saved report (worst severity of its points). Decoupled-trial sessions are left out — they are
     judged against different limits and would unfairly drag a healthy machine down.
   • Newest up to 10 sessions; each scores NORMAL 100 · ALARM 60 · ALERT 30 · CRITICAL 0 (same scale as the office dashboard).
   • Newer sessions count more (each step back counts 85% of the one after it).
   • Getting worse: if the newest 3 sessions are 10+ points below the older ones, up to 10 points are taken off.
   • A machine can never look healthier than its LATEST session allows: CRITICAL caps the score at 30, ALERT at 50, ALARM at 75.
   • Fewer than 3 sessions -> no score ("Not enough data"). */

const EHI = {
  N_MAX: 10, N_MIN: 3, DECAY: 0.85,
  SCORE: { NORMAL: 100, ALARM: 60, ALERT: 30, CRITICAL: 0 },
  CAP:   { CRITICAL: 30, ALERT: 50, ALARM: 75 },
  NEUTRAL: 50,   // priority score used for a machine with no score yet
  BANDS: [
    { min: 80, key: 'healthy',  label: 'Healthy',  bg: '#16A34A', fg: '#FFFFFF' },
    { min: 60, key: 'watch',    label: 'Watch',    bg: '#F59E0B', fg: '#1F2937' },
    { min: 40, key: 'poor',     label: 'Poor',     bg: '#EA580C', fg: '#FFFFFF' },
    { min: 0,  key: 'critical', label: 'Critical', bg: '#DC2626', fg: '#FFFFFF' }
  ],
  NONE: { key: 'none', label: 'Not enough data', bg: '#6B7280', fg: '#FFFFFF' }
};

function ehiSev(s) { const t = String(s || '').toUpperCase(); return t.includes('CRIT') ? 'CRITICAL' : t.includes('ALERT') ? 'ALERT' : t.includes('ALARM') ? 'ALARM' : 'NORMAL'; }
const _EHI_RANK = { NORMAL: 0, ALARM: 1, ALERT: 2, CRITICAL: 3 };
function ehiBand(score) { if (score == null) return EHI.NONE; return EHI.BANDS.find(b => score >= b.min) || EHI.BANDS[EHI.BANDS.length - 1]; }

// Score from sessions given newest first: [{date, sev}]. Returns { score, trend } (score null when too little history).
function ehiCompute(sessions) {
  const s = sessions.slice(0, EHI.N_MAX);
  if (s.length < EHI.N_MIN) return { score: null, trend: null };
  let num = 0, den = 0;
  s.forEach((x, i) => { const w = Math.pow(EHI.DECAY, i); num += w * EHI.SCORE[x.sev]; den += w; });
  let score = num / den, trend = null;
  if (s.length >= 6) {
    const recent = (EHI.SCORE[s[0].sev] + EHI.SCORE[s[1].sev] + EHI.SCORE[s[2].sev]) / 3;
    const older = s.slice(3).reduce((a, x) => a + EHI.SCORE[x.sev], 0) / (s.length - 3);
    if (older - recent >= 10) { score -= Math.min(10, (older - recent) * 0.25); trend = 'down'; }
    else if (recent - older >= 10) trend = 'up';
    else trend = 'flat';
  }
  const cap = EHI.CAP[s[0].sev];
  if (cap !== undefined) score = Math.min(score, cap);
  return { score: Math.max(0, Math.min(100, Math.round(score))), trend };
}

// Every machine that has readings -> info. Memoised until READINGS changes.
let _ehiMemo = null;
function ehiMap() {
  const R = (typeof READINGS !== 'undefined' && READINGS) ? READINGS : [];
  const key = R.length + '|' + (R.length ? (R[0].createdOn || '') + (R[R.length - 1].createdOn || '') : '');
  if (_ehiMemo && _ehiMemo.key === key) return _ehiMemo.map;
  const byEq = {};
  const noid = {};
  R.forEach(r => {
    if (!r.equipment) return;
    const eqKey = String(r.equipment).trim().toLowerCase();
    const e = byEq[eqKey] || (byEq[eqKey] = { name: r.equipment, sess: {} });
    let sk;
    if (r.reportId) sk = r.reportId + '||' + r.date;
    else { const b = r.date + '||' + (r.inspector || '') + '||' + (r.createdOn || ''); sk = b; }
    const s = e.sess[sk] || (e.sess[sk] = { date: r.date || '', ts: r.createdOn || '', rank: 0, coupled: 0 });
    s.rank = Math.max(s.rank, _EHI_RANK[ehiSev(r.severity)]);
    if (!r.isDecoupled) s.coupled++;
  });
  const map = new Map();
  Object.keys(byEq).forEach(k => {
    const e = byEq[k];
    const list = Object.values(e.sess).filter(s => s.coupled > 0)
      .sort((a, b) => (b.date + b.ts).localeCompare(a.date + a.ts))
      .map(s => ({ date: s.date, sev: ['NORMAL', 'ALARM', 'ALERT', 'CRITICAL'][s.rank] }));
    const c = ehiCompute(list), band = ehiBand(c.score);
    map.set(k, { name: e.name, score: c.score, trend: c.trend, band: band.key, label: band.label, bg: band.bg, fg: band.fg,
      n: list.length, latestSev: list.length ? list[0].sev : null, latestDate: list.length ? list[0].date : '' });
  });
  _ehiMemo = { key, map };
  return map;
}
function ehiFor(equip) { return ehiMap().get(String(equip || '').trim().toLowerCase()) || null; }
// Number used to rank catch-ups: low = needs attention first. Machines without a score get a neutral value.
function ehiPriority(equip) { const i = ehiFor(equip); return (i && i.score != null) ? i.score : EHI.NEUTRAL; }

function ehiBadgeHtml(equip, opts) {
  opts = opts || {};
  const i = ehiFor(equip);
  const b = i && i.score != null ? { bg: i.bg, fg: i.fg, label: i.label } : EHI.NONE;
  const arrow = i && i.trend === 'down' ? ' ↓' : i && i.trend === 'up' ? ' ↑' : '';
  const txt = i && i.score != null ? `🩺 ${i.score}${arrow}` : '🩺 —';
  const tip = i && i.score != null
    ? `Equipment Health Index ${i.score}/100 — ${i.label}. Built from the last ${Math.min(i.n, EHI.N_MAX)} inspection sessions; latest ${i.latestSev} on ${i.latestDate}.${i.trend === 'down' ? ' Getting worse.' : i.trend === 'up' ? ' Improving.' : ''}`
    : `Equipment Health Index needs at least ${EHI.N_MIN} inspection sessions${i ? ` (this machine has ${i.n})` : ''}.`;
  const suffix = opts.label === false ? '' : ' · ' + escHtml(i && i.score != null ? i.label : EHI.NONE.label);
  return `<span class="ehi-badge${opts.big ? ' ehi-big' : ''}" style="background:${b.bg};color:${b.fg}" title="${escHtml(tip)}">${txt}${suffix}</span>`;
}

/* ───────── "Worst Health" popup (History tab) ───────── */
const EHI_UI = { rows: [], sortAsc: true };

function ehiOpenWorst() {
  if (typeof fxEhiVisible === 'function' && !fxEhiVisible()) return;   // starts on FEATURES_FROM (admins can look earlier)
  let m = document.getElementById('ehi-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'ehi-modal'; m.className = 'ehi-modal-bg';
    m.addEventListener('click', e => { if (e.target === m) ehiCloseWorst(); });
    m.innerHTML = `<div class="ehi-modal" role="dialog" aria-label="Worst equipment health">
      <div class="ehi-head"><span class="ehi-title">🩺 Worst Equipment Health <small id="ehi-count"></small></span>
        <button class="ehi-x" onclick="ehiCloseWorst()" aria-label="Close" title="Close">&#215;</button></div>
      <div class="ehi-filters">
        <select id="ehi-unit" onchange="ehiUnitChanged()"><option value="">All units</option></select>
        <select id="ehi-area" onchange="ehiRender()"><option value="">All areas</option></select>
        <select id="ehi-dept" onchange="ehiRender()"><option value="">All Resp Dept</option></select>
        <select id="ehi-sev" onchange="ehiRender()"><option value="">Latest severity: any</option><option value="NORMAL">Normal</option><option value="ALARM">Alarm</option><option value="ALERT">Alert</option><option value="CRITICAL">Critical</option></select>
        <select id="ehi-band" onchange="ehiRender()"><option value="">All health bands</option>${EHI.BANDS.map(b => `<option value="${b.key}">${b.label} (${b.min}${b.min ? '+' : '-'})</option>`).join('')}</select>
        <input type="text" id="ehi-search" placeholder="Search equipment..." oninput="ehiRender()">
        <label class="ehi-chk"><input type="checkbox" id="ehi-nodata" onchange="ehiRender()"> show machines with no score</label>
        <button class="btn" onclick="ehiReset()">↺ Reset</button>
        <button class="btn" onclick="ehiExport()">📥 Excel</button>
      </div>
      <div class="ehi-body"><table class="ehi-table"><thead><tr><th>#</th><th>Equipment</th><th>Unit</th><th>Area</th><th class="ehi-sort" onclick="EHI_UI.sortAsc=!EHI_UI.sortAsc;ehiRender()" title="Click to reverse the order">Health <span id="ehi-arrow">▲</span></th><th>Latest</th><th>Last reading</th><th>Sessions</th></tr></thead><tbody id="ehi-tbody"></tbody></table>
      <div class="ehi-note">Lowest health first. Click a machine to open its trend. Score = last 10 sessions, newer count more; see the 🩺 badge on the trend page for the detail.</div></div>
    </div>`;
    document.body.appendChild(m);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && m.classList.contains('open')) ehiCloseWorst(); });
  }
  // filter choices come from the equipment master
  const units = [...new Set(MASTER.map(e => e.unit).filter(Boolean))].sort();
  const depts = [...new Set(MASTER.map(e => e.dept).filter(Boolean))].sort();
  const fill = (id, vals, first) => { const el = document.getElementById(id), cur = el.value; el.innerHTML = `<option value="">${first}</option>` + vals.map(v => `<option value="${escHtml(v)}">${escHtml(v)}</option>`).join(''); el.value = vals.includes(cur) ? cur : ''; };
  fill('ehi-unit', units, 'All units'); fill('ehi-dept', depts, 'All Resp Dept');
  ehiUnitChanged(true);
  m.classList.add('open');
  document.body.classList.add('ehi-open');
  ehiRender();
}
function ehiCloseWorst() { const m = document.getElementById('ehi-modal'); if (m) m.classList.remove('open'); document.body.classList.remove('ehi-open'); }
function ehiUnitChanged(keepRender) {
  const u = document.getElementById('ehi-unit').value, el = document.getElementById('ehi-area'), cur = el.value;
  const areas = [...new Set(MASTER.filter(e => !u || e.unit === u).map(e => e.area).filter(Boolean))].sort();
  el.innerHTML = '<option value="">All areas</option>' + areas.map(a => `<option value="${escHtml(a)}">${escHtml(a)}</option>`).join('');
  el.value = areas.includes(cur) ? cur : '';
  if (!keepRender) ehiRender();
}
function ehiReset() {
  ['ehi-unit', 'ehi-area', 'ehi-dept', 'ehi-sev', 'ehi-band', 'ehi-search'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('ehi-nodata').checked = false; EHI_UI.sortAsc = true;
  ehiUnitChanged();
}
function ehiRows() {
  const g = id => document.getElementById(id).value;
  const unit = g('ehi-unit'), area = g('ehi-area'), dept = g('ehi-dept'), sev = g('ehi-sev'), band = g('ehi-band'), q = g('ehi-search').trim().toLowerCase();
  const noData = document.getElementById('ehi-nodata').checked;
  const rows = [];
  MASTER.forEach(e => {
    if (unit && e.unit !== unit) return; if (area && e.area !== area) return; if (dept && e.dept !== dept) return;
    if (q && !String(e.name).toLowerCase().includes(q)) return;
    const i = ehiFor(e.name);
    const scored = i && i.score != null;
    if (!scored && !noData) return;
    if (band && !(scored && i.band === band)) return;
    if (sev && !(i && i.latestSev === sev)) return;
    rows.push({ name: e.name, unit: e.unit || '', area: e.area || '', info: i, score: scored ? i.score : null });
  });
  rows.sort((a, b) => {
    if ((a.score == null) !== (b.score == null)) return a.score == null ? 1 : -1;   // unscored always last
    const d = EHI_UI.sortAsc ? a.score - b.score : b.score - a.score;
    return d || a.name.localeCompare(b.name);
  });
  return rows;
}
function ehiRender() {
  EHI_UI.rows = ehiRows();
  document.getElementById('ehi-arrow').textContent = EHI_UI.sortAsc ? '▲' : '▼';
  document.getElementById('ehi-count').textContent = `${EHI_UI.rows.length} equipment`;
  const sevCls = { CRITICAL: 'ehi-s-crit', ALERT: 'ehi-s-alert', ALARM: 'ehi-s-alarm', NORMAL: 'ehi-s-norm' };
  document.getElementById('ehi-tbody').innerHTML = EHI_UI.rows.length ? EHI_UI.rows.map((r, n) => {
    const i = r.info;
    return `<tr onclick="showEquipTrend(${jsArg(r.name)})" title="Open trend"><td>${n + 1}</td><td class="ehi-eq">${escHtml(r.name)}</td><td>${escHtml(r.unit)}</td><td>${escHtml(r.area)}</td>` +
      `<td>${ehiBadgeHtml(r.name, { label: false })}</td><td>${i && i.latestSev ? `<span class="ehi-sev ${sevCls[i.latestSev]}">${i.latestSev}</span>` : '—'}</td>` +
      `<td>${i && i.latestDate ? escHtml(typeof dsShortDate === 'function' ? dsShortDate(i.latestDate) : i.latestDate) : '—'}</td><td>${i ? i.n : 0}</td></tr>`;
  }).join('') : '<tr><td colspan="8" class="ehi-empty">No equipment matches these filters.</td></tr>';
}
function ehiExport() {
  const rows = [['Rank', 'Equipment', 'Unit', 'Area', 'Health score', 'Band', 'Latest severity', 'Last reading', 'Sessions']];
  EHI_UI.rows.forEach((r, n) => { const i = r.info; rows.push([n + 1, r.name, r.unit, r.area, r.score == null ? '' : r.score, i ? i.label : '', i ? i.latestSev : '', i ? i.latestDate : '', i ? i.n : 0]); });
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Equipment health');
  mobileWriteFile(wb, `VibeMon_Equipment_Health_${_todayFmt()}.xlsx`);
}
