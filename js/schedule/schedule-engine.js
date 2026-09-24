/* VibeMon — schedule engine for the Schedule Manager (frequency rules -> next month's schedule).
   Pure logic, no DOM. Same optimiser as schedule-simulation/engine.js (that file also contains the disruption simulator).
   Exposes window.VibeEngine. */
(function (root) {
'use strict';

const TEAMS = ['Precise', 'CB', 'CBA'];
const TEAM_LABEL = { Precise: 'Precise', CB: 'Chaitanya Bharthi', CBA: 'Chaitanya Bharthi-A' };
// visits per month for each frequency code: W weekly, T every ~10 days, F fortnightly, M monthly
const ROUNDS_OF = { W: 4, T: 3, F: 2, M: 1 };
const FREQ_NAME = { W: 'Weekly', T: 'Every 10 days', F: 'Fortnightly', M: 'Monthly' };

// "PA FAN-1B LOP - A" -> "PA FAN LOP"; "ESP VACUUM PUMP-1A3" -> "ESP VACUUM PUMP"; used to change many equipment at once
function familyOf(name) {
  const m = String(name).toUpperCase().match(/^(.*?)[\s-]*\d/);
  let base = (m ? m[1] : String(name).toUpperCase()).trim().replace(/[\s-]+$/, '') || String(name).toUpperCase();
  if (/\bLOP\b/i.test(name) && !/\bLOP\b/.test(base)) base += ' LOP';
  return base;
}

/* ───────────────────────── Geography (ASSUMPTION — replace with the real map) ─────────────────────────
   Location codes look like plant zones: A/B/C = Unit 1 areas, D/E/F = Unit 2, G/H/I = Unit 3,
   J/K/L = Unit 4, A1-A3 = Unit 5, A4-A6 = Unit 6, plus common areas, coal handling and FGD.
   distance: same location 0 · same cluster 1 · same stage 2 · coal handling to anything 3 · other stage 4 */
const DEFAULT_GEO = {
  clusters: {
    U1: ['A', 'B', 'C'], U2: ['D', 'E', 'F'], U3: ['G', 'H', 'I'], U4: ['J', 'K', 'L'],
    COMMON1: ['M', 'N', 'O', 'P', 'Q'],
    COAL: ['S', 'T', 'V', 'W'],
    U5: ['A1', 'A2', 'A3', 'DC'], U6: ['A4', 'A5', 'A6'], COMMON2: ['R', 'Z'], FGD: ['X', 'Y']
  },
  stage: { U1: 1, U2: 1, U3: 1, U4: 1, COMMON1: 1, U5: 2, U6: 2, COMMON2: 2, FGD: 2, COAL: 0 }
};

function buildGeo(cfg) {
  cfg = cfg || DEFAULT_GEO;
  const clusterOf = {}, sweep = [];
  Object.keys(cfg.clusters).forEach(c => cfg.clusters[c].forEach(l => { clusterOf[l] = c; sweep.push(l); }));
  const sweepIdx = {}; sweep.forEach((l, i) => { sweepIdx[l] = i; });
  const cache = {};
  function dist(a, b) {
    if (a === b) return 0;
    const k = a < b ? a + '|' + b : b + '|' + a;
    if (cache[k] !== undefined) return cache[k];
    const ca = clusterOf[a], cb = clusterOf[b];
    let d;
    if (!ca || !cb) d = 4;
    else if (ca === cb) d = 1;
    else if (cfg.stage[ca] === 0 || cfg.stage[cb] === 0) d = 3;
    else if (cfg.stage[ca] === cfg.stage[cb]) d = 2;
    else d = 4;
    cache[k] = d; return d;
  }
  // shortest walking path through a set of locations (exact for <=7 locations, greedy above)
  function routeCost(locs) {
    const L = Array.from(locs);
    const n = L.length;
    if (n <= 1) return 0;
    if (n > 7) {
      const left = L.slice(); let cur = left.shift(), tot = 0;
      while (left.length) {
        let bi = 0, bd = 1e9;
        left.forEach((x, i) => { const d = dist(cur, x); if (d < bd) { bd = d; bi = i; } });
        tot += bd; cur = left.splice(bi, 1)[0];
      }
      return tot;
    }
    let best = 1e9;
    (function rec(cur, remaining, acc) {
      if (acc >= best) return;
      if (!remaining.length) { best = acc; return; }
      for (let i = 0; i < remaining.length; i++) {
        const nx = remaining[i];
        rec(nx, remaining.slice(0, i).concat(remaining.slice(i + 1)), acc + (cur === null ? 0 : dist(cur, nx)));   // free choice of start
      }
    })(null, L, 0);
    return best;
  }
  return { clusterOf, sweepIdx, dist, routeCost, clusterOfLoc: l => clusterOf[l] || l };
}

/* ───────────────────────── Plan model ───────────────────────── */
// rows: [team, day, equipment, freq(F/W/M), location]
function makePlan(rows, T) {
  const visits = rows.map((r, i) => ({ id: i, team: r[0], day: r[1], eq: r[2], freq: r[3], loc: r[4] }));
  return { visits, T: T || 23 };
}
function clonePlan(plan) { return { visits: plan.visits.map(v => Object.assign({}, v)), T: plan.T, meta: plan.meta }; }

function equipmentIndex(plan) {
  const map = new Map();
  plan.visits.forEach(v => {
    if (!map.has(v.eq)) map.set(v.eq, { eq: v.eq, loc: v.loc, freq: v.freq, visits: [] });
    map.get(v.eq).visits.push(v);
  });
  map.forEach(e => e.visits.sort((a, b) => a.day - b.day));
  return map;
}

// ESP vacuum pumps: weekly (4 visits) -> fortnightly (2 visits) on an EXISTING plan: keep the pair of visits
// whose spacing is closest to a fortnight; drop the other two.
function applyEspFortnightly(plan) {
  const out = clonePlan(plan);
  const idx = equipmentIndex(out);
  const drop = new Set();
  idx.forEach(e => {
    if (!/^ESP VACUUM PUMP/i.test(e.eq) || e.freq !== 'W' || e.visits.length < 3) return;
    let best = null;
    for (let i = 0; i < e.visits.length; i++) for (let j = i + 1; j < e.visits.length; j++) {
      const gap = e.visits[j].day - e.visits[i].day;
      const score = Math.abs(gap - 12);
      if (!best || score < best.score) best = { i, j, score };
    }
    e.visits.forEach((v, k) => { if (k !== best.i && k !== best.j) drop.add(v.id); else v.freq = 'F'; });
  });
  out.visits = out.visits.filter(v => !drop.has(v.id));
  out.visits.forEach((v, i) => { v.id = i; });
  return out;
}

// Generic version of the above for an EXISTING plan: for every equipment whose new frequency needs fewer visits,
// keep the visits that are spaced most evenly through the month and drop the rest (increases are ignored here).
function applyFrequencyReductions(plan, resolveFreq, W) {
  W = W || 26;
  const out = clonePlan(plan), idx = equipmentIndex(out), drop = new Set();
  idx.forEach(e => {
    const nf = resolveFreq(e.eq, e.freq);
    if (!nf || !ROUNDS_OF[nf]) return;
    const n = ROUNDS_OF[nf], m = e.visits.length;
    if (n >= m) return;
    let best = null;
    (function pick(start, chosen) {
      if (chosen.length === n) {
        const days = chosen.map(i => e.visits[i].day);
        let sc = 0; const ideal = W / n;
        for (let k = 0; k < n; k++) { const g = k + 1 < n ? days[k + 1] - days[k] : days[0] + W - days[n - 1]; sc += (g - ideal) * (g - ideal); }
        if (!best || sc < best.sc) best = { sc, chosen: chosen.slice() };
        return;
      }
      for (let i = start; i < m; i++) { chosen.push(i); pick(i + 1, chosen); chosen.pop(); }
    })(0, []);
    const keep = new Set(best.chosen);
    e.visits.forEach((v, k) => { if (keep.has(k)) v.freq = nf; else drop.add(v.id); });
  });
  out.visits = out.visits.filter(v => !drop.has(v.id));
  out.visits.forEach((v, i) => { v.id = i; });
  return out;
}

/* ───────────────────────── Template optimiser ─────────────────────────
   Rebuilds the monthly template so each team-day covers few, physically-near locations.
   - weekly equipment: 4 rounds ~6 working days apart
   - fortnightly     : 2 rounds ~11-12 working days apart
   - monthly         : anywhere (fills leftover capacity)
   Every location's equipment for a round is placed together (split only when a location is bigger than a day). */
function optimisePlan(rows, opts) {
  opts = opts || {};
  const geo = opts.geo || buildGeo();
  const T = opts.T || 23, cap = opts.packCap || 26, hardCap = opts.hardCap || (cap + 4);
  const eqs = new Map();
  rows.forEach(r => { if (!eqs.has(r[2])) eqs.set(r[2], { eq: r[2], loc: r[4], freq: r[3] }); });
  if (opts.espFortnightly) eqs.forEach(e => { if (e.freq === 'W' && /^ESP VACUUM PUMP/i.test(e.eq)) e.freq = 'F'; });
  // frequency rules chosen by the user: resolveFreq(equipmentName, currentCode) -> new code or falsy to keep
  if (opts.resolveFreq) eqs.forEach(e => { const f = opts.resolveFreq(e.eq, e.freq); if (f && ROUNDS_OF[f]) e.freq = f; });

  // slot table
  const slot = {};
  TEAMS.forEach(t => { for (let d = 1; d <= T; d++) slot[t + '|' + d] = { t, d, load: 0, locs: new Map() }; });
  const slotList = Object.values(slot);

  const ROUNDS = ROUNDS_OF;
  // parts waiting to be placed: {eqs:[names], loc, freq, round, prevDay}
  const parts = [];
  const byKindLoc = { W: new Map(), T: new Map(), F: new Map(), M: new Map() };
  eqs.forEach(e => {
    const m = byKindLoc[e.freq]; if (!m.has(e.loc)) m.set(e.loc, []);
    m.get(e.loc).push(e.eq);
  });
  Object.keys(byKindLoc).forEach(k => byKindLoc[k].forEach((list, loc) => parts.push({ eqs: list, loc, freq: k, round: 0, prevDay: null })));

  const placed = []; // final visits {team, day, eq, loc, freq}

  // spacing between rounds (working days) and the window of the first round, by visits per month
  const SPACING = { 4: [6, 7], 3: [8, 9], 2: [10, 13] };
  const FIRST_MAX = { 4: 4, 3: 6, 2: 11 };
  function windowFor(p) {
    const n = ROUNDS[p.freq];
    if (n === 1) return [1, T];
    if (p.round === 0) return [1, FIRST_MAX[n]];
    return [Math.min(p.prevDay + SPACING[n][0], T - 1), Math.min(p.prevDay + SPACING[n][1], T)];
  }
  function fullRange(p) {
    const n = ROUNDS[p.freq];
    if (n === 1) return [1, T];
    if (p.round === 0) return [1, FIRST_MAX[n] + 1];
    if (n === 2) return [Math.max(12, p.prevDay + 6), T];
    if (n === 3) return [Math.min(p.prevDay + 6, T), Math.min(p.prevDay + 11, T)];
    return [Math.min(p.prevDay + 4, T), Math.min(p.prevDay + 9, T)];
  }
  function bestSlot(loc, g, lo, hi, allowCap) {
    let best = null;
    for (let d = lo; d <= hi; d++) for (const t of TEAMS) {
      const s = slot[t + '|' + d];
      const free = allowCap - s.load;
      if (free <= 0) continue;
      const fit = Math.min(g, free);
      let c = 0;
      if (s.locs.has(loc)) c = 0;
      else {
        let dmin = 0;
        if (s.locs.size) { dmin = 9; s.locs.forEach((_, l) => { dmin = Math.min(dmin, geo.dist(loc, l)); }); }
        c = 1 + 0.7 * dmin + (s.locs.size >= 2 ? 1.2 : 0);
      }
      if (fit < g) c += 0.9;                                  // splitting a block costs extra
      if (fit < Math.min(g, 4)) c += 2;                       // tiny fragments are wasteful
      c += 0.6 * (s.load / cap);                              // gentle load balancing
      if (!best || c < best.c - 1e-9) best = { s, c, fit };
    }
    return best;
  }
  function placePart(p) {
    const [lo, hi] = windowFor(p);
    const [flo, fhi] = fullRange(p);
    let remaining = p.eqs.slice();
    while (remaining.length) {
      let b = bestSlot(p.loc, remaining.length, lo, hi, cap);
      if (!b) b = bestSlot(p.loc, remaining.length, flo, fhi, cap);
      if (!b) b = bestSlot(p.loc, remaining.length, 1, T, hardCap);
      if (!b) throw new Error('No capacity left for ' + p.loc + ' (' + remaining.length + ' items)');
      const take = remaining.splice(0, b.fit);
      b.s.load += take.length;
      b.s.locs.set(p.loc, (b.s.locs.get(p.loc) || 0) + take.length);
      take.forEach(eq => placed.push({ team: b.s.t, day: b.s.d, eq, loc: p.loc, freq: p.freq, round: p.round }));
      // next round of this chunk
      if (p.round + 1 < ROUNDS[p.freq]) next.push({ eqs: take, loc: p.loc, freq: p.freq, round: p.round + 1, prevDay: b.s.d });
    }
  }
  let next = [];
  // round-by-round, weekly first (narrowest windows), biggest blocks first
  const order = [['W', 0], ['W', 1], ['W', 2], ['W', 3], ['T', 0], ['T', 1], ['T', 2], ['F', 0], ['F', 1], ['M', 0]];
  let queue = parts.slice();
  const carried = { W: [], T: [], F: [], M: [] };
  order.forEach(([k, r]) => {
    let list = queue.filter(p => p.freq === k && p.round === r).concat(carried[k].filter(p => p.round === r));
    list.sort((a, b) => b.eqs.length - a.eqs.length || (geo.sweepIdx[a.loc] - geo.sweepIdx[b.loc]));
    next = [];
    list.forEach(placePart);
    next.forEach(p => carried[p.freq].push(p));
  });
  const rowsOut = placed.map(p => [p.team, p.day, p.eq, p.freq, p.loc]);
  const plan = makePlan(rowsOut, T);
  plan.meta = { optimised: true, espFortnightly: !!opts.espFortnightly, packCap: cap };
  return plan;
}

/* ───────────────────────── Static plan statistics ───────────────────────── */
function planStats(plan, geo) {
  geo = geo || buildGeo();
  const slots = new Map();
  plan.visits.forEach(v => {
    const k = v.team + '|' + v.day;
    if (!slots.has(k)) slots.set(k, { n: 0, locs: new Set() });
    const s = slots.get(k); s.n++; s.locs.add(v.loc);
  });
  let trips = 0, dist = 0, area = 0, peak = 0, small = 0;
  const locHist = {}, loads = [];
  slots.forEach(s => {
    trips += s.locs.size;
    dist += geo.routeCost(s.locs);
    area += Math.max(0, new Set(Array.from(s.locs).map(geo.clusterOfLoc)).size - 1);
    peak = Math.max(peak, s.n); loads.push(s.n);
    locHist[s.locs.size] = (locHist[s.locs.size] || 0) + 1;
  });
  plan.visits.forEach(() => {});
  // trips carrying <=4 readings
  const perTrip = new Map();
  plan.visits.forEach(v => { const k = v.team + '|' + v.day + '|' + v.loc; perTrip.set(k, (perTrip.get(k) || 0) + 1); });
  perTrip.forEach(n => { if (n <= 4) small++; });
  const idx = equipmentIndex(plan);
  const gaps = [];
  idx.forEach(e => { if (e.freq === 'F' && e.visits.length === 2) gaps.push(e.visits[1].day - e.visits[0].day); });
  return {
    visits: plan.visits.length, teamDays: slots.size, trips, distance: dist, areaChanges: area,
    locsPerDay: trips / slots.size, peakLoad: peak, avgLoad: plan.visits.length / slots.size,
    minLoad: Math.min.apply(null, loads), smallTrips: small, locHist,
    gapMin: gaps.length ? Math.min.apply(null, gaps) : 0, gapMax: gaps.length ? Math.max.apply(null, gaps) : 0,
    gapAvg: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0
  };
}


/* ───────────────────────── Minimal-change update ─────────────────────────
   Keeps today's layout and touches ONLY the equipment whose frequency changed:
   fewer visits -> keep the most evenly spaced ones;  more visits -> add them on the days that best fit
   (same location first, then a near-by location, spaced evenly through the month, respecting day capacity). */
function applyFrequencyChanges(plan, resolveFreq, opts) {
  opts = opts || {};
  const geo = opts.geo || buildGeo(), T = plan.T, W = opts.W || 26, cap = opts.packCap || 26, hardCap = cap + 4;
  const out = applyFrequencyReductions(plan, resolveFreq, W);
  const load = {}, locs = {};
  out.visits.forEach(v => { const k = v.team + '|' + v.day; load[k] = (load[k] || 0) + 1; const m = (locs[k] = locs[k] || new Map()); m.set(v.loc, (m.get(v.loc) || 0) + 1); });
  const idx = equipmentIndex(out), adds = [];
  idx.forEach(e => {
    const nf = resolveFreq(e.eq, e.freq);
    if (nf && ROUNDS_OF[nf] && ROUNDS_OF[nf] > e.visits.length) adds.push({ e, n: ROUNDS_OF[nf], nf });
  });
  adds.sort((a, b) => (b.n - b.e.visits.length) - (a.n - a.e.visits.length));
  adds.forEach(({ e, n, nf }) => {
    e.visits.forEach(v => { v.freq = nf; });
    while (e.visits.length < n) {
      const days = e.visits.map(v => v.day), ideal = W / n;
      let best = null;
      for (let d = 1; d <= T; d++) {
        if (days.indexOf(d) >= 0) continue;
        let sp = 99; days.forEach(x => { const g = Math.abs(d - x); sp = Math.min(sp, g, W - g); });
        for (const t of TEAMS) {
          const k = t + '|' + d, l = load[k] || 0;
          if (l >= hardCap) continue;
          const lm = locs[k];
          let c;
          if (lm && lm.has(e.loc)) c = 0;
          else { let dm = 0; if (lm && lm.size) { dm = 9; lm.forEach((_, x) => { dm = Math.min(dm, geo.dist(e.loc, x)); }); } c = 1 + 0.7 * dm + (lm && lm.size >= 2 ? 1.2 : 0); }
          c += 0.6 * (l / cap) + Math.abs(sp - ideal) * 0.5 + (sp < 3 ? 5 : 0);
          if (!best || c < best.c) best = { d, t, c };
        }
      }
      if (!best) break;
      const k = best.t + '|' + best.d;
      load[k] = (load[k] || 0) + 1;
      const m = (locs[k] = locs[k] || new Map()); m.set(e.loc, (m.get(e.loc) || 0) + 1);
      const nv = { id: out.visits.length, team: best.t, day: best.d, eq: e.eq, freq: nf, loc: e.loc };
      out.visits.push(nv); e.visits.push(nv); e.visits.sort((a, b) => a.day - b.day);
    }
  });
  out.visits.forEach((v, i) => { v.id = i; });
  out.meta = { adjusted: true };
  return out;
}

// Equipment whose number of visits differs between two plans, plus how many visits moved to another team/day.
function diffPlans(oldPlan, newPlan) {
  const a = equipmentIndex(oldPlan), b = equipmentIndex(newPlan), changed = [];
  b.forEach((nv, eq) => {
    const ov = a.get(eq);
    if (!ov) { changed.push({ eq, loc: nv.loc, from: 0, to: nv.visits.length, added: true }); return; }
    if (ov.visits.length !== nv.visits.length) changed.push({ eq, loc: nv.loc, from: ov.visits.length, to: nv.visits.length });
  });
  a.forEach((ov, eq) => { if (!b.has(eq)) changed.push({ eq, loc: ov.loc, from: ov.visits.length, to: 0, removed: true }); });
  const key = v => v.eq + '|' + v.team + '|' + v.day;
  const oldSet = new Set(oldPlan.visits.map(key));
  const kept = newPlan.visits.filter(v => oldSet.has(key(v))).length;
  return { changed, visitsKept: kept, visitsMoved: newPlan.visits.length - kept };
}

root.VibeEngine = {
  TEAMS, TEAM_LABEL, ROUNDS_OF, FREQ_NAME, familyOf, DEFAULT_GEO, buildGeo, makePlan, clonePlan, equipmentIndex,
  applyFrequencyReductions, applyFrequencyChanges, optimisePlan, planStats, diffPlans
};
})(typeof window !== 'undefined' ? window : globalThis);
