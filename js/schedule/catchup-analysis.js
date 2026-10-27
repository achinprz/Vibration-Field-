/* VibeMon — Daily Schedule → "Catch-up summary" section (admin).
   What the catch-up algorithm planned for each of the last 3 months and how it ended — completed (before / on / after the
   catch-up day), missed by operators (catch-up day passed, still unread), still upcoming, and equipment the rules could not
   fit in. Every chip and every coloured bar segment is clickable and opens the list of equipment behind it, coloured like the
   day table (green = done by the group it was assigned to, yellow = done by another group, red = missed). The bars are drawn
   per group the catch-up was ASSIGNED to, so they show which groups follow catch-ups through and which do not. */

const CUA = { data: [], detail: null };
const CUA_BG = { green: '#D5F5E3', yellow: '#FEF08A', red: '#FEE2E2', blue: '#EFF6FF', grey: '#F3F4F6' };
const CUA_SEG = { own: '#22c55e', other: '#facc15', regular: '#cbd5e1', pending: '#93c5fd', missed: '#f87171' };
const CUA_SEG_LABEL = { own: 'completed by the assigned group', other: 'completed by another group', regular: 'read at its regular visit', pending: 'upcoming', missed: 'missed — still unread' };
const _cd = v => String(v).slice(0, 10);
const _cname = t => t ? (TEAM_NAME[t] || t) : 'Other / admin';
function _cShort(ds) { return ds ? dsShortDate(ds) : '—'; }

// one catch-up row -> a display item
function cuaItem(r, o) {
  const it = { equipment: r.equipment, loc: r.location || '', origDate: _cd(r.original_date), origTeam: r.original_team, catchDate: _cd(r.assigned_date),
    team: r.assigned_team, source: r.source, kind: o.k, when: o.when || '', doneBy: '', doneDate: '', insp: '' };
  if (o.k === 'credited' || o.k === 'regular') {
    const readers = o.readers || [];
    const own = readers.includes(r.assigned_team);
    it.doneBy = own ? r.assigned_team : (readers.find(t => t) || '');
    it.doneDate = o.date; it.insp = o.insp || '';
    it.color = own ? 'green' : 'yellow';
    it.seg = o.k === 'regular' ? 'regular' : (own ? 'own' : 'other');
    it.cat = o.k === 'regular' ? 'regular' : 'done_' + o.when;
    it.status = o.k === 'regular' ? 'Read at its regular visit (not because of the catch-up)' : (own ? 'Completed' : 'Completed by another group');
  } else if (o.k === 'failed') { it.color = 'red'; it.seg = 'missed'; it.cat = 'missed'; it.status = 'Missed — still unread after the catch-up day'; }
  else if (o.k === 'pending') { it.color = 'blue'; it.seg = 'pending'; it.cat = 'pending'; it.status = 'Upcoming'; }
  else { it.color = 'grey'; it.seg = ''; it.cat = 'cancelled'; it.status = o.why === 'standby-limit' ? 'Stopped — still not running after ' + DY_NR_MAX + ' re-checks' : 'Cancelled — the visit had already been completed'; }
  return it;
}

// misses that never got a catch-up row: the rules could not fit them in this month
function cuaUncovered(y, m, rows) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const covered = new Set(rows.map(r => normalizeEquipName(r.equipment) + '|' + r.original_team + '|' + r.original_day));
  const out = [];
  dyBuildMisses(y, m, today).forEach(x => {
    if (covered.has(normalizeEquipName(x.equipment) + '|' + x.team + '|' + x.wd)) return;
    out.push({ equipment: x.equipment, loc: x.location || '', origDate: x.date, origTeam: x.team, catchDate: '', team: '', source: '', kind: 'unplaced',
      cat: 'unplaced', color: 'red', seg: '', doneBy: '', doneDate: '', insp: '', sev: x.sevRank,
      status: 'Could not be fitted: the location limits (5 per date on working days, 5 per group on reserve days) and group loads were full on every day it could use, or it would have needed a lone extra location on a working day' });
  });
  return out;
}

function cuaBuild(y, m) {
  const todayStr = csTodayStr();
  const rows = (((DY_CACHE[dyCacheKey(y, m)] || {}).rows) || []).filter(r => !(r.status === 'undone' && !String(r.undone_by || '').startsWith('auto')));
  const items = rows.map(r => cuaItem(r, dyOutcome(r, todayStr)));
  let extra = [];
  try { extra = cuaUncovered(y, m, rows); } catch (e) { console.warn('cuaUncovered failed:', e); }
  const hasRows = rows.length > 0, isCurrent = (y === new Date().getFullYear() && m === new Date().getMonth());
  if (!hasRows && !isCurrent) extra = [];
  return { y, m, name: new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), items: items.concat(extra) };
}

function cuaMatch(it, key, team) {
  if (team && it.team !== team) return false;
  switch (key) {
    case 'total': return it.cat !== 'cancelled' && it.kind !== 'unplaced' && it.kind !== 'soon';
    case 'done': return it.cat.indexOf('done_') === 0;
    case 'seg_own': return it.seg === 'own'; case 'seg_other': return it.seg === 'other';
    case 'seg_regular': return it.seg === 'regular'; case 'seg_pending': return it.seg === 'pending'; case 'seg_missed': return it.seg === 'missed';
    default: return it.cat === key;
  }
}
const cuaCount = (d, key, team) => d.items.filter(it => cuaMatch(it, key, team)).length;

function cuaChip(i, key, label, n, cls, tip) {
  return `<button type="button" class="dsq-chip cua-chip ${cls}" ${n ? '' : 'disabled'} title="${escHtml(tip || '')}" onclick="cuaOpen(${i},'${key}','')">${label} <b>${n}</b></button>`;
}

function cuaRender(force) {
  const box = document.getElementById('cua-body'); if (!box) return Promise.resolve();
  const paint = () => {
    CUA.data = csMonths().map(({ y, m }) => cuaBuild(y, m));
    box.innerHTML = CUA.data.map((d, i) => {
      const n = key => cuaCount(d, key, '');
      const planned = n('total');
      if (!planned && !n('cancelled') && !n('unplaced')) return `<div class="cs-month"><div class="cs-month-h">📅 ${d.name}</div><div class="cs-none">No catch-ups were created this month.</div></div>`;
      const chips = [
        cuaChip(i, 'total', '🤖 Planned by the algorithm', planned, 'up', 'Every catch-up the algorithm created (cancelled ones excluded)'),
        cuaChip(i, 'done', '✓ Completed', n('done'), 'ok', 'Missed visits completed because of a catch-up'),
        cuaChip(i, 'done_before', 'before the catch-up day', n('done_before'), 'ok', ''),
        cuaChip(i, 'done_day', 'on the catch-up day', n('done_day'), 'ok', ''),
        cuaChip(i, 'done_after', 'after it', n('done_after'), 'warn', 'Completed, but later than the catch-up day'),
        cuaChip(i, 'missed', '✗ Missed by operators', n('missed'), 'bad', 'Catch-up day passed and the equipment is still unread (it gets re-scheduled)'),
        cuaChip(i, 'pending', '⏳ Upcoming', n('pending'), 'today', 'Catch-up day not reached yet'),
        cuaChip(i, 'unplaced', '⚠ Could not be fitted in', n('unplaced'), 'bad', 'Missed visits for which no slot was free under the rules (5 locations per date on working days, 5 per group on reserve days, group load)'),
        cuaChip(i, 'cancelled', 'Cancelled', n('cancelled'), 'pct', 'Visit had already been completed')
      ].join('');
      // one bar per group the catch-up was ASSIGNED to
      const teams = Array.from(new Set(d.items.filter(it => it.team).map(it => it.team))).sort((a, b) => (CS_TEAMS.indexOf(a) + 1 || 9) - (CS_TEAMS.indexOf(b) + 1 || 9));
      const bars = teams.map(t => {
        const c = { own: 0, other: 0, regular: 0, pending: 0, missed: 0 };
        d.items.forEach(it => { if (it.team === t && c[it.seg] !== undefined) c[it.seg]++; });
        const tot = c.own + c.other + c.regular + c.pending + c.missed; if (!tot) return '';
        const due = c.own + c.other + c.regular + c.missed;
        const pct = due ? Math.round(c.own / due * 100) : 0;
        const seg = k => c[k] ? `<button type="button" class="cua-seg" style="width:${c[k] / tot * 100}%;background:${CUA_SEG[k]}" title="${escHtml(_cname(t))} — ${CUA_SEG_LABEL[k]}: ${c[k]}" onclick="cuaOpen(${i},'seg_${k}','${t}')"></button>` : '';
        return `<div class="cs-bar-row"><span class="cs-bar-name" title="${escHtml(_cname(t))}">${escHtml(_cname(t))}</span>
          <div class="cs-bar cua-bar">${seg('own')}${seg('other')}${seg('regular')}${seg('pending')}${seg('missed')}</div>
          <span class="cs-bar-val" title="Completed by this group ÷ its catch-ups that are due (${due})">${c.own}/${due} (${pct}%)</span></div>`;
      }).join('');
      const legend = Object.keys(CUA_SEG).map(k => `<i style="background:${CUA_SEG[k]}"></i>${CUA_SEG_LABEL[k]}`).join(' ');
      return `<div class="cs-month"><div class="cs-month-h">📅 ${d.name}</div>
        <div class="dsq-chips">${chips}</div>
        <div class="cs-sub" style="margin:10px 0 4px"><b>Follow-through by the group each catch-up was assigned to</b> — click any chip or coloured piece to see the equipment
          <div class="cs-legend" style="margin:3px 0 0">${legend}</div></div>${bars || '<div class="cs-none">Nothing assigned.</div>'}</div>`;
    }).join('');
    if (CUA.detail && CUA.data[CUA.detail.i]) cuaOpen(CUA.detail.i, CUA.detail.key, CUA.detail.team, true);
  };
  paint();
  return Promise.all(csMonths().map(({ y, m }) => dyLoadMonth(y, m, !!force))).then(paint).catch(e => console.warn('catch-up summary load failed:', e));
}

function cuaTitle(d, key, team) {
  const names = { total: 'All catch-ups planned by the algorithm', done: 'Completed via catch-up', done_before: 'Completed before the catch-up day', done_day: 'Completed on the catch-up day',
    done_after: 'Completed after the catch-up day', missed: 'Missed by operators — still unread', pending: 'Upcoming catch-ups', regular: 'Read at the regular visit instead',
    unplaced: 'Could not be fitted in under the rules', soon: 'Left to the regular visit', cancelled: 'Cancelled — visit already completed',
    seg_own: 'Completed by the group it was assigned to', seg_other: 'Completed by another group', seg_regular: 'Read at its regular visit', seg_pending: 'Upcoming', seg_missed: 'Missed — still unread' };
  return `${d.name} — ${names[key] || key}${team ? ' · assigned to ' + _cname(team) : ''}`;
}

function cuaOpen(i, key, team, keepScroll) {
  const d = CUA.data[i]; if (!d) return;
  CUA.detail = { i, key, team };
  const rows = d.items.filter(it => cuaMatch(it, key, team)).sort((a, b) => (a.catchDate || a.origDate).localeCompare(b.catchDate || b.origDate) || a.equipment.localeCompare(b.equipment, undefined, { numeric: true }));
  const box = document.getElementById('cua-detail'); if (!box) return;
  const SRC = { piggyback: 'rides along', addon: 'nearby add-on', reserve: 'reserve day' };
  const body = rows.slice(0, 700).map(it => {
    const dn = it.doneBy !== '' || it.doneDate ? `<b>${escHtml(_cname(it.doneBy))}</b><div class="dsmeta">${_cShort(it.doneDate)}${it.insp && it.insp !== _cname(it.doneBy) ? ' · ' + escHtml(it.insp) : ''}</div>` : '—';
    const col = { green: '#166534', yellow: '#92400E', red: '#991B1B', blue: '#1E40AF', grey: '#4b5563' }[it.color];
    return `<tr style="background:${CUA_BG[it.color]}">
      <td class="eqcell" data-label="Equipment"><strong>${escHtml(it.equipment)}</strong><div class="dsmeta">${escHtml(it.loc)}</div></td>
      <td data-label="Missed visit">${_cShort(it.origDate)}<div class="dsmeta">${escHtml(_cname(it.origTeam))}</div></td>
      <td data-label="Catch-up date">${it.catchDate ? _cShort(it.catchDate) + `<div class="dsmeta">${SRC[it.source] || ''}</div>` : '—'}</td>
      <td data-label="Assigned to">${it.team ? escHtml(_cname(it.team)) : '—'}</td>
      <td data-label="Status" style="color:${col};font-weight:700">${escHtml(it.status)}</td>
      <td data-label="Completed by">${dn}</td></tr>`;
  }).join('');
  box.innerHTML = `<div class="cua-detail-card"><div class="cua-detail-h"><b>${escHtml(cuaTitle(d, key, team))}</b> <span class="cs-sub">— ${rows.length} equipment</span>
      <span style="flex:1"></span><button class="btn btn-sm" onclick="cuaExport()">📥 Excel</button><button class="btn btn-sm" onclick="cuaClose()">✕ Close</button></div>
    ${rows.length ? `<div class="tbl-wrap"><table class="ds-equip-tbl cua-tbl"><thead><tr><th>Equipment</th><th>Missed visit</th><th>Catch-up date</th><th>Assigned to</th><th>Status</th><th>Completed by</th></tr></thead><tbody>${body}</tbody></table></div>`
      : '<div class="cs-none" style="padding:10px">Nothing in this category.</div>'}
    ${rows.length > 700 ? '<div class="cs-sub">First 700 shown — use Excel for the full list.</div>' : ''}</div>`;
  box.style.display = 'block';
  if (!keepScroll) { try { box.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {} }
}
function cuaClose() { CUA.detail = null; const b = document.getElementById('cua-detail'); if (b) { b.style.display = 'none'; b.innerHTML = ''; } }

function cuaExport() {
  if (typeof XLSX === 'undefined') { alert('Excel engine loading, please try again.'); return; }
  const dt = CUA.detail; if (!dt) return; const d = CUA.data[dt.i]; if (!d) return;
  const rows = d.items.filter(it => cuaMatch(it, dt.key, dt.team));
  const head = ['Equipment', 'Location', 'Missed visit', 'Missed by group', 'Catch-up date', 'Assigned to', 'Status', 'Completed by', 'Completed on'];
  const data = rows.map(it => [it.equipment, it.loc, it.origDate, _cname(it.origTeam), it.catchDate, it.team ? _cname(it.team) : '', it.status, it.doneDate ? _cname(it.doneBy) : '', it.doneDate]);
  const wb = XLSX.utils.book_new(), ws = XLSX.utils.aoa_to_sheet([head, ...data]);
  ws['!cols'] = head.map((h, i) => ({ wch: i === 0 ? 30 : i === 6 ? 46 : 18 }));
  XLSX.utils.book_append_sheet(wb, ws, 'Catch-ups');
  mobileWriteFile(wb, 'VibeMon_Catchups_' + d.name.replace(/\s+/g, '_') + '_' + dt.key + '.xlsx');
}
