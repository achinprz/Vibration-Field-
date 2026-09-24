/* VibeMon — Schedule Manager (admin): change how often equipment is read and generate a FUTURE month's schedule.
   • Frequency rules (per equipment family or per equipment) are stored in Supabase table schedule_rules.
   • "Generate" builds the schedule for the chosen month with js/schedule/schedule-engine.js and stores it in
     vibe_schedule as a dated version (effective_from = first day of that month). Past/current months are never touched.
   • Database set-up: supabase/schedule_rules.sql (run once in the Supabase SQL Editor). */

const SM_FREQ = [
  { code: 'W', label: 'WEEKLY',        text: 'Weekly (4 / month)' },
  { code: 'T', label: 'EVERY 10 DAYS', text: 'Every 10 days (3 / month)' },
  { code: 'F', label: 'FORTNIGHTLY',   text: 'Fortnightly (2 / month)' },
  { code: 'M', label: 'MONTHLY',       text: 'Monthly (1 / month)' }
];
const SM_CODE = {}, SM_LABEL = {}, SM_NAME = { W: 'Weekly', T: 'Every 10 days', F: 'Fortnightly', M: 'Monthly' };
SM_FREQ.forEach(f => { SM_CODE[f.label] = f.code; SM_LABEL[f.code] = f.label; });

const SM = {
  rules: { fam: {}, eq: {} }, draft: { fam: {}, eq: {} }, ruleRows: [],
  target: '', months: [], eqs: [], fams: [], expanded: new Set(), filter: '',
  preview: null, mode: 'rebuild', runs: [], dbReady: true, dbMsg: '', busy: false, msg: '', msgKind: 'info', loaded: false
};
let _smGeo = null;
const smGeo = () => (_smGeo = _smGeo || window.VibeEngine.buildGeo());
const smPad = n => String(n).padStart(2, '0');
const smUser = () => (typeof AUTH !== 'undefined' && (AUTH.name || AUTH.displayName || AUTH.username)) || 'admin';
const smResolver = rules => name => rules.eq[name] || rules.fam[window.VibeEngine.familyOf(name)] || null;

function smMonthList() {
  const now = new Date(), out = [];
  for (let i = 1; i <= 3; i++) {   // only FUTURE months: the current and past months keep the schedule they have
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    out.push({ from: `${d.getFullYear()}-${smPad(d.getMonth() + 1)}-01`, y: d.getFullYear(), m: d.getMonth(), label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) });
  }
  return out;
}
const smTarget = () => SM.months.find(x => x.from === SM.target) || SM.months[0];

function smDbError(err) {
  const c = (err && err.code) || '', msg = (err && err.message) || String(err);
  if (['42P01', 'PGRST205', '42703', 'PGRST204'].indexOf(c) >= 0 || /schema cache|does not exist|could not find/i.test(msg))
    return 'The database is not ready yet — run supabase/schedule_rules.sql in the Supabase SQL Editor first. (' + msg + ')';
  return msg;
}

/* ───────── source data: the schedule version in force in the chosen month ───────── */
function smSourceRows(y, m) {
  const S = dsScheduleFor(y, m), rows = [], per = {};
  Object.keys(S).forEach(team => Object.keys(S[team] || {}).forEach(day => (S[team][day] || []).forEach(it => {
    per[it.n] = (per[it.n] || 0) + 1;
    rows.push([team, parseInt(day, 10), it.n, SM_CODE[String(it.f || '').toUpperCase().trim()] || null, it.l || '']);
  })));
  rows.forEach(r => { if (!r[3]) { const n = per[r[2]]; r[3] = n >= 4 ? 'W' : n === 3 ? 'T' : n === 2 ? 'F' : 'M'; } });
  return rows;
}
function smBuildSource() {
  const E = window.VibeEngine, t = smTarget();
  const rows = smSourceRows(t.y, t.m), seen = new Map();
  rows.forEach(r => {
    if (!seen.has(r[2])) seen.set(r[2], { name: r[2], fam: E.familyOf(r[2]), freq: r[3], loc: r[4] });
    else if (!seen.get(r[2]).loc && r[4]) seen.get(r[2]).loc = r[4];
  });
  SM.eqs = Array.from(seen.values());
  const fm = new Map();
  SM.eqs.forEach(e => { if (!fm.has(e.fam)) fm.set(e.fam, { name: e.fam, eqs: [] }); fm.get(e.fam).eqs.push(e); });
  SM.fams = Array.from(fm.values()).sort((a, b) => a.name < b.name ? -1 : 1);
  SM.fams.forEach(f => f.eqs.sort((a, b) => a.name < b.name ? -1 : 1));
  SM.srcFrom = dsVersionFor(t.y, t.m);
  SM.mode = SM.srcFrom ? 'adjust' : 'rebuild';   // first time: rebuild (groups by location); afterwards: change only what changed
}
const smEff = (rules, e) => rules.eq[e.name] || rules.fam[e.fam] || e.freq;
const smRequired = rules => SM.eqs.reduce((s, e) => s + window.VibeEngine.ROUNDS_OF[smEff(rules, e)], 0);
const smRequiredToday = () => SM.eqs.reduce((s, e) => s + window.VibeEngine.ROUNDS_OF[e.freq], 0);

/* ───────── database ───────── */
async function smLoadRules() {
  const { data, error } = await _supabase.from('schedule_rules').select('*');
  if (error) { SM.dbReady = false; SM.dbMsg = smDbError(error); SM.rules = { fam: {}, eq: {} }; SM.ruleRows = []; SM.draft = { fam: {}, eq: {} }; return; }
  SM.dbReady = true; SM.dbMsg = '';
  const r = { fam: {}, eq: {} };
  (data || []).forEach(x => { const c = SM_CODE[x.frequency]; if (c) (x.scope === 'family' ? r.fam : r.eq)[x.target] = c; });
  SM.rules = r; SM.ruleRows = data || []; SM.draft = JSON.parse(JSON.stringify(r));
}
async function smLoadRuns() {
  const { data, error } = await _supabase.from('schedule_runs').select('*').order('generated_at', { ascending: false }).limit(12);
  SM.runs = error ? [] : (data || []);
}
async function smSaveRules() {
  const want = [];
  Object.keys(SM.draft.fam).forEach(k => want.push({ scope: 'family', target: k, frequency: SM_LABEL[SM.draft.fam[k]], updated_by: smUser() }));
  Object.keys(SM.draft.eq).forEach(k => want.push({ scope: 'equipment', target: k, frequency: SM_LABEL[SM.draft.eq[k]], updated_by: smUser() }));
  if (want.length) { const { error } = await _supabase.from('schedule_rules').upsert(want, { onConflict: 'scope,target' }); if (error) throw error; }
  const keep = new Set(want.map(w => w.scope + '|' + w.target));
  const stale = (SM.ruleRows || []).filter(r => !keep.has(r.scope + '|' + r.target)).map(r => r.id);
  if (stale.length) { const { error } = await _supabase.from('schedule_rules').delete().in('id', stale); if (error) throw error; }
}
function smTeamLabels() {
  const E = window.VibeEngine, out = Object.assign({}, E.TEAM_LABEL);
  (VIBE_VERSIONS || []).forEach(v => Object.assign(out, v.teamLabels || {}));   // reuse the exact team names already in the table
  return out;
}
function smDbRows(plan, target) {
  const E = window.VibeEngine, geo = smGeo(), labels = smTeamLabels();
  const rawKeys = VIBE_RAW_KEYS || [];
  const locKey = rawKeys.find(k => k.toLowerCase() === 'location') || 'Location';
  const rotKey = rawKeys.find(k => k.toLowerCase() === 'rotation') || 'Rotation';
  const idx = E.equipmentIndex(plan), rot = new Map();
  idx.forEach(e => e.visits.forEach((v, i) => rot.set(v.id, (i + 1) + ' of ' + e.visits.length)));
  const list = plan.visits.slice().sort((a, b) => E.TEAMS.indexOf(a.team) - E.TEAMS.indexOf(b.team) || a.day - b.day ||
    ((geo.sweepIdx[a.loc] === undefined ? 99 : geo.sweepIdx[a.loc]) - (geo.sweepIdx[b.loc] === undefined ? 99 : geo.sweepIdx[b.loc])) || (a.eq < b.eq ? -1 : 1));
  return list.map(v => {
    const r = { team: labels[v.team] || E.TEAM_LABEL[v.team], day_number: v.day, equipment: v.eq, frequency: SM_LABEL[v.freq], effective_from: target };
    r[locKey] = v.loc; r[rotKey] = rot.get(v.id);
    return r;
  });
}
async function smWriteSchedule(p) {
  const target = p.t.from, rows = smDbRows(p.newPlan, target);
  // replace an earlier generation for the same month (only dated versions can ever be deleted — see the SQL policies)
  let r = await _supabase.from('vibe_schedule').delete().eq('effective_from', target);
  if (r.error) throw r.error;
  try {
    for (let i = 0; i < rows.length; i += 500) {
      r = await _supabase.from('vibe_schedule').insert(rows.slice(i, i + 500));
      if (r.error) throw r.error;
    }
    const chk = await _supabase.from('vibe_schedule').select('id', { count: 'exact', head: true }).eq('effective_from', target);
    if (chk.error) throw chk.error;
    if (chk.count !== rows.length) throw new Error('Saved ' + chk.count + ' of ' + rows.length + ' rows');
  } catch (e) {
    await _supabase.from('vibe_schedule').delete().eq('effective_from', target);   // roll back a half-written version
    throw e;
  }
  const changes = p.diff.changed.slice(0, 60).map(c => ({ eq: c.eq, from: c.from, to: c.to }));
  await _supabase.from('schedule_runs').insert([{
    effective_from: target, generated_by: smUser(), mode: p.mode, readings_per_month: p.nst.visits, equipment_changed: p.diff.changed.length,
    summary: { trips: p.nst.trips, locationsPerTeamDay: Math.round(p.nst.locsPerDay * 100) / 100, busiestDay: p.nst.peakLoad, visitsMoved: p.diff.visitsMoved, changes, rules: SM.draft }
  }]);   // audit only — a failure here does not undo the schedule
  return rows.length;
}

/* ───────── actions ───────── */
async function smLoad() {
  SM.busy = true; SM.msg = ''; smRender();
  try {
    if (!window.VibeEngine) throw new Error('Schedule engine did not load (js/schedule/schedule-engine.js).');
    if (!VIBE_VERSIONS.length) await fetchVibeSchedule();
    SM.months = smMonthList();
    if (!SM.months.some(x => x.from === SM.target)) SM.target = SM.months[0].from;
    await smLoadRules(); await smLoadRuns();
    smBuildSource(); SM.loaded = true;
  } catch (e) { SM.msg = '⚠️ ' + smDbError(e); SM.msgKind = 'err'; }
  SM.busy = false; smRender();
}
function openScheduleManager() {
  if (typeof AUTH === 'undefined' || AUTH.role !== 'admin') return;
  document.getElementById('schedule-manager-modal').classList.add('open');
  SM.preview = null; smLoad();
}
function closeScheduleManager() { document.getElementById('schedule-manager-modal').classList.remove('open'); }

function smPreview() {
  const E = window.VibeEngine, t = smTarget(), rows = smSourceRows(t.y, t.m), resolve = smResolver(SM.draft);
  const oldPlan = E.makePlan(rows);
  let newPlan;
  try {
    newPlan = SM.mode === 'adjust' ? E.applyFrequencyChanges(oldPlan, resolve, { geo: smGeo() }) : E.optimisePlan(rows, { geo: smGeo(), resolveFreq: resolve });
  } catch (e) { SM.msg = '⚠️ Could not build the schedule: ' + e.message; SM.msgKind = 'err'; SM.preview = null; return smRender(); }
  SM.preview = { t, mode: SM.mode, oldPlan, newPlan, diff: E.diffPlans(oldPlan, newPlan), ost: E.planStats(oldPlan, smGeo()), nst: E.planStats(newPlan, smGeo()) };
  SM.msg = ''; smRender();
}
async function smConfirm() {
  if (AUTH.role !== 'admin' || !SM.preview || SM.busy) return;
  const p = SM.preview;
  if (!confirm('Generate the schedule for ' + p.t.label + '?\n\n' + p.nst.visits + ' readings a month, ' + p.diff.changed.length + ' equipment with a changed frequency.\n' +
    (p.mode === 'rebuild' ? 'The whole schedule is re-arranged for that month.\n' : 'Only the changed equipment move.\n') + 'The current and past months are not affected.')) return;
  SM.busy = true; SM.msg = '⏳ Saving rules and schedule…'; SM.msgKind = 'info'; smRender();
  let rulesSaved = false;
  try {
    await smSaveRules(); rulesSaved = true;
    const n = await smWriteSchedule(p);
    SM.preview = null;
    await fetchVibeSchedule();
    try { dsRender(); } catch (e) {}
    await smLoadRules(); await smLoadRuns(); smBuildSource();
    SM.msg = '✅ Schedule for ' + p.t.label + ' generated (' + n + ' rows). Open the Daily Schedule tab and go to that month to see it.'; SM.msgKind = 'ok';
  } catch (e) {
    SM.msg = '⚠️ ' + (rulesSaved ? 'The frequency rules were saved, but the schedule was NOT generated (no change was made to any month): ' : 'Nothing was saved: ') + smDbError(e);
    SM.msgKind = 'err';
  }
  SM.busy = false; smRender();
}
async function smRemoveVersion(from) {
  if (AUTH.role !== 'admin' || SM.busy) return;
  const t = SM.months.find(x => x.from === from);
  if (!t || !confirm('Remove the generated schedule for ' + t.label + '?\nThat month goes back to the schedule that was in force before it.')) return;
  SM.busy = true; smRender();
  try {
    const r = await _supabase.from('vibe_schedule').delete().eq('effective_from', from);
    if (r.error) throw r.error;
    await fetchVibeSchedule(); try { dsRender(); } catch (e) {}
    smBuildSource(); SM.preview = null; SM.msg = '✅ Generated schedule for ' + t.label + ' removed.'; SM.msgKind = 'ok';
  } catch (e) { SM.msg = '⚠️ ' + smDbError(e); SM.msgKind = 'err'; }
  SM.busy = false; smRender();
}

/* ───────── screen ───────── */
function smSelect(cur, blank, attr) {
  return `<select ${attr}><option value="">${blank}</option>${SM_FREQ.map(f => `<option value="${f.code}"${cur === f.code ? ' selected' : ''}>${f.text}</option>`).join('')}</select>`;
}
const smTodayMix = f => { const c = {}; f.eqs.forEach(e => { c[e.freq] = (c[e.freq] || 0) + 1; }); return Object.keys(c).map(k => SM_NAME[k] + ' ×' + c[k]).join(', '); };

function smRender() {
  const body = document.getElementById('sm-body');
  if (!body) return;
  if (!SM.loaded && SM.busy) { body.innerHTML = '<div class="sm-note">⏳ Loading schedule and rules…</div>'; return; }
  if (!SM.loaded) { body.innerHTML = SM.msg ? `<div class="sm-msg err">${escHtml(SM.msg)}</div>` : ''; return; }
  const oldWrap = body.querySelector('.sm-tblwrap'), keepScroll = oldWrap ? oldWrap.scrollTop : 0;
  const E = window.VibeEngine, t = smTarget();
  const changedRules = JSON.stringify(SM.draft) !== JSON.stringify(SM.rules);
  const verHere = (VIBE_VERSIONS || []).some(v => v.from === SM.target);
  const lastRun = (SM.runs || []).find(r => String(r.effective_from).slice(0, 10) === SM.target);
  let h = '';
  h += `<div class="sm-note">Frequency changes apply to a <b>future month only</b>. The current month and past months keep the schedule they already have.</div>`;
  if (!SM.dbReady) h += `<div class="sm-msg err">⚠️ ${escHtml(SM.dbMsg)}</div>`;
  if (SM.msg) h += `<div class="sm-msg ${SM.msgKind}">${escHtml(SM.msg)}</div>`;

  h += `<div class="sm-row"><label>Generate the schedule for <select id="sm-month">${SM.months.map(x => `<option value="${x.from}"${x.from === SM.target ? ' selected' : ''}>${x.label}</option>`).join('')}</select></label>
    <span class="sm-sub">${verHere ? `A generated schedule already exists for this month${lastRun ? ' (by ' + escHtml(lastRun.generated_by || '?') + ', ' + new Date(lastRun.generated_at).toLocaleDateString() + ')' : ''} — generating again replaces it.` :
      SM.srcFrom ? `This month currently uses the generated schedule from ${SM.srcFrom.slice(0, 7)}.` : 'This month currently uses the original schedule.'}</span>
    ${verHere ? `<button class="btn btn-sm" data-sm="remove" style="color:var(--red);border-color:var(--red)">Remove it</button>` : ''}</div>`;

  h += `<div class="sm-modes"><label><input type="radio" name="sm-mode" value="rebuild"${SM.mode === 'rebuild' ? ' checked' : ''}> <b>Rebuild the whole schedule</b> — every day covers nearby locations and visits are spaced evenly. Best the first time.</label>
    <label><input type="radio" name="sm-mode" value="adjust"${SM.mode === 'adjust' ? ' checked' : ''}> <b>Change only what changed</b> — all other visits stay on the same days. Best for small later changes.</label></div>`;

  h += `<div class="sm-row"><input type="search" id="sm-filter" placeholder="Filter families / equipment…" value="${escHtml(SM.filter)}">
    <button class="btn btn-sm" data-sm="esp">ESP vacuum pumps → Fortnightly</button>
    <button class="btn btn-sm" data-sm="reset">Clear all rules</button></div>`;

  const q = SM.filter.trim().toLowerCase();
  h += '<div class="sm-tblwrap"><table class="sm-tbl"><thead><tr><th style="width:26px"></th><th>Family / equipment</th><th>Count</th><th>Today</th><th>New frequency</th></tr></thead><tbody>';
  SM.fams.forEach(f => {
    const famHit = f.name.toLowerCase().includes(q), eqHits = q ? f.eqs.filter(e => e.name.toLowerCase().includes(q)) : f.eqs;
    if (q && !famHit && !eqHits.length) return;
    const open = SM.expanded.has(f.name) || (q && !famHit);
    const chg = SM.draft.fam[f.name] || f.eqs.some(e => SM.draft.eq[e.name]);
    h += `<tr class="${chg ? 'chg' : ''}"><td><button class="sm-tw" data-fam="${escHtml(f.name)}" aria-label="Show equipment">${open ? '▾' : '▸'}</button></td><td><b>${escHtml(f.name)}</b></td><td>${f.eqs.length}</td><td>${escHtml(smTodayMix(f))}</td>
      <td>${smSelect(SM.draft.fam[f.name] || '', 'No change', `data-famsel="${escHtml(f.name)}"`)}</td></tr>`;
    if (open) (famHit ? f.eqs : eqHits).forEach(e => {
      h += `<tr class="sub ${SM.draft.eq[e.name] ? 'chg' : ''}"><td></td><td style="padding-left:22px">${escHtml(e.name)} <span class="sm-sub">loc ${escHtml(e.loc || '?')}</span></td><td></td><td>${SM_NAME[e.freq]}</td>
        <td>${smSelect(SM.draft.eq[e.name] || '', 'Same as family', `data-eqsel="${escHtml(e.name)}"`)}</td></tr>`;
    });
  });
  h += '</tbody></table></div>';

  const req = smRequired(SM.draft), today = smRequiredToday();
  h += `<div class="sm-row"><span class="sm-sub">Readings required per month: now <b>${today.toLocaleString()}</b> → with these rules <b>${req.toLocaleString()}</b> (${req - today >= 0 ? '+' : ''}${(req - today).toLocaleString()})
    ${changedRules ? ' · <b class="sm-flag">rules changed, not saved yet</b>' : ''}</span></div>`;
  h += `<div class="sm-row"><button class="btn btn-primary" data-sm="preview"${SM.busy ? ' disabled' : ''}>Preview the schedule for ${t.label}</button></div>`;

  if (SM.preview) {
    const p = SM.preview, tile = (l, b, s) => `<div class="sm-tile"><div class="l">${l}</div><div class="b">${b}</div><div class="s">${s}</div></div>`;
    const cnt = { W: 0, T: 0, F: 0, M: 0 };
    E.equipmentIndex(p.newPlan).forEach(e => { cnt[e.visits.length >= 4 ? 'W' : e.visits.length === 3 ? 'T' : e.visits.length === 2 ? 'F' : 'M']++; });
    h += `<div class="sm-prev"><div class="sm-h">Preview — ${p.t.label} <span class="sm-sub">(${p.mode === 'rebuild' ? 'whole schedule rebuilt' : 'only changed equipment move'})</span></div><div class="sm-tiles">
      ${tile('Readings per month', p.nst.visits.toLocaleString(), 'before: ' + p.ost.visits.toLocaleString())}
      ${tile('Location trips per month', p.nst.trips, 'before: ' + p.ost.trips)}
      ${tile('Locations per team-day', (Math.round(p.nst.locsPerDay * 10) / 10), 'before: ' + (Math.round(p.ost.locsPerDay * 10) / 10))}
      ${tile('Busiest team-day', p.nst.peakLoad + ' readings', 'before: ' + p.ost.peakLoad)}
      ${tile('Equipment: weekly · 10-day · fortnightly · monthly', `${cnt.W} · ${cnt.T} · ${cnt.F} · ${cnt.M}`, '')}
      ${tile('Visits that keep their day', p.diff.visitsKept.toLocaleString(), p.diff.visitsMoved.toLocaleString() + ' move or are new')}
    </div>`;
    if (p.diff.changed.length) h += `<div class="sm-sub" style="margin:8px 0 4px">Equipment with a changed frequency (${p.diff.changed.length}):</div><div class="sm-chgs">${p.diff.changed.slice(0, 40).map(c => `<span>${escHtml(c.eq)}: ${c.from} → ${c.to} / month</span>`).join('')}${p.diff.changed.length > 40 ? `<span>… and ${p.diff.changed.length - 40} more</span>` : ''}</div>`;
    else h += `<div class="sm-sub" style="margin:8px 0">No equipment changes frequency${p.mode === 'adjust' ? ', so the schedule stays exactly as it is' : ''}.</div>`;
    h += `<div class="sm-row"><button class="btn btn-green" data-sm="confirm"${SM.busy || !SM.dbReady ? ' disabled' : ''}>✅ Save rules &amp; generate ${p.t.label}</button><button class="btn" data-sm="discard">Discard preview</button></div></div>`;
  }
  body.innerHTML = h;
  const newWrap = body.querySelector('.sm-tblwrap'); if (newWrap) newWrap.scrollTop = keepScroll;
}

/* ───────── events ───────── */
(function smEvents() {
  const body = document.getElementById('sm-body');
  if (!body) return;
  body.addEventListener('click', ev => {
    const tw = ev.target.closest('button[data-fam]');
    if (tw) { const f = tw.getAttribute('data-fam'); if (SM.expanded.has(f)) SM.expanded.delete(f); else SM.expanded.add(f); return smRender(); }
    const b = ev.target.closest('button[data-sm]');
    if (!b) return;
    const a = b.getAttribute('data-sm');
    if (a === 'preview') smPreview();
    else if (a === 'confirm') smConfirm();
    else if (a === 'discard') { SM.preview = null; smRender(); }
    else if (a === 'reset') { SM.draft = { fam: {}, eq: {} }; SM.preview = null; smRender(); }
    else if (a === 'esp') { SM.draft.fam['ESP VACUUM PUMP'] = 'F'; SM.preview = null; smRender(); }
    else if (a === 'remove') smRemoveVersion(SM.target);
  });
  body.addEventListener('change', ev => {
    const t = ev.target, fs = t.getAttribute('data-famsel'), es = t.getAttribute('data-eqsel');
    if (fs !== null) { if (t.value) SM.draft.fam[fs] = t.value; else delete SM.draft.fam[fs]; SM.preview = null; smRender(); }
    else if (es !== null) { if (t.value) SM.draft.eq[es] = t.value; else delete SM.draft.eq[es]; SM.preview = null; smRender(); }
    else if (t.id === 'sm-month') { SM.target = t.value; SM.preview = null; smBuildSource(); smRender(); }
    else if (t.name === 'sm-mode') { SM.mode = t.value; SM.preview = null; smRender(); }
  });
  body.addEventListener('input', ev => {
    if (ev.target.id === 'sm-filter') { SM.filter = ev.target.value; const pos = ev.target.selectionStart; smRender(); const el = document.getElementById('sm-filter'); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) {} } }
  });
})();
