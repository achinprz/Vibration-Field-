/* VibeMon — "Pending Equip" tab: scheduled equipment that has not been read for 30+ days.
   Buckets 30-60 / 60-90 / 90+ days, with the group(s) that missed its visits since the last reading and how long the oldest
   missed visit has been pending — filterable by group, unit, area, bucket and "no reading since" date. Only equipment that is on
   the current month's schedule is listed. (The catch-up statistics live in the Daily Schedule's "Catch-up summary" section —
   catchup-analysis.js.) */

const CS_TEAMS = ['Precise', 'CB', 'CBA'];
const CS_TEAM_COLOR = { Precise: '#3b82f6', CB: '#f59e0b', CBA: '#10b981' };
let _csRows = [];     // overdue table rows, before filters

function csMonths(n) {
  const t = new Date(), out = [];
  for (let i = 0; i < (n || 3); i++) { const d = new Date(t.getFullYear(), t.getMonth() - i, 1); out.push({ y: d.getFullYear(), m: d.getMonth() }); }
  return out;
}
function csTodayStr() { const t = new Date(); t.setHours(0, 0, 0, 0); return dsFmt(t); }

/* ───────── 2. equipment not read for 30+ days ───────── */
function csBuildOverdue() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr = dsFmt(today), y = today.getFullYear(), m = today.getMonth();
  const S = dsScheduleFor(y, m);
  // only equipment that is on the schedule (current month's version)
  const sch = new Map();
  Object.keys(S).forEach(team => Object.keys(S[team] || {}).forEach(wd => (S[team][wd] || []).forEach(it => {
    if (!it || !it.n) return;
    const k = normalizeEquipName(it.n);
    const e = sch.get(k) || { name: it.n, teams: new Set(), u: '', a: '', l: '', f: '' };
    e.teams.add(team); e.u = e.u || it.u || ''; e.a = e.a || it.a || ''; e.l = e.l || it.l || ''; e.f = e.f || it.f || '';
    sch.set(k, e);
  })));
  const rd = dyReadIndex();
  const lastOf = {};
  sch.forEach((e, k) => { const ds = Object.keys(rd[k] || {}); lastOf[k] = ds.length ? ds.sort().pop() : null; });

  // which groups missed visits of this equipment since its last reading (last 4 months of schedules)
  const missed = {}, firstMiss = {};
  for (let i = 0; i < 4; i++) {
    const d = new Date(y, m - i, 1), yy = d.getFullYear(), mm = d.getMonth();
    const SS = dsScheduleFor(yy, mm), states = dsOccurrenceStates(yy, mm, todayStr), wds = dsWorkingDaysOfMonth(yy, mm);
    Object.keys(SS).forEach(team => wds.forEach((dt, wi) => {
      const ds = dsFmt(dt);
      if (dt >= today) return;
      ((SS[team] && SS[team][String(wi + 1)]) || []).forEach(it => {
        if (!it || !it.n) return;
        const k = normalizeEquipName(it.n);
        if (!sch.has(k)) return;
        if (lastOf[k] && ds <= lastOf[k]) return;                 // visits before the last reading are not "missed"
        if ((states[team] || {})[(wi + 1) + '|' + it.n]) return;  // done / covered / completed via catch-up
        const g = (missed[k] = missed[k] || {});
        g[team] = (g[team] || 0) + 1;
        if (!firstMiss[k] || ds < firstMiss[k]) firstMiss[k] = ds;
      });
    }));
  }

  const rows = [];
  sch.forEach((e, k) => {
    const last = lastOf[k];
    const days = last ? _dayDiff(last, todayStr) : null;
    const info = (typeof equipInfo === 'function' ? equipInfo(e.name) : null) || {};
    rows.push({
      k, name: e.name, unit: info.unit || e.u || '', area: info.area || e.a || '', loc: e.l || (dsScheduleInfo(e.name) || {}).l || '', freq: e.f || (dsScheduleInfo(e.name) || {}).f || '',
      last, days, missed: missed[k] || {}, pendingSince: firstMiss[k] || '', teams: Array.from(e.teams)
    });
  });
  rows.sort((a, b) => (b.days === null ? 99999 : b.days) - (a.days === null ? 99999 : a.days) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  return rows;
}

function csBucketOf(days) { return days === null ? '90' : days >= 90 ? '90' : days >= 60 ? '60' : days >= 30 ? '30' : '0'; }
const CS_BUCKET_LABEL = { '30': '30–60 days', '60': '60–90 days', '90': '90+ days', '0': 'under 30 days' };
const CS_BUCKET_COLOR = { '30': '#B45309', '60': '#C2410C', '90': '#991B1B', '0': '#166534' };
const CS_BUCKET_BG = { '30': '#FEF3C7', '60': '#FFEDD5', '90': '#FEE2E2', '0': '#DCFCE7' };

function csFiltered(ignoreBucket) {
  const g = (document.getElementById('cs-f-group') || {}).value || '';
  const u = (document.getElementById('cs-f-unit') || {}).value || '';
  const a = (document.getElementById('cs-f-area') || {}).value || '';
  const b = (document.getElementById('cs-f-bucket') || {}).value || '30+';
  const since = (document.getElementById('cs-f-since') || {}).value || '';
  const q = ((document.getElementById('cs-f-search') || {}).value || '').toLowerCase().trim();
  return _csRows.filter(r => {
    if (g) {
      const mt = Object.keys(r.missed);
      if (!(mt.length ? mt.includes(g) : r.teams.includes(g))) return false;   // the group that missed it (or, if none missed it, the group it is scheduled for)
    }
    if (u && r.unit !== u) return false;
    if (a && r.area !== a) return false;
    if (since && r.last && r.last >= since) return false;                        // "no reading on or after" the chosen date
    if (!ignoreBucket && b !== 'any') {
      const bk = csBucketOf(r.days);
      if (b === '30+' ? bk === '0' : bk !== b) return false;
    }
    if (q && !(r.name.toLowerCase().includes(q) || (r.unit || '').toLowerCase().includes(q) || (r.area || '').toLowerCase().includes(q) || (r.loc || '').toLowerCase().includes(q))) return false;
    return true;
  });
}

function csFillOptions() {
  const fill = (id, vals) => {
    const el = document.getElementById(id); if (!el) return;
    const cur = el.value; while (el.options.length > 1) el.remove(1);
    vals.forEach(v => el.add(new Option(v, v))); if (cur && vals.includes(cur)) el.value = cur;
  };
  fill('cs-f-unit', Array.from(new Set(_csRows.map(r => r.unit).filter(Boolean))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
  fill('cs-f-area', Array.from(new Set(_csRows.map(r => r.area).filter(Boolean))).sort());
  const gEl = document.getElementById('cs-f-group');
  if (gEl && gEl.options.length <= 1) CS_TEAMS.forEach(t => gEl.add(new Option(TEAM_NAME[t] || t, t)));
}

function csRenderOverdue() {
  const body = document.getElementById('cs-body'); if (!body) return;
  const rows = csFiltered(false);
  const all = csFiltered(true);
  const cnt = { '30': 0, '60': 0, '90': 0 };
  all.forEach(r => { const bk = csBucketOf(r.days); if (cnt[bk] !== undefined) cnt[bk]++; });
  const kp = document.getElementById('cs-kpis');
  if (kp) kp.innerHTML = `<span class="dsq-chip warn">30–60 days: <b>${cnt['30']}</b></span><span class="dsq-chip today">60–90 days: <b>${cnt['60']}</b></span><span class="dsq-chip bad">90+ days: <b>${cnt['90']}</b></span><span class="dsq-chip pct">Showing <b>${rows.length}</b></span>`;
  const empty = document.getElementById('cs-empty'), wrap = document.getElementById('cs-wrap');
  if (!rows.length) { if (empty) empty.style.display = 'block'; if (wrap) wrap.style.display = 'none'; return; }
  if (empty) empty.style.display = 'none'; if (wrap) wrap.style.display = '';
  const canTake = AUTH.role !== 'viewer';
  body.innerHTML = rows.slice(0, 600).map(r => {
    const bk = csBucketOf(r.days);
    const missedTxt = Object.keys(r.missed).length
      ? Object.keys(r.missed).map(t => `<span class="cs-grp" style="border-color:${CS_TEAM_COLOR[t] || '#9ca3af'}">${escHtml(TEAM_NAME[t] || t)} <b>×${r.missed[t]}</b></span>`).join(' ')
      : '<span style="color:var(--muted)">—</span>';
    const schedTxt = r.teams.map(t => escHtml(TEAM_NAME[t] || t)).join(', ');
    const act = `<td class="actcell" data-label="Action" style="white-space:nowrap">${canTake ? `<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();openEquipmentForEntry(${jsArg(r.name)},'catchups')" title="Take Reading">📝 Take</button> ` : ''}<button class="btn btn-sm" onclick="event.stopPropagation();viewEquipHistory(${jsArg(r.name)})">👁 History</button></td>`;
    return `<tr style="background:${CS_BUCKET_BG[bk]}">
      <td class="eqcell" data-label="Equipment"><strong>${escHtml(r.name)}</strong><div class="dsmeta">${escHtml([r.loc, r.freq].filter(Boolean).join(' · '))}</div></td>
      <td data-label="Unit">${escHtml(r.unit)}</td><td data-label="Area">${escHtml(r.area)}</td>
      <td data-label="Last reading" style="white-space:nowrap">${r.last ? fmtDateDisplay(r.last) : '<i>No reading on record</i>'}</td>
      <td data-label="Days since" style="font-weight:700;color:${CS_BUCKET_COLOR[bk]};white-space:nowrap">${r.days === null ? '—' : r.days + ' d'}<div class="dsmeta" style="color:${CS_BUCKET_COLOR[bk]}">${CS_BUCKET_LABEL[bk]}</div></td>
      <td data-label="Pending since" style="white-space:nowrap">${r.pendingSince ? fmtDateDisplay(r.pendingSince) + `<div class="dsmeta">${_dayDiff(r.pendingSince, csTodayStr())} d pending</div>` : '—'}</td>
      <td data-label="Missed by">${missedTxt}</td>
      <td data-label="Scheduled group(s)" style="font-size:11px">${schedTxt}</td>
      ${act}</tr>`;
  }).join('');
}

function csClearFilters() {
  ['cs-f-group', 'cs-f-unit', 'cs-f-area', 'cs-f-since', 'cs-f-search'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const b = document.getElementById('cs-f-bucket'); if (b) b.value = '30+';
  csRenderOverdue();
}
function csOnSinceChange() {   // choosing a date means "no reading since…" — the age buckets would only get in the way
  const since = (document.getElementById('cs-f-since') || {}).value, b = document.getElementById('cs-f-bucket');
  if (b) b.value = since ? 'any' : '30+';
  csRenderOverdue();
}

async function csExport() {
  if (typeof XLSX === 'undefined') { alert('Excel engine loading, please try again.'); return; }
  const rows = csFiltered(false);
  if (!rows.length) { alert('Nothing to export for these filters.'); return; }
  const head = ['Equipment', 'Unit', 'Area', 'Location', 'Frequency', 'Last reading', 'Days since', 'Bucket', 'Missed by (visits missed since last reading)', 'Scheduled group(s)', 'Oldest missed visit'];
  const data = rows.map(r => [r.name, r.unit, r.area, r.loc, r.freq, r.last || 'No reading on record', r.days === null ? '' : r.days, CS_BUCKET_LABEL[csBucketOf(r.days)],
    Object.keys(r.missed).map(t => (TEAM_NAME[t] || t) + ' x' + r.missed[t]).join('; '), r.teams.map(t => TEAM_NAME[t] || t).join('; '), r.pendingSince || '']);
  const wb = XLSX.utils.book_new(), ws = XLSX.utils.aoa_to_sheet([head, ...data]);
  ws['!cols'] = head.map((h, i) => ({ wch: i === 0 ? 30 : i === 8 ? 40 : 16 }));
  XLSX.utils.book_append_sheet(wb, ws, 'Not read');
  mobileWriteFile(wb, 'VibeMon_NotRead_' + csTodayStr() + '.xlsx');
}

async function csRender(force) {
  try { _csRows = csBuildOverdue(); } catch (e) { console.error('csBuildOverdue failed:', e); _csRows = []; }
  csFillOptions(); csRenderOverdue();
  // the catch-up rows of the last 4 months are fetched (cached ~60 s) so visits completed through a catch-up are not shown as missed
  try {
    await Promise.all(csMonths(4).map(({ y, m }) => dyLoadMonth(y, m, !!force)));
    _csRows = csBuildOverdue(); csFillOptions(); csRenderOverdue();
  } catch (e) { console.warn('catch-up summary load failed:', e); }
}

(function csInit() {
  const input = document.getElementById('cs-f-search');
  if (input && typeof attachEquipAutocomplete === 'function') {
    attachEquipAutocomplete('cs-f-search', {
      source: () => csFiltered(false).map(r => ({ name: r.name, unit: r.unit, area: r.area, meta: r.days === null ? 'no reading' : r.days + ' d' })),
      fields: it => [it.name, it.unit, it.area].join(' '),
      context: () => 'Not read for 30+ days',
      onPick: () => csRenderOverdue(), onEnter: () => csRenderOverdue()
    });
  }
})();
