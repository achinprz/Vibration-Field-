/* VibeMon — Dynamic Recovery: automatically re-assigns missed readings. Every scheduled visit is owed its own reading (a fortnightly
   machine = two readings a month), so a missed visit is caught up wherever its next regular visit falls — kept well apart from it, on a
   reserve day if the working days cannot take it without a lopsided extra trip.
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
const DY_MIN_GAP_DAYS = 7;       // keep a catch-up this many calendar days away from the equipment's next regular visit (half the interval for weekly machines)
const DY_ADDON_MIN_CLUSTER = 3;  // a NEW location on a working day is only opened for a location with at least this many waiting machines (or an Alarm+ machine)
const DY_MAX_CU_LOCS = 5;   // working days: at most this many DIFFERENT locations carrying catch-ups on one date (all groups together)
const DY_MAX_CU_LOCS_RESERVE = 5;   // reserve days (no regular work): at most this many different locations PER GROUP on one reserve day   // at most this many DIFFERENT locations carrying catch-ups on one date (all groups together)

let _dyGeo = null;
function dyGeo() { return (_dyGeo = _dyGeo || (window.VibeEngine ? window.VibeEngine.buildGeo() : null)); }

/* ───────── readings + regular-schedule lookups (used to drop catch-ups that are no longer needed) ───────── */
// normalized equipment name -> { 'YYYY-MM-DD': { teams:Set, insp:{team:name} } }, rebuilt only when READINGS changes
let _dyRdMemo = null;
function dyReadIndex() {
  const rd = (typeof dsReadingsArr === 'function' ? dsReadingsArr() : []) || [];
  if (_dyRdMemo && _dyRdMemo.ref === rd && _dyRdMemo.len === rd.length) return _dyRdMemo.map;
  const map = {};
  rd.forEach(r => {
    if (!r || !r.equipment || !r.date) return;
    const k = normalizeEquipName(r.equipment), ds = String(r.date).slice(0, 10);
    const e = (map[k] = map[k] || {});
    const x = (e[ds] = e[ds] || { teams: new Set(), insp: {} });
    const t = dsReaderTeam(r);
    x.teams.add(t);
    if (!x.insp[t]) x.insp[t] = r.inspector || r.username || '';
  });
  _dyRdMemo = { ref: rd, len: rd.length, map };
  return map;
}
// was this equipment read (by anyone) on a date in [fromDs, toDsExclusive)?
function dyReadBetween(equip, fromDs, toDsExclusive) {
  const e = dyReadIndex()[normalizeEquipName(equip)];
  if (!e) return false;
  return Object.keys(e).some(ds => ds >= fromDs && ds < toDsExclusive);
}
function dyReadingOn(equip, ds) {
  const e = dyReadIndex()[normalizeEquipName(equip)];
  return (e && e[ds]) ? Object.assign({ date: ds }, e[ds]) : null;
}
// date -> Map(normalized equipment -> Set(groups)) of the REGULAR schedule. A catch-up is never put on a day the same equipment is already
// on someone's regular list: one reading that day cannot be two readings, and it would only show up as a pending duplicate.
const _dyNatEqMemo = {};
function dyNativeTeamsOn(ds, equip) {
  const y = parseInt(ds.slice(0, 4), 10), m = parseInt(ds.slice(5, 7), 10) - 1;
  const S = dsScheduleFor(y, m), key = y + '-' + m;
  if (!_dyNatEqMemo[key] || _dyNatEqMemo[key].S !== S || _dyNatEqMemo[key].v !== dsVersionFor(y, m)) {
    const wds = dsWorkingDaysOfMonth(y, m), map = {};
    Object.keys(S).forEach(team => wds.forEach((dt, i) => {
      ((S[team] && S[team][String(i + 1)]) || []).forEach(it => {
        if (!it || !it.n) return;
        const d = (map[dsFmt(dt)] = map[dsFmt(dt)] || new Map()), k = normalizeEquipName(it.n);
        (d.get(k) || d.set(k, new Set()).get(k)).add(team);
      });
    }));
    _dyNatEqMemo[key] = { S, v: dsVersionFor(y, m), map };
  }
  const d = _dyNatEqMemo[key].map[ds];
  return (d && d.get(normalizeEquipName(equip))) || new Set();
}
// 'YYYY-MM-DD|Team' -> Set(location) of everything on that group's regular schedule that day
const _dyNatMemo = {};
function dyNativeLocMap(y, m) {
  const S = dsScheduleFor(y, m), key = y + '-' + m;
  if (_dyNatMemo[key] && _dyNatMemo[key].S === S && _dyNatMemo[key].v === dsVersionFor(y, m)) return _dyNatMemo[key].map;
  const wds = dsWorkingDaysOfMonth(y, m), map = {};
  Object.keys(S).forEach(team => wds.forEach((dt, i) => {
    ((S[team] && S[team][String(i + 1)]) || []).forEach(it => {
      if (!it || !it.n) return;
      const l = it.l || (typeof dsScheduleInfo === 'function' ? dsScheduleInfo(it.n).l : '') || '';
      const k = dsFmt(dt) + '|' + team;
      (map[k] = map[k] || new Set()).add(l);
    });
  }));
  _dyNatMemo[key] = { S, v: dsVersionFor(y, m), map };
  return map;
}
// The catch-up (if any) that is still waiting on / chasing a regular visit — so that visit can carry a "Catch-up" label while it is still unread.
function dyPendingCatchupFor(y, m, team, wd, equipment) {
  const rows = (DY_CACHE[dyCacheKey(y, m)] || {}).rows || [];
  const k = normalizeEquipName(equipment), t0 = new Date();
  t0.setHours(0, 0, 0, 0);
  const ts = dsFmt(t0);
  return rows.find(r => r.status === 'active' && String(r.original_day) === String(wd) && normalizeEquipName(r.equipment) === k &&
    (team === 'ALL' || r.original_team === team) && (function (o) { return o.k === 'pending' || o.k === 'failed'; })(dyOutcome(r, ts))) || null;
}
const _d10 = v => String(v).slice(0, 10);
function _dayDiff(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }
// How did this catch-up end up? { k: 'pending' | 'failed' | 'notneeded' | 'credited', ... }
// Every scheduled visit is owed its OWN reading (a fortnightly machine = two readings a month); dsOccurrenceStates matches readings to
// visits (a late reading fills a missed earlier visit), so the catch-up simply follows the state of the visit it was created for:
//  pending   – the catch-up day has not passed and the visit is still unfilled
//  failed    – the catch-up day passed and the visit is STILL unfilled  -> it gets re-scheduled
//  notneeded – the visit was filled on time / early, or by a reading that pre-dates the catch-up
//  credited  – filled by a later reading while the catch-up existed: when = 'before' | 'day' | 'after' the catch-up day
function dyOutcome(r, todayStr) {
  const od = _d10(r.original_date), ad = _d10(r.assigned_date);
  const created = r.created_at ? dsFmt(new Date(r.created_at)) : od;
  const mm = String(r.month || od).slice(0, 7);
  const st = (dyStatesFor(parseInt(mm.slice(0, 4), 10), parseInt(mm.slice(5, 7), 10) - 1)[r.original_team] || {})[r.original_day + '|' + r.equipment];
  if (!st || !st.date) return { k: ad < todayStr ? 'failed' : 'pending' };
  const sd = _d10(st.date);
  if (sd <= od || sd < created) return { k: 'notneeded' };
  const ro = dyReadingOn(r.equipment, sd) || { teams: new Set(), insp: {} };
  const readers = Array.from(ro.teams);
  return { k: 'credited', when: sd < ad ? 'before' : (sd === ad ? 'day' : 'after'), date: sd, by: st.by || '', own: st.state === 'own', readers,
    insp: st.insp || ro.insp[Object.keys(ro.insp)[0]] || '', delta: _dayDiff(od, sd) };
}
// Signature of the loaded catch-up rows for a month — dsOccurrenceStates' cache must notice when they change.
function dyCuSig(y, m) {
  const c = DY_CACHE[y + '-' + m];
  return c ? c.rows.length + ':' + c.rows.reduce((a, r) => a + (r.status === 'active' ? 1 : 0), 0) : '';
}
// Called by dsOccurrenceStates: a visit that was missed and later filled while a catch-up existed for it is flagged cu:true, so the day
// table can print "Catch-up" under it (the visit itself is already counted as done by the matching).
function dyAugmentStates(out, y, m, uptoStr) {
  const c = DY_CACHE[y + '-' + m];
  if (!c || !c.rows.length) return;
  c.rows.forEach(r => {
    if (r.status === 'undone' && !String(r.undone_by || '').startsWith('auto')) return;   // an admin's own Undo — not a catch-up any more
    const s = (out[r.original_team] || {})[r.original_day + '|' + r.equipment];
    if (!s || !s.date) return;
    const created = r.created_at ? dsFmt(new Date(r.created_at)) : _d10(r.original_date);
    if (_d10(s.date) > _d10(r.original_date) && _d10(s.date) >= created) s.cu = true;
  });
}

// Visit states (done / covered by another group) for a month, cached for a couple of seconds — the day table asks once per catch-up row.
let _dyStMemo = null;
function dyStatesFor(y, m) {
  const rd = (typeof dsReadingsArr === 'function' ? dsReadingsArr() : []) || [];
  const sig = [y, m, rd.length, dsVersionFor(y, m), dyCuSig(y, m)].join('|');
  if (_dyStMemo && _dyStMemo.sig === sig && Date.now() - _dyStMemo.t < 2000) return _dyStMemo.val;
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const val = dsOccurrenceStates(y, m, dsFmt(t0));
  _dyStMemo = { sig, t: Date.now(), val };
  return val;
}
// A catch-up that no longer has a job to do. Returns 'done' | 'same-day' | false.
//  done     – the visit it was created for has been filled (by any group, even a day EARLY or late-but-before) before the catch-up day
//  same-day – the same group has this equipment on its regular list on the catch-up day: one reading cannot be two
function dyCatchupObsolete(c) {
  const ad = String(c.assigned_date).slice(0, 10), od = String(c.original_date).slice(0, 10);
  const mm = String(c.month || c.original_date).slice(0, 7);
  const st = (dyStatesFor(parseInt(mm.slice(0, 4), 10), parseInt(mm.slice(5, 7), 10) - 1)[c.original_team] || {})[c.original_day + '|' + c.equipment];
  if (st && st.date && String(st.date).slice(0, 10) < ad) return 'done';
  if (dyNativeTeamsOn(ad, c.equipment).has(c.assigned_team)) return 'same-day';
  return false;
}
// Status of a catch-up row: the original visit's state if a reading fulfilled it, otherwise a reading taken on the catch-up day itself.
function dyCatchupState(c, allStates) {
  const os = ((allStates || {})[c.original_team] || {})[c.original_day + '|' + c.equipment];
  if (os) return os;
  const ro = dyReadingOn(c.equipment, String(c.assigned_date).slice(0, 10));
  if (!ro) return null;
  const own = ro.teams.has(c.assigned_team) || ro.teams.has('');
  const by = own ? (ro.teams.has(c.assigned_team) ? c.assigned_team : '') : (Array.from(ro.teams).find(t => t) || '');
  return { state: own ? 'own' : 'other', date: ro.date, by, insp: ro.insp[by] || ro.insp[Object.keys(ro.insp)[0]] || '', delta: 0 };
}

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
// Next regular visit of this equipment after working day `wd` — by ANY group (team arg kept for callers, unused).
function dyNextOccurrenceDate(S, team, equipment, wd, y, m) {
  const wds = dsWorkingDaysOfMonth(y, m), k = normalizeEquipName(equipment);
  for (let i = wd; i < wds.length; i++) {
    const hit = Object.keys(S).some(t => ((S[t] && S[t][String(i + 1)]) || []).some(it => it && it.n && normalizeEquipName(it.n) === k));
    if (hit) return wds[i];
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
  // catch-ups already booked on each day: the same equipment is never caught up twice on one day, and a date may
  // carry catch-ups for at most DY_MAX_CU_LOCS different locations (all groups together).
  // (Catch-ups MAY sit next to the same equipment's own regular visit — that is the piggy-back that saves movement.)
  const bookedOn = {}, cuLocsOn = {}, cuLocsTeam = {};
  const book = (ds, equip, loc, team) => {
    (bookedOn[ds] = bookedOn[ds] || new Set()).add(normalizeEquipName(equip));
    (cuLocsOn[ds] = cuLocsOn[ds] || new Set()).add(loc || '');
    (cuLocsTeam[ds + '|' + team] = cuLocsTeam[ds + '|' + team] || new Set()).add(loc || '');
  };
  (existingRows || []).forEach(r => {
    if (r.status !== 'active') return;
    const k = ensure(r.assigned_team, r.assigned_date);
    const had = locs[k].has(r.location || '');
    locs[k].set(r.location || '', (locs[k].get(r.location || '') || 0) + 1); load[k]++;
    if (!had) extra[k]++;
    book(String(r.assigned_date).slice(0, 10), r.equipment, r.location, r.assigned_team);
  });
  const freeFor = (dt, equip) => !(bookedOn[dsFmt(dt)] && bookedOn[dsFmt(dt)].has(normalizeEquipName(equip))) && dyNativeTeamsOn(dsFmt(dt), equip).size === 0;
  // working days: a date carries at most DY_MAX_CU_LOCS different catch-up locations (all groups together).
  // reserve days: nobody has regular work, so the limit is per GROUP (each group's day stays within DY_MAX_CU_LOCS_RESERVE locations).
  const locOk = (ds, loc, team) => {
    if (reserveSet.has(ds)) { const s = cuLocsTeam[ds + '|' + team]; return !s || s.has(loc || '') || s.size < DY_MAX_CU_LOCS_RESERVE; }
    return !cuLocsOn[ds] || cuLocsOn[ds].has(loc || '') || cuLocsOn[ds].size < DY_MAX_CU_LOCS;
  };
  const todayDt = new Date(); todayDt.setHours(0, 0, 0, 0);

  // Location slots (at most DY_MAX_CU_LOCS different locations per date) are what runs out first, so the order matters:
  // Alarm / Alert / Critical machines first (criticality outranks everything), then the locations with the MOST waiting
  // equipment — one slot spent on a location with 12 machines covers 12 visits, on one with a single machine just 1.
  // Machines of one location are placed one after another, so they ride along together on the same day.
  const waiting = {};
  misses.forEach(x => { waiting[x.location || ''] = (waiting[x.location || ''] || 0) + 1; });
  const ordered = misses.slice().sort((a, b) => (b.sevRank - a.sevRank) || (waiting[b.location || ''] - waiting[a.location || '']) ||
    String(a.location || '').localeCompare(String(b.location || '')) || (b.overdueDays - a.overdueDays) || String(a.equipment).localeCompare(String(b.equipment)));

  const placements = [];
  ordered.forEach(miss => {
    const origDt = new Date(miss.date + 'T00:00:00');
    const nextOcc = dyNextOccurrenceDate(S, miss.team, miss.equipment, miss.wd, y, m);   // its next REGULAR visit (any group), if any
    // Every scheduled visit is owed its own reading (a fortnightly machine = two readings a month), so a missed visit is caught up
    // whenever its next regular visit falls — but kept well apart from that visit.
    const interval = nextOcc ? Math.round((nextOcc - origDt) / 86400000) : 0;
    const minGap = nextOcc ? Math.max(1, Math.min(DY_MIN_GAP_DAYS, Math.floor(interval / 2))) : 0;
    const gapOf = d => nextOcc ? Math.abs(Math.round((d - nextOcc) / 86400000)) : 99;
    const candidates = wds.filter(d => d >= todayDt && d > origDt && freeFor(d, miss.equipment));
    if (!candidates.length) return;
    const isRes = d => reserveSet.has(dsFmt(d));
    const work = candidates.filter(d => !isRes(d)), res = candidates.filter(isRes);
    const spaced = arr => arr.filter(d => gapOf(d) >= minGap);
    // opening a NEW location on a working day only pays for a real cluster (or an Alarm+ machine) — never for one or two machines
    const worthTrip = miss.sevRank >= 1 || (waiting[miss.location || ''] || 0) >= DY_ADDON_MIN_CLUSTER;

    // piggy-back (no extra walking): earliest day any group is already at this location (the lightest group that day)
    const piggy = days => {
      for (const dt of days) {
        const ds = dsFmt(dt); let pick = null;
        for (const team of teams) {
          const k = team + '|' + ds;
          if ((load[k] || 0) >= DY_DAY_CAP) continue;
          if (locs[k] && locs[k].has(miss.location) && locOk(ds, miss.location, team) && (!pick || load[k] < pick.load)) pick = { team, load: load[k] };
        }
        if (pick) return { dt, team: pick.team, source: 'piggyback' };
      }
      return null;
    };
    // add-on: a day where a group is working NEAR this location (at most +2 new locations that day)
    const addon = days => {
      let sc = null;
      for (const dt of days) {
        const ds = dsFmt(dt);
        for (const team of teams) {
          const k = team + '|' + ds;
          if ((load[k] || 0) >= DY_DAY_CAP || (extra[k] || 0) >= DY_MAX_EXTRA || !locOk(ds, miss.location, team)) continue;
          const dayLocs = locs[k]; if (!dayLocs || !dayLocs.size) continue;
          let dmin = 9; dayLocs.forEach((_, l) => { dmin = Math.min(dmin, geo.dist(miss.location, l)); });
          if (dmin > DY_NEAR_THR) continue;
          const score = dmin * 10 + (dt - origDt) / 86400000 * 0.3 + (load[k] || 0) * 0.02;
          if (!sc || score < sc.score) sc = { dt, team, source: 'addon', score };
        }
      }
      return sc;
    };
    // reserve day: the group already at (or nearest to) this location, the lightest day, and the widest gap from the next regular visit
    const reserve = days => {
      let sc = null;
      days.forEach(dt => {
        const ds = dsFmt(dt);
        teams.forEach(team => {
          const k = team + '|' + ds;
          if ((load[k] || 0) >= DY_DAY_CAP || !locOk(ds, miss.location, team)) return;
          const dayLocs = locs[k];
          let c = 1;
          if (dayLocs && dayLocs.has(miss.location)) c = 0;
          else if (dayLocs && dayLocs.size) { let dm = 9; dayLocs.forEach((_, l) => { dm = Math.min(dm, geo.dist(miss.location, l)); }); c = 1 + dm; }
          const score = c * 3 + (load[k] || 0) * 0.01 - Math.min(gapOf(dt), 30) * 0.05;
          if (!sc || score < sc.score) sc = { dt, team, source: 'reserve', score };
        });
      });
      return sc;
    };

    // Order of preference:
    //  1) a working day, well spaced from the next regular visit: ride along where a group already is, else (only if worth it) a near add-on
    //  2) a reserve day (well spaced first) — better than squeezing in right next to the regular visit or opening a lone new location
    //  3) last resorts on working days: a free ride-along even though close to the regular visit, then a near add-on
    let best = piggy(spaced(work)) || (worthTrip ? addon(spaced(work)) : null) || reserve(spaced(res)) || reserve(res) || piggy(work) || (worthTrip ? addon(work) : null);

    // Rules would leave an Alarm / Alert / Critical machine unplaced: its criticality outranks the day / location limits.
    if (!best && miss.sevRank >= 1) {
      const slack = DY_DAY_CAP + 10;
      for (const dt of candidates) {          // still prefer a day a group is already at that location
        const ds = dsFmt(dt); let pick = null;
        for (const team of teams) { const k = team + '|' + ds; if ((load[k] || 0) < slack && locs[k] && locs[k].has(miss.location) && (!pick || load[k] < pick.load)) pick = { team, load: load[k] }; }
        if (pick) { best = { dt, team: pick.team, source: 'piggyback' }; break; }
      }
      if (!best) {                            // otherwise the nearest location, any distance, widest gap then earliest day
        let sc = null;
        candidates.forEach(dt => {
          const ds = dsFmt(dt);
          teams.forEach(team => {
            const k = team + '|' + ds;
            if ((load[k] || 0) >= slack) return;
            let dmin = 9; if (locs[k] && locs[k].size) locs[k].forEach((_, l) => { dmin = Math.min(dmin, geo.dist(miss.location, l)); });
            const score = dmin * 10 + (dt - origDt) / 86400000 * 0.3 + (load[k] || 0) * 0.02 - Math.min(gapOf(dt), 30) * 0.05;
            if (!sc || score < sc.score) sc = { dt, team, source: reserveSet.has(ds) ? 'reserve' : 'addon', score };
          });
        });
        best = sc;
      }
    }
    if (!best) return;   // genuinely no room left this month

    const ds = dsFmt(best.dt), k = ensure(best.team, ds);
    const had = locs[k].has(miss.location);
    locs[k].set(miss.location, (locs[k].get(miss.location) || 0) + 1); load[k]++;
    if (!had) extra[k]++;
    book(ds, miss.equipment, miss.location, best.team);
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
// Catch-ups to SHOW on a day: active, still needed (see dyCatchupObsolete), and each equipment at most once.
function dyActiveFor(y, m, team, dateStr) {
  const rows = (DY_CACHE[dyCacheKey(y, m)] && DY_CACHE[dyCacheKey(y, m)].rows) || [];
  const seen = new Set(), out = [];
  rows.forEach(r => {
    if (r.status !== 'active' || String(r.assigned_date).slice(0, 10) !== dateStr) return;
    if (team !== 'ALL' && r.assigned_team !== team) return;
    if (dyCatchupObsolete(r)) return;
    const k = normalizeEquipName(r.equipment);
    if (seen.has(k)) return;
    seen.add(k); out.push(r);
  });
  return out;
}

async function dyRecompute(y, m) {
  if (!window.VibeEngine) { console.warn('dyRecompute: schedule engine not loaded'); return null; }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr = dsFmt(today);
  const monthStart = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  let existing = [];
  try {
    const { data, error } = await _supabase.from('catchup_assignments').select('*').eq('month', monthStart);
    if (error) throw error;
    existing = data || [];
  } catch (e) { console.warn('dyRecompute: could not read catchup_assignments:', e.message); return null; }
  const db = () => _supabase.from('catchup_assignments');
  const markUndone = async (rows, why) => {
    if (!rows.length) return 0;
    try {
      const { error } = await db().update({ status: 'undone', undone_by: why, undone_at: new Date().toISOString() }).in('id', rows.map(r => r.id));
      if (error) throw error;
      const gone = new Set(rows.map(r => r.id));
      existing = existing.map(r => gone.has(r.id) ? Object.assign({}, r, { status: 'undone', undone_by: why }) : r);
      return rows.length;
    } catch (e) { console.warn('dyRecompute: could not retire catch-ups (' + why + '):', e.message); return 0; }
  };

  // 1 — retire catch-ups that are no longer needed (equipment already read), which frees those slots for equipment still pending
  const retired = await markUndone(existing.filter(r => r.status === 'active' && dyCatchupObsolete(r)), 'auto (no longer needed)');

  // 2 — plan in memory until it settles (a pass can free room that another pass uses), then write only the difference.
  //     Per pass, these existing catch-ups from today on are RE-PLANNED:
  //     (a) add-on / reserve ones that could now ride along on a day some group is already at that location (less movement)
  //     (b) those on a date carrying more than DY_MAX_CU_LOCS different locations — the least-used locations are dropped
  //     An admin's own Undo is respected; an automatic retirement is not (the miss may need a new day).
  const key = (t, d, e) => t + '|' + d + '|' + e;
  const keyOf = r => key(r.original_team, r.original_day, r.equipment);
  const orig = new Map(existing.map(r => [keyOf(r), Object.assign({}, r)]));
  const state = existing.map(r => Object.assign({}, r));
  const misses = dyBuildMisses(y, m, today);
  const lastReadMap = (typeof buildLastReadingMap === 'function') ? buildLastReadingMap() : {};
  const sevOf = r => DY_SEV_RANK[(lastReadMap[r.equipment] && lastReadMap[r.equipment].severity) || 'NORMAL'] || 0;
  const rowOf = k => state.find(r => keyOf(r) === k);
  let lastUnplaced = 0; const rescheduledKeys = new Set();
  for (let pass = 0; pass < 4; pass++) {
    const live = state.filter(r => r.status === 'active' && String(r.assigned_date).slice(0, 10) >= todayStr);
    const capDrop = new Set(), byDate = {};
    live.forEach(r => { const d = String(r.assigned_date).slice(0, 10), l = r.location || ''; ((byDate[d] = byDate[d] || {})[l] = byDate[d][l] || []).push(r); });
    const reserveStr = new Set(dyReserveDays(y, m).map(dsFmt));
    Object.keys(byDate).forEach(d => {
      const ls = Object.keys(byDate[d]);
      if (ls.length <= DY_MAX_CU_LOCS || reserveStr.has(d)) return;
      const top = l => Math.max.apply(null, byDate[d][l].map(sevOf));
      ls.sort((a, b) => (top(b) - top(a)) || (byDate[d][b].length - byDate[d][a].length));   // critical locations keep their place
      ls.slice(DY_MAX_CU_LOCS).forEach(l => byDate[d][l].forEach(r => { if (sevOf(r) < 1) capDrop.add(keyOf(r)); }));
    });
    // catch-ups whose day has passed with the equipment STILL unread are re-scheduled to the next suitable day (same rules)
    const failedKeys = state.filter(r => r.status === 'active' && String(r.assigned_date).slice(0, 10) < todayStr && dyOutcome(r, todayStr).k === 'failed').map(keyOf);
    // everything still ahead of us is re-planned from scratch each pass — except today and tomorrow, which the groups are already
    // working to (frozen). That is what lets a location with many waiting machines take a slot from one with a single machine.
    const tm = new Date(today); tm.setDate(tm.getDate() + 1); const freezeStr = dsFmt(tm);
    const reevalKeys = new Set(live.filter(r => String(r.assigned_date).slice(0, 10) > freezeStr || capDrop.has(keyOf(r))).map(keyOf).concat(failedKeys));
    const manualUndone = state.filter(r => r.status === 'undone' && !String(r.undone_by || '').startsWith('auto')).map(keyOf);
    const blocked = new Set(state.filter(r => r.status === 'active' && !reevalKeys.has(keyOf(r))).map(keyOf).concat(manualUndone));
    const toPlace = misses.filter(x => !blocked.has(key(x.team, x.wd, x.equipment)));
    const replanKeys = new Set(toPlace.map(x => key(x.team, x.wd, x.equipment)).filter(k => reevalKeys.has(k)));
    const kept = state.filter(r => r.status === 'active' && !replanKeys.has(keyOf(r)));
    const placements = toPlace.length ? dyPlan(y, m, toPlace, kept) : [];
    lastUnplaced = toPlace.length - placements.length;
    let changed = false;
    const placedKeys = new Set();
    placements.forEach(p => {
      const k = keyOf(p); placedKeys.add(k);
      const row = rowOf(k);
      if (row) {
        if (row.status === 'active' && row.assigned_team === p.assigned_team && String(row.assigned_date).slice(0, 10) === p.assigned_date) return;
        if (row.status === 'active' && String(row.assigned_date).slice(0, 10) < todayStr) rescheduledKeys.add(k);
        Object.assign(row, { assigned_team: p.assigned_team, assigned_date: p.assigned_date, source: p.source, location: p.location, status: 'active', undone_by: null, undone_at: null });
      } else state.push(Object.assign({}, p, { status: 'active', undone_by: null, undone_at: null }));
      changed = true;
    });
    // a re-planned catch-up that found no room this time (a bigger location took its slot, or the rules no longer chase it): retire it
    state.forEach(r => {
      const k = keyOf(r);
      if (r.status === 'active' && replanKeys.has(k) && !placedKeys.has(k)) { r.status = 'undone'; r.undone_by = 'auto (re-planned — no room)'; changed = true; }
    });
    if (!changed) break;
  }

  // 3 — write the difference
  let placed = 0, moved = 0, dropped = 0, rescheduled = 0;
  const upserts = [], toUndo = [];
  state.forEach(r => {
    const o = orig.get(keyOf(r));
    if (r.status === 'active') {
      if (!o) { placed++; upserts.push(r); }
      else if (o.status !== 'active') { placed++; upserts.push(r); }
      else if (o.assigned_team !== r.assigned_team || String(o.assigned_date).slice(0, 10) !== String(r.assigned_date).slice(0, 10) || o.source !== r.source) { if (rescheduledKeys.has(keyOf(r))) rescheduled++; else moved++; upserts.push(r); }
    } else if (o && o.status === 'active') { dropped++; toUndo.push(r); }
  });
  dropped = await markUndone(toUndo, 'auto (re-planned — no room)') ? dropped : 0;
  if (upserts.length) {
    const who = (typeof AUTH !== 'undefined' && (AUTH.name || AUTH.displayName || AUTH.username)) || 'system';
    const cols = ['month', 'equipment', 'location', 'original_team', 'original_day', 'original_date', 'assigned_team', 'assigned_date', 'source'];
    const rows = upserts.map(r => { const o = {}; cols.forEach(c => { o[c] = r[c]; }); o.created_by = who; o.status = 'active'; o.undone_by = null; o.undone_at = null; return o; });
    try {
      // upsert on the table's unique key, so a miss that was retired earlier (or is being moved) takes its new day in place
      const { error } = await db().upsert(rows, { onConflict: 'month,original_team,original_day,equipment' });
      if (error) throw error;
    } catch (e) { console.warn('dyRecompute: failed to save assignments:', e.message); return null; }
  }
  return { placed, moved, rescheduled, retired: retired + dropped, unplaced: Math.max(0, lastUnplaced) };
}
// Runs once per admin per calendar day, automatically, for the current month.
async function dyAutoRunIfDue() {
  if (typeof AUTH === 'undefined' || AUTH.role !== 'admin') return;
  const today = new Date();
  const key = DY_RUN_KEY + ':' + dsFmt(today);
  try { if (localStorage.getItem(key)) return; } catch (e) {}
  try { localStorage.setItem(key, '1'); } catch (e) {}   // set first — never retry-loop on a failure
  const res = await dyRecompute(today.getFullYear(), today.getMonth());
  if (res && (res.placed || res.moved || res.rescheduled || res.retired)) {
    try { showToast('🔁 Catch-ups updated: ' + (res.placed || 0) + ' assigned' + (res.moved ? ', ' + res.moved + ' moved' : '') + (res.rescheduled ? ', ' + res.rescheduled + ' re-scheduled (still unread)' : '') + (res.retired ? ', ' + res.retired + ' removed' : ''), 'blue'); } catch (e) {}
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
    else showToast((res.placed ? `🔁 ${res.placed} new catch-up${res.placed > 1 ? 's' : ''} assigned` : 'No new catch-ups needed') + (res.moved ? ` · ${res.moved} moved to cut walking` : '') + (res.rescheduled ? ` · ${res.rescheduled} re-scheduled (still unread)` : '') + (res.retired ? ` · ${res.retired} removed` : ''), 'blue');
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
  const rows = ((DY_CACHE[dyCacheKey(DS_VIEW.y, DS_VIEW.m)] || {}).rows || []).filter(r => r.status === 'active' && !dyCatchupObsolete(r));
  el.textContent = rows.length ? ' (' + rows.length + ' active)' : '';
}
