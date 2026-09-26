/* VibeMon — Dynamic Recovery: automatically re-assigns missed readings.
   Rules (confirmed by the user): a missed visit is first offered to a team already visiting the
   same location later this month (piggy-back); failing that, a nearby day that hasn't already
   absorbed more than +2 extra locations (add-on); failing that, one of the reserve days at the
   end of the month (working days 24-26, or fewer in a short month like February). Equipment with
   a recent Alarm/Alert/Critical reading is placed first, so it gets the earliest slot.
   Runs automatically (once/day per admin browser) and can be re-run on demand. Every placement is
   written to catchup_assignments (see supabase/dynamic_schedule.sql) and can be undone — the
   original static schedule (vibe_schedule) is never touched. */

const DY_SEV_RANK = { CRITICAL: 3, ALERT: 2, ALARM: 1, NORMAL: 0 };
const DY_RUN_KEY = 'vibemon_catchup_last_run_v1';
const DY_NEAR_THR = 2;      // add-on: only within this geo distance of a day's existing locations
const DY_MAX_EXTRA = 2;     // a day may absorb at most +2 NEW locations before catch-ups are forced to reserve days
const DY_DAY_CAP = 30;      // most readings a team can be given in a day
const DY_SKIP_WITHIN = 2;   // don't chase a miss if its own next regular visit is this close anyway

let _dyGeo = null;
function dyGeo() { return (_dyGeo = _dyGeo || (window.VibeEngine ? window.VibeEngine.buildGeo() : null)); }

function dyAllWorkingDays(y, m) {
  // Every non-Sunday date of the month — unlike dsWorkingDaysOfMonth this is NOT capped at 23,
  // so it includes the reserve days at the end.
  const all = []; const last = new Date(y, m + 1, 0).getDate();
  for (let d = 1; d <= last; d++) { const dt = new Date(y, m, d); if (dt.getDay() !== 0) all.push(dt); }
  return all;
}
function dyReserveDays(y, m) { return dyAllWorkingDays(y, m).slice(23); }   // [] in a short month — the February exception

/* ───────── find the misses ───────── */
// A "miss" = a scheduled visit whose date has already passed with no matching reading (own or other) —
// exactly what the Daily Schedule calendar already shows as red/"Missed".
function dyBuildMisses(y, m, today) {
  const S = dsScheduleFor(y, m);
  const wds = dsWorkingDaysOfMonth(y, m);
  const allStates = dsOccurrenceStates(y, m, dsFmt(today));
  const lastRead = (typeof buildLastReadingMap === 'function') ? buildLastReadingMap() : {};
  const misses = [];
  Object.keys(S).forEach(team => {
    wds.forEach((dt, i) => {
      if (dt >= today) return;                         // only days that have actually passed
      const wd = i + 1;
      const items = (S[team] && S[team][String(wd)]) || [];
      items.forEach(it => {
        if (!it || !it.n) return;
        const st = (allStates[team] || {})[wd + '|' + it.n];
        if (st) return;                                  // already fulfilled — not a miss
        const sev = (lastRead[it.n] && lastRead[it.n].severity) || 'NORMAL';
        misses.push({
          equipment: it.n, location: it.l || (typeof dsScheduleInfo === 'function' ? dsScheduleInfo(it.n).l : '') || '', team, wd, date: dsFmt(dt),
          sevRank: DY_SEV_RANK[sev] != null ? DY_SEV_RANK[sev] : 0,
          overdueDays: Math.round((today - dt) / 86400000)
        });
      });
    });
  });
  misses.sort((a, b) => b.sevRank - a.sevRank || b.overdueDays - a.overdueDays);   // Alarm/Alert/Critical first, then longest-waiting
  return misses;
}
function dyNextOccurrenceDate(S, team, equipment, wd, y, m) {
  const wds = dsWorkingDaysOfMonth(y, m);
  for (let i = wd; i < wds.length; i++) {
    const items = (S[team] && S[team][String(i + 1)]) || [];
    if (items.some(it => it.n === equipment)) return wds[i];
  }
  return null;
}

/* ───────── place the misses (piggy-back → add-on → reserve) ───────── */
function dyPlan(y, m, misses, existingRows) {
  const geo = dyGeo(); if (!geo) return [];
  const S = dsScheduleFor(y, m);
  const wds = dyAllWorkingDays(y, m);
  const reserveSet = new Set(dyReserveDays(y, m).map(dsFmt));
  const lastDay = wds[wds.length - 1];
  const teams = (window.VibeEngine && window.VibeEngine.TEAMS) || ['Precise', 'CB', 'CBA'];

  // live day state, seeded from the real schedule then from assignments already on record
  const locs = {}, load = {}, extra = {};
  function ensure(team, ds) {
    const k = team + '|' + ds;
    if (!locs[k]) { locs[k] = new Map(); load[k] = 0; extra[k] = 0; }
    return k;
  }
  Object.keys(S).forEach(team => {
    wds.forEach((dt, i) => {
      if (i >= 23) return;   // reserve slots have no "original" schedule to seed from
      const items = (S[team] && S[team][String(i + 1)]) || [];
      if (!items.length) return;
      const k = ensure(team, dsFmt(dt));
      items.forEach(it => { const l = it.l || (typeof dsScheduleInfo === 'function' ? dsScheduleInfo(it.n).l : '') || ''; locs[k].set(l, (locs[k].get(l) || 0) + 1); load[k]++; });
    });
  });
  (existingRows || []).forEach(r => {
    if (r.status !== 'active') return;
    const k = ensure(r.assigned_team, r.assigned_date);
    const had = locs[k].has(r.location || '');
    locs[k].set(r.location || '', (locs[k].get(r.location || '') || 0) + 1); load[k]++;
    if (!had) extra[k]++;
  });

  const placements = [];
  misses.forEach(miss => {
    const origDt = new Date(miss.date + 'T00:00:00');
    const nextOcc = dyNextOccurrenceDate(S, miss.team, miss.equipment, miss.wd, y, m);
    if (nextOcc) {
      const iNext = wds.findIndex(d => dsFmt(d) === dsFmt(nextOcc));
      const iOrig = wds.findIndex(d => dsFmt(d) === miss.date);
      if (iNext - iOrig <= DY_SKIP_WITHIN) return;         // the regular visit will pick it up anyway
    }
    const hardEnd = nextOcc || lastDay;
    const candidates = wds.filter(d => d > origDt && d <= hardEnd);
    if (!candidates.length) return;

    let best = null;
    // 1 — piggy-back: earliest day any team is already visiting this location
    for (const dt of candidates) {
      const ds = dsFmt(dt);
      for (const team of teams) {
        const k = team + '|' + ds;
        if ((load[k] || 0) >= DY_DAY_CAP) continue;
        if (locs[k] && locs[k].has(miss.location)) { best = { dt, team, source: 'piggyback' }; break; }
      }
      if (best) break;
    }
    // 2 — add-on: a nearby day, capped at +2 new locations
    if (!best) {
      let sc = null;
      for (const dt of candidates) {
        const ds = dsFmt(dt);
        for (const team of teams) {
          const k = team + '|' + ds;
          if ((load[k] || 0) >= DY_DAY_CAP || (extra[k] || 0) >= DY_MAX_EXTRA) continue;
          const dayLocs = locs[k]; if (!dayLocs || !dayLocs.size) continue;
          let dmin = 9; dayLocs.forEach((_, l) => { dmin = Math.min(dmin, geo.dist(miss.location, l)); });
          if (dmin > DY_NEAR_THR) continue;
          const score = dmin * 10 + (dt - origDt);
          if (!sc || score < sc.score) sc = { dt, team, source: 'addon', score };
        }
      }
      best = sc;
    }
    // 3 — reserve day
    if (!best) {
      let sc = null;
      candidates.filter(d => reserveSet.has(dsFmt(d))).forEach(dt => {
        const ds = dsFmt(dt);
        teams.forEach(team => {
          const k = team + '|' + ds;
          if ((load[k] || 0) >= DY_DAY_CAP) return;
          const dayLocs = locs[k];
          let c = 1;
          if (dayLocs && dayLocs.has(miss.location)) c = 0;
          else if (dayLocs && dayLocs.size) { let dm = 9; dayLocs.forEach((_, l) => { dm = Math.min(dm, geo.dist(miss.location, l)); }); c = 1 + dm; }
          const score = c * 3 + (load[k] || 0) * 0.01;
          if (!sc || score < sc.score) sc = { dt, team, source: 'reserve', score };
        });
      });
      best = sc;
    }
    if (!best) return;   // genuinely no room left this month

    const ds = dsFmt(best.dt), k = ensure(best.team, ds);
    const had = locs[k].has(miss.location);
    locs[k].set(miss.location, (locs[k].get(miss.location) || 0) + 1); load[k]++;
    if (!had) extra[k]++;
    placements.push({
      month: `${y}-${String(m + 1).padStart(2, '0')}-01`,
      equipment: miss.equipment, location: miss.location,
      original_team: miss.team, original_day: miss.wd, original_date: miss.date,
      assigned_team: best.team, assigned_date: ds, source: best.source
    });
  });
  return placements;
}

/* ───────── DB + cache ───────── */
const DY_CACHE = {};   // 'y-m' -> { rows, t }
function dyCacheKey(y, m) { return y + '-' + m; }
async function dyLoadMonth(y, m, force) {
  const k = dyCacheKey(y, m);
  if (!force && DY_CACHE[k] && Date.now() - DY_CACHE[k].t < 60000) return { rows: DY_CACHE[k].rows, fresh: false };
  const monthStart = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  try {
    const { data, error } = await _supabase.from('catchup_assignments').select('*').eq('month', monthStart).order('created_at', { ascending: false });
    if (error) throw error;
    DY_CACHE[k] = { rows: data || [], t: Date.now() };
  } catch (e) {
    console.warn('dyLoadMonth failed (has supabase/dynamic_schedule.sql been run?):', e.message);
    if (!DY_CACHE[k]) DY_CACHE[k] = { rows: [], t: 0 };
  }
  return { rows: DY_CACHE[k].rows, fresh: true };
}
function dyActiveFor(y, m, team, dateStr) {
  const rows = (DY_CACHE[dyCacheKey(y, m)] && DY_CACHE[dyCacheKey(y, m)].rows) || [];
  return rows.filter(r => r.status === 'active' && r.assigned_date === dateStr && (team === 'ALL' || r.assigned_team === team));
}

async function dyRecompute(y, m) {
  if (!window.VibeEngine) { console.warn('dyRecompute: schedule engine not loaded'); return null; }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const monthStart = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  let existing = [];
  try {
    const { data, error } = await _supabase.from('catchup_assignments').select('*').eq('month', monthStart);
    if (error) throw error;
    existing = data || [];
  } catch (e) { console.warn('dyRecompute: could not read catchup_assignments:', e.message); return null; }

  const misses = dyBuildMisses(y, m, today);
  const already = new Set(existing.filter(r => r.status === 'active').map(r => r.original_team + '|' + r.original_day + '|' + r.equipment));
  const toPlace = misses.filter(x => !already.has(x.team + '|' + x.wd + '|' + x.equipment));
  if (!toPlace.length) return { placed: 0 };

  const placements = dyPlan(y, m, toPlace, existing);
  if (!placements.length) return { placed: 0, unplaced: toPlace.length };

  const who = (typeof AUTH !== 'undefined' && (AUTH.name || AUTH.displayName || AUTH.username)) || 'system';
  const rows = placements.map(p => Object.assign({}, p, { created_by: who, status: 'active' }));
  try {
    const { error } = await _supabase.from('catchup_assignments').insert(rows);
    if (error) throw error;
  } catch (e) { console.warn('dyRecompute: failed to save assignments:', e.message); return null; }
  return { placed: rows.length, unplaced: toPlace.length - rows.length };
}

// Runs once per admin per calendar day, automatically, for the current month.
async function dyAutoRunIfDue() {
  if (typeof AUTH === 'undefined' || AUTH.role !== 'admin') return;
  const today = new Date();
  const key = DY_RUN_KEY + ':' + dsFmt(today);
  try { if (localStorage.getItem(key)) return; } catch (e) {}
  try { localStorage.setItem(key, '1'); } catch (e) {}   // set first — never retry-loop on a failure
  const res = await dyRecompute(today.getFullYear(), today.getMonth());
  if (res && res.placed) {
    try { showToast('🔁 ' + res.placed + ' missed reading' + (res.placed > 1 ? 's' : '') + ' auto-assigned as catch-ups', 'blue'); } catch (e) {}
    await dyLoadMonth(today.getFullYear(), today.getMonth(), true);
    try { dsRender(); } catch (e) {}
  }
}

async function dyUndo(id) {
  if (typeof AUTH === 'undefined' || AUTH.role !== 'admin') return;
  if (!confirm('Undo this catch-up? The equipment goes back to showing as missed until reassigned.')) return;
  try {
    const who = (AUTH.name || AUTH.displayName || AUTH.username || 'admin');
    const { error } = await _supabase.from('catchup_assignments').update({ status: 'undone', undone_by: who, undone_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  } catch (e) { alert('Could not undo: ' + e.message); return; }
  await dyLoadMonth(DS_VIEW.y, DS_VIEW.m, true);
  dsRender();
}
async function dyRecomputeNow() {
  if (typeof AUTH === 'undefined' || AUTH.role !== 'admin') return;
  const btn = document.getElementById('dy-recompute-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Computing…'; }
  const res = await dyRecompute(DS_VIEW.y, DS_VIEW.m);
  await dyLoadMonth(DS_VIEW.y, DS_VIEW.m, true);
  if (btn) { btn.disabled = false; btn.textContent = '🔁 Recompute catch-ups'; }
  dsRender();
  try {
    if (!res) showToast('⚠️ Could not compute catch-ups — check the console', 'red');
    else showToast(res.placed ? `🔁 ${res.placed} new catch-up${res.placed > 1 ? 's' : ''} assigned` : 'No new catch-ups needed', 'blue');
  } catch (e) {}
}

/* ───────── in-table review ───────── */
// Catch-ups are shown right inside the Daily Schedule day table (see dsSelectDay in daily-schedule.js) —
// a purple accent + "🔁 Catch-up" badge on the row, with Undo right there. This just keeps the small
// count badge next to the "Recompute catch-ups" button up to date; no separate list to scroll through.
const DY_SRC_LABEL = { piggyback: 'piggy-back', addon: 'add-on', reserve: 'reserve day' };
function dyRenderPanel() {
  const el = document.getElementById('dy-count-badge');
  if (!el) return;
  if (typeof AUTH === 'undefined' || AUTH.role !== 'admin') { el.textContent = ''; return; }
  const rows = ((DY_CACHE[dyCacheKey(DS_VIEW.y, DS_VIEW.m)] || {}).rows || []).filter(r => r.status === 'active');
  el.textContent = rows.length ? ' (' + rows.length + ' active)' : '';
}
