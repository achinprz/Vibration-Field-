/* VibeMon — entry guardrails: catch typing slips and doubtful entries BEFORE a reading is saved.
   Live hint under each value (step 2), a "Checks" box on the review step (step 4), and a final check when Save is pressed.
   Nothing here changes a reading — it only warns (OK = save anyway, Cancel = go back) or, for impossible values
   (not a number, negative, absurdly large), stops the save until the engineer fixes it. Remarks are never required. */

const EG = {
  // Above this a value is almost certainly a slipped decimal: the engineer must confirm it.
  PLAUSIBLE: { vel: 60,  acc: 25,  dis: 1000 },
  // Above this it is not a possible reading: the save is stopped.
  IMPOSSIBLE: { vel: 200, acc: 100, dis: 5000 },
  // A change smaller than this (in the unit of the value) is never called a "jump", however large the ratio.
  MIN_STEP: { vel: 1.5, acc: 0.3, dis: 15 },
  JUMP_RATIO: 3,        // new value >= 3 x the last reading
  SLIP_RATIO: 6,        // new value >= 6 x this point's usual (median) value, and a tenth of it fits the usual range
  MIN_HISTORY: 3        // readings of this point needed before "usual value" checks are used
};

function egType(key) { const k = String(key).toLowerCase(); return k.includes('acc') ? 'acc' : k.includes('dis') ? 'dis' : 'vel'; }
function egUnit(t) { return t === 'acc' ? 'g' : t === 'dis' ? 'µm' : 'mm/s'; }
function egLabel(key) { return String(key).replace(/_/g, ' '); }
function egFmt(n) { return String(Math.round(n * 100) / 100); }

// Earlier readings of one point / one parameter on this machine, newest first (same running condition: coupled vs decoupled).
function egHistory(equip, point, key, decoupled) {
  const out = [];
  (typeof READINGS !== 'undefined' ? READINGS : []).forEach(r => {
    if (r.equipment !== equip || r.point !== point || !!r.isDecoupled !== !!decoupled) return;
    const raw = r[key]; if (raw === '' || raw == null) return;
    const v = parseFloat(raw); if (!isFinite(v)) return;
    out.push({ v, date: r.date, ts: r.createdOn || '' });
  });
  out.sort((a, b) => (b.date + b.ts).localeCompare(a.date + a.ts));
  return out.slice(0, 12);
}
function egMedian(arr) { const s = arr.slice().sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

// Everything doubtful about one typed value. Each flag: { level: 'warn' | 'block', text }
function egCheckValue(equip, point, key, raw, decoupled) {
  const flags = [];
  if (raw === '' || raw == null) return flags;
  const v = parseFloat(raw);
  if (!isFinite(v)) { flags.push({ level: 'block', text: `"${raw}" is not a number` }); return flags; }
  const t = egType(key), u = egUnit(t);
  if (v < 0) { flags.push({ level: 'block', text: 'a vibration reading cannot be negative' }); return flags; }
  if (v > EG.IMPOSSIBLE[t]) { flags.push({ level: 'block', text: `${egFmt(v)} ${u} is not a possible reading — check the decimal point` }); return flags; }
  if (v > EG.PLAUSIBLE[t]) flags.push({ level: 'warn', text: `${egFmt(v)} ${u} is far above any normal range — check the decimal point` });
  if (v === 0) flags.push({ level: 'warn', text: 'zero reading — is the point reachable / the machine running?' });

  const h = egHistory(equip, point, key, decoupled);
  if (h.length) {
    const last = h[0], step = EG.MIN_STEP[t];
    let slip = false;
    if (h.length >= EG.MIN_HISTORY) {
      const m = egMedian(h.map(x => x.v));
      if (m > 0 && v / m >= EG.SLIP_RATIO && v - m >= step) {
        const tenth = v / 10;
        if (tenth / m >= 0.4 && tenth / m <= 2.5) { flags.push({ level: 'warn', text: `${egFmt(v)} is ${egFmt(v / m)}× this point's usual ${egFmt(m)} ${u} — did you mean ${egFmt(tenth)}?` }); slip = true; }
      }
    }
    if (!slip && last.v > 0 && v / last.v >= EG.JUMP_RATIO && v - last.v >= step) {
      flags.push({ level: 'warn', text: `${egFmt(v / last.v)}× the last reading (${egFmt(last.v)} ${u} on ${last.date})` });
    } else if (!slip && v > 0 && last.v >= step * 2 && last.v / v >= EG.JUMP_RATIO + 1) {
      const up = v * 10;
      flags.push({ level: 'warn', text: `much lower than the last reading (${egFmt(last.v)} ${u} on ${last.date})` + (up / last.v >= 0.5 && up / last.v <= 2 ? ` — did you mean ${egFmt(up)}?` : '') });
    }
  }
  return flags;
}

// ---- live hint under the input (step 2) ----
function egLive(pt, key) {
  if (typeof entryEquip === 'undefined' || !entryEquip) return;
  const el = document.getElementById(`inp_${safeId(pt)}_${key}`); if (!el) return;
  const row = el.closest('.param-row'); if (!row) return;
  const flags = egCheckValue(entryEquip.name, pt, key, el.value, isDecoupledMode());
  let hint = document.getElementById('eg_' + el.id);
  el.classList.toggle('eg-flag', flags.length > 0);
  if (!flags.length) { if (hint) hint.remove(); return; }
  if (!hint) { hint = document.createElement('div'); hint.id = 'eg_' + el.id; row.after(hint); }
  const block = flags.some(f => f.level === 'block');
  hint.className = 'eg-hint' + (block ? ' block' : '');
  hint.textContent = (block ? '⛔ ' : '⚠️ ') + flags.map(f => f.text).join(' · ');
}

// ---- the readings the engineer has typed so far, in the same shape saveSession() builds ----
function egCollect() {
  const e = entryEquip, out = [];
  if (!e) return out;
  e.points.forEach(pt => {
    const r = entryReadings[pt] || {}, values = {};
    let any = false;
    e.params.forEach(p => { const k = p.replace(/\s/g, '_'); values[k] = r[k] === undefined ? '' : r[k]; if (values[k] !== '') any = true; });
    if (any) out.push({ point: pt, values });
  });
  return out;
}

// All checks that need no network. Returns { block: [text], warn: [text] }.
function egCheckAll(isDecoupled, opts) {
  opts = opts || {};
  const e = entryEquip, res = { block: [], warn: [] };
  if (!e) return res;
  const rows = egCollect(), all = [];
  rows.forEach(row => {
    Object.keys(row.values).forEach(k => {
      const raw = row.values[k]; if (raw === '') return;
      const v = parseFloat(raw); if (isFinite(v)) all.push(v);
      egCheckValue(e.name, row.point, k, raw, isDecoupled).forEach(f => {
        (f.level === 'block' ? res.block : res.warn).push(`${row.point} · ${egLabel(k)}: ${f.text}`);
      });
    });
  });
  // every entered value identical — a copy/paste or a stuck keypad
  if (all.length >= 4 && all.every(v => v === all[0])) res.warn.push(`Every value you entered is the same (${egFmt(all[0])}) — please check`);
  // points / values left out
  if (!isDecoupled && rows.length && rows.length < e.points.length) {
    const have = new Set(rows.map(r => r.point));
    res.warn.push(`Only ${rows.length} of ${e.points.length} points entered — missing: ${e.points.filter(p => !have.has(p)).join(', ')}`);
  }
  const partial = rows.map(row => ({ point: row.point, miss: e.params.filter(p => row.values[p.replace(/\s/g, '_')] === '') })).filter(x => x.miss.length && x.miss.length < e.params.length);
  if (partial.length) res.warn.push('Blank values: ' + partial.map(x => `${x.point} (${x.miss.join(', ')})`).join('; '));
  // (no remark is ever required — changing the severity or leaving Remarks empty never stops or slows a save)
  return res;
}

// Readings of this machine already taken today, on the server or waiting on this phone.
async function egDuplicates(equipName, date) {
  const found = [];
  const seen = new Set();
  (typeof READINGS !== 'undefined' ? READINGS : []).forEach(r => {
    if (r.equipment !== equipName || r.date !== date || seen.has(r.reportId)) return;
    seen.add(r.reportId);
    found.push(`${r.inspector || r.username || 'someone'}${r.createdOn ? ' at ' + String(r.createdOn).slice(11, 16) : ''}`);
  });
  try {
    // (a waiting reading is also in READINGS for this session — count it once)
    if (typeof OfflineQ !== 'undefined') (await OfflineQ.pendingFor(equipName, date)).forEach(r => { if (!seen.has(r.id)) found.push(`${r.payload.inspector || 'this phone'} (waiting to upload)`); });
  } catch (e) {}
  return found;
}

// ---- final check when Save is pressed: returns true to go ahead ----
async function egSaveGate(date, remarks, isDecoupled) {
  const res = egCheckAll(isDecoupled, { remarks });
  if (res.block.length) {
    alert('⛔ Cannot save yet\n\n' + res.block.map(x => '• ' + x).join('\n') + '\n\nPlease correct it and press Save again.');
    return false;
  }
  const dups = await egDuplicates(entryEquip.name, date);
  if (dups.length) res.warn.unshift(`${entryEquip.name} already has ${dups.length === 1 ? 'a reading' : dups.length + ' readings'} for ${date}: ${dups.join('; ')}`);
  if (!res.warn.length) return true;
  return confirm('⚠️ Please check before saving\n\n' + res.warn.map(x => '• ' + x).join('\n') + '\n\nOK = save anyway     Cancel = go back and fix');
}

// ---- "Checks" box on the review step ----
async function egReviewBox() {
  const anchor = document.getElementById('s4-recs'); if (!anchor || !entryEquip) return;
  let box = document.getElementById('eg-review');
  if (!box) { box = document.createElement('div'); box.id = 'eg-review'; anchor.before(box); }
  const res = egCheckAll(isDecoupledMode());
  const dups = await egDuplicates(entryEquip.name, (document.getElementById('entry-date') || {}).value || _todayFmt());
  if (dups.length) res.warn.unshift(`Already read for this date: ${dups.join('; ')}`);
  if (!res.block.length && !res.warn.length) { box.className = 'eg-box ok'; box.innerHTML = '✅ Entry checks passed — no doubtful values found.'; return; }
  box.className = 'eg-box' + (res.block.length ? ' block' : '');
  box.innerHTML = '<div class="eg-box-title">' + (res.block.length ? '⛔ Fix before saving' : '⚠️ Please double-check') + '</div>' +
    res.block.map(x => `<div class="eg-line block">⛔ ${escHtml(x)}</div>`).join('') + res.warn.map(x => `<div class="eg-line">⚠️ ${escHtml(x)}</div>`).join('');
}
