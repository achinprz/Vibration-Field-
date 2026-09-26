/* VibeMon — Daily Schedule: find an equipment and see its whole month.
   Type part of a name (or pick from the dropdown) and every scheduled visit of the matching equipment in the month on
   screen is listed with its status — Done / Covered by another group / Missed / Pending today / Upcoming — the date it
   was actually read and who read it. Uses exactly the same matching (dsOccurrenceStates) as the calendar and the day
   table, so the answers can never disagree with them. Available to admins and operators alike; use ◀ ▶ to change month. */

const DSQ = { exact: '' };

function dsqNorm(s) { return String(s == null ? '' : s).toUpperCase().replace(/\s+/g, ' ').trim(); }

// every equipment scheduled in the month on screen (any group), with its unit / area
function dsqScheduled(y, m) {
  const S = dsScheduleFor(y, m), out = new Map();
  Object.keys(S).forEach(team => Object.keys(S[team] || {}).forEach(wd => (S[team][wd] || []).forEach(it => {
    if (it && it.n && !out.has(it.n)) out.set(it.n, it);
  })));
  return out;
}
function dsqSource() {
  const out = [];
  dsqScheduled(DS_VIEW.y, DS_VIEW.m).forEach((it, name) => {
    const info = (typeof equipInfo === 'function') ? equipInfo(name) : null;
    out.push({ name, unit: it.u || (info && info.unit) || '', area: it.a || (info && info.area) || '', meta: it.l ? 'loc ' + it.l : '' });
  });
  return out;
}
function dsqMatcher(q) {
  if (DSQ.exact) { const ex = normalizeEquipName(DSQ.exact); return n => normalizeEquipName(n) === ex; }
  const tokens = dsqNorm(q).split(' ').filter(Boolean), flat = normalizeEquipName(q);
  if (!tokens.length) return null;
  return n => { const u = dsqNorm(n); return tokens.every(t => u.includes(t)) || (flat.length >= 2 && normalizeEquipName(n).includes(flat)); };
}

function dsqStatusOf(o, states, today) {
  const s = (states[o.team] || {})[o.wd + '|' + o.item.n];
  if (s && s.state === 'own') return { k: 'done', s };
  if (s) return { k: 'covered', s };
  if (o.date > today) return { k: 'upcoming' };
  if (o.date.getTime() === today.getTime()) return { k: 'today' };
  return { k: 'missed' };
}

function dsqRefresh() {
  const box = document.getElementById('ds-eq-result'), input = document.getElementById('ds-eq-search');
  if (!box || !input) return;
  const q = input.value, match = dsqMatcher(q);
  if (!match) { box.innerHTML = ''; return; }
  const y = DS_VIEW.y, m = DS_VIEW.m, today = new Date(); today.setHours(0, 0, 0, 0);
  const monthLabel = new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const S = dsScheduleFor(y, m), wds = dsWorkingDaysOfMonth(y, m);
  let states = {};
  try { states = dsOccurrenceStates(y, m, dsFmt(today)); } catch (e) { console.warn('schedule search: states failed', e); }
  const cuRows = (((typeof DY_CACHE !== 'undefined' && DY_CACHE[y + '-' + m]) || {}).rows || []).filter(r => r.status === 'active');

  const occ = [];
  Object.keys(S).forEach(team => wds.forEach((dt, i) => {
    ((S[team] && S[team][String(i + 1)]) || []).forEach(it => { if (it && it.n && match(it.n)) occ.push({ team, wd: i + 1, date: dt, item: it }); });
  }));
  occ.sort((a, b) => a.item.n.localeCompare(b.item.n, undefined, { numeric: true }) || a.date - b.date);

  const names = Array.from(new Set(occ.map(o => o.item.n)));
  if (!occ.length) {
    box.innerHTML = `<div class="dsq-empty">No equipment matching “${escHtml(q.trim())}” is scheduled in ${escHtml(monthLabel)}. Try fewer letters, or use ◀ ▶ to check another month.</div>`;
    return;
  }
  const myTeam = (typeof AUTH !== 'undefined' && AUTH.role !== 'admin') ? dsCurrentTeam() : null;
  const cnt = { done: 0, covered: 0, missed: 0, today: 0, upcoming: 0 };
  const shownOcc = occ.slice(0, 300);
  const rows = shownOcc.map(o => {
    const st = dsqStatusOf(o, states, today); cnt[st.k]++;
    const s = st.s, d = o.date;
    const sched = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) + ` <span class="dsq-sub">WD${o.wd}</span>`;
    let readOn = '—', by = '—', timing = '';
    if (s) {
      const p = String(s.date).split('-'); readOn = p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s.date;
      const team = s.by ? (TEAM_NAME[s.by] || s.by) : '';
      by = [team, s.insp].filter(Boolean).join(' · ') || '—';
      if (s.delta) timing = ` <span class="dsq-sub">(${Math.abs(s.delta)} d ${s.delta < 0 ? 'early' : 'late'})</span>`;
    }
    let label, bg;
    if (st.k === 'done') { label = '<b style="color:var(--green)">✓ Done</b>' + timing; bg = '#D5F5E3'; }
    else if (st.k === 'covered') { label = '<b style="color:#92400E">⚠ Covered by another group</b>' + timing; bg = '#FEF08A'; }
    else if (st.k === 'upcoming') { label = '<span class="dsq-sub">Upcoming</span>'; bg = '#EFF6FF'; }
    else if (st.k === 'today') { label = '<b style="color:#C2410C">Pending today</b>'; bg = '#FFEDD5'; }
    else { label = '<b style="color:var(--red)">✗ Missed</b>'; bg = '#FEE2E2'; }
    const cu = cuRows.find(r => r.original_team === o.team && r.original_day === o.wd && normalizeEquipName(r.equipment) === normalizeEquipName(o.item.n));
    const cuTxt = cu ? ` <span class="cu-badge" title="Moved to a catch-up day">🔁 catch-up ${escHtml(cu.assigned_date || '')} · ${escHtml(TEAM_NAME[cu.assigned_team] || cu.assigned_team || '')}</span>` : '';
    const mine = (myTeam && o.team === myTeam) ? ' <span class="dsq-mine">your group</span>' : '';
    return `<tr style="background:${bg}"><td class="eqcell" data-label="Equipment"><a href="#" class="dsq-eq" onclick="viewEquipHistory(${jsArg(o.item.n)});return false">${escHtml(o.item.n)}</a>${dsEquipMeta(o.item.u || (equipInfo(o.item.n) || {}).unit, o.item.a || (equipInfo(o.item.n) || {}).area, o.item.f)}</td><td data-label="Scheduled">${sched}</td><td data-label="Group">${escHtml(TEAM_NAME[o.team] || o.team)}${mine}</td><td data-label="Loc">${escHtml(o.item.l || '')}</td><td data-label="Status">${label}${cuTxt}</td><td data-label="Read on">${readOn}</td><td data-label="Read by">${escHtml(by)}</td></tr>`;
  }).join('');

  const due = cnt.done + cnt.covered + cnt.missed + cnt.today;
  const pct = due ? Math.round((cnt.done + cnt.covered) / due * 100) : null;
  const chips = [
    `<span class="dsq-chip ok">✓ ${cnt.done} done</span>`,
    cnt.covered ? `<span class="dsq-chip warn">⚠ ${cnt.covered} covered by another group</span>` : '',
    `<span class="dsq-chip bad">✗ ${cnt.missed} missed</span>`,
    cnt.today ? `<span class="dsq-chip today">${cnt.today} pending today</span>` : '',
    `<span class="dsq-chip up">${cnt.upcoming} upcoming</span>`,
    pct === null ? '' : `<span class="dsq-chip pct">${pct}% of due visits read</span>`
  ].join('');

  let extra = '';
  if (names.length === 1) {   // single equipment: also list every reading of the month, so nothing taken outside the matching windows is hidden
    const mk = `${y}-${String(m + 1).padStart(2, '0')}`, nk = normalizeEquipName(names[0]), byDate = {};
    (dsReadingsArr() || []).forEach(r => {
      if (normalizeEquipName(r.equipment) !== nk) return;
      const ds = String(r.date || '').slice(0, 10); if (ds.slice(0, 7) !== mk) return;
      const e = byDate[ds] = byDate[ds] || { insp: r.inspector || r.username || '', sev: r.severity || '' };
      if (typeof worstSev === 'function') e.sev = worstSev([e.sev, r.severity]);
    });
    const ds = Object.keys(byDate).sort();
    extra = `<div class="dsq-sub" style="margin-top:8px"><b>All readings taken in ${escHtml(monthLabel)}:</b> ` + (ds.length ? ds.map(k => `${k.slice(8, 10)}/${k.slice(5, 7)} · ${escHtml(byDate[k].insp || '?')}${byDate[k].sev ? ' · ' + escHtml(byDate[k].sev) : ''}`).join(' &nbsp;|&nbsp; ') : 'none') + '</div>';
  }
  box.innerHTML = `<div class="dsq-head"><b>${escHtml(monthLabel)}</b> — ${names.length} equipment, ${occ.length} scheduled visit${occ.length === 1 ? '' : 's'}${names.length > 1 && shownOcc.length < occ.length ? ` <span class="dsq-sub">(first ${shownOcc.length} shown — type more to narrow)</span>` : ''}</div>
    <div class="dsq-chips">${chips}</div>
    <div class="tbl-wrap" style="margin-top:8px"><table class="ds-equip-tbl dsq-tbl"><thead><tr><th>Equipment</th><th>Scheduled</th><th>Group</th><th>Loc</th><th>Status</th><th>Read on</th><th>Read by</th></tr></thead><tbody>${rows}</tbody></table></div>${extra}
    <div class="dsq-sub" style="margin-top:6px">Use ◀ ▶ above to look at other months. Click an equipment name to open its history.</div>`;
}

function dsqClear() {
  const input = document.getElementById('ds-eq-search');
  if (input) { input.value = ''; input.focus(); }
  DSQ.exact = ''; dsqRefresh();
}

(function dsqInit() {
  const input = document.getElementById('ds-eq-search');
  if (!input) return;
  input.addEventListener('input', () => { DSQ.exact = ''; dsqRefresh(); });   // typing = a free-text filter again
  if (typeof attachEquipAutocomplete === 'function') {
    attachEquipAutocomplete('ds-eq-search', {
      source: dsqSource,
      context: () => 'Scheduled in ' + new Date(DS_VIEW.y, DS_VIEW.m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      onPick: it => { DSQ.exact = it && it.name ? it.name : ''; dsqRefresh(); },
      onEnter: () => { DSQ.exact = ''; dsqRefresh(); }
    });
  }
})();
