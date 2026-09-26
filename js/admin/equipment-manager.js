/* VibeMon — Equipment Manager (admin): edit / rename / add equipment, tidy families, and keep the office SQL Server in step.
   • Edit: name, unit, area, dept, category/type, speed (rpm), measurement points, parameters, vibration limits, family.
   • Rename: one atomic database function (rename_equipment) changes the name in the equipment master, every reading,
     every schedule version, frequency rules and catch-ups. Nothing can be deleted from here.
   • Add: starts from a similar machine (clone), needs a frequency, then either joins THIS month at the last free days
     or starts NEXT month (same engine and rules the Schedule Manager uses).
   • Families: manual override stored in equipment_master.family (blank = derived from the name, as before); the
     Families tab suggests spelling variants that probably belong together — always confirmed by you, never automatic.
   • Office SQL: every change is logged in equipment_changes; the last tab turns the pending ones into a T-SQL script for
     the office VibeMonDB.  Database set-up: supabase/equipment_manager.sql (run once in the Supabase SQL Editor). */

const EM_FREQ = [
  { code: 'W', label: 'WEEKLY',        word: 'Weekly',        days: 7,  text: 'Weekly (4 / month)' },
  { code: 'T', label: 'EVERY 10 DAYS', word: 'Every 10 days', days: 10, text: 'Every 10 days (3 / month)' },
  { code: 'F', label: 'FORTNIGHTLY',   word: 'Fortnightly',   days: 15, text: 'Fortnightly (2 / month)' },
  { code: 'M', label: 'MONTHLY',       word: 'Monthly',       days: 30, text: 'Monthly (1 / month)' }
];
const EM_PARAMS = ['H Vel', 'V Vel', 'A Vel', 'Acc', 'H Dis', 'V Dis', 'A Dis'];
const EM_SQL_FIX = 'Run supabase/equipment_manager.sql once in the Supabase SQL Editor, then try again.';

const EM = {
  tab: 'edit', q: '', sel: '', draft: null, orig: null, applyFam: {},
  add: null, place: null, famQ: '', busy: false, msg: '', msgKind: 'info',
  changes: [], changesLoaded: false, changesErr: '', loaded: false
};

const emUser = () => (typeof AUTH !== 'undefined' && (AUTH.name || AUTH.displayName || AUTH.username)) || 'admin';
const emNorm = s => String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toUpperCase();
const emAlnum = s => emNorm(s).replace(/[^A-Z0-9]/g, '');
const emSqlStr = s => "N'" + String(s == null ? '' : s).replace(/'/g, "''") + "'";
const emPad = n => String(n).padStart(2, '0');
const emMonthFirst = (y, m) => `${y}-${emPad(m + 1)}-01`;
const emFmtDay = dt => dt ? dt.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : '?';
const emFreqOf = code => EM_FREQ.find(f => f.code === code) || EM_FREQ[2];
function emFreqCodeFromWord(w) {
  const u = String(w || '').toUpperCase();
  const f = EM_FREQ.find(x => x.label === u || x.word.toUpperCase() === u);
  return f ? f.code : (/WEEK/.test(u) ? 'W' : /10/.test(u) ? 'T' : /FORT/.test(u) ? 'F' : /MONTH/.test(u) ? 'M' : 'F');
}
function emErrText(e) {
  const c = (e && e.code) || '', msg = (e && e.message) || String(e);
  if (['42P01', 'PGRST205', '42703', 'PGRST204', 'PGRST202', '42883'].indexOf(c) >= 0 || /schema cache|does not exist|could not find/i.test(msg))
    return msg + '\n' + EM_SQL_FIX;
  return msg;
}

/* ───────────────────────── families ─────────────────────────
   The Schedule Manager asks window.VibeEngine.familyOf(name) — from here on that honours the manual family
   stored on the equipment master and otherwise falls back to the original name-based rule. */
const EM_BASE_FAMILY = (window.VibeEngine && window.VibeEngine.familyOf) ? window.VibeEngine.familyOf : (n => String(n).toUpperCase());
let _emFamSrc = null, _emFamMap = {};
function emFamilyMap() {
  if (_emFamSrc !== MASTER) {
    _emFamSrc = MASTER; _emFamMap = {};
    (MASTER || []).forEach(m => { const f = String(m.family || '').trim(); if (f) _emFamMap[emNorm(m.name)] = f.toUpperCase(); });
  }
  return _emFamMap;
}
function emFamilyOf(name) { return emFamilyMap()[emNorm(name)] || EM_BASE_FAMILY(name); }
if (window.VibeEngine) window.VibeEngine.familyOf = emFamilyOf;

function emFamilyGroups() {
  const g = {};
  (MASTER || []).forEach(m => { (g[emFamilyOf(m.name)] = g[emFamilyOf(m.name)] || []).push(m); });
  return g;
}
function emLev(a, b) {
  const d = [];
  for (let i = 0; i <= a.length; i++) { d[i] = [i]; }
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const emSpecKey = m => [(m.points || []).join('|'), (m.params || []).join('|'), JSON.stringify(normalizeLimits(m.limits) || {}), String(m.rpm || '')].join('#');

// Families that look like the same family spelt differently, grouped into ONE suggestion per cluster (so "ME WASH PUMP A/B/C/D"
// becomes a single "→ ME WASH PUMP" row). Deliberately strict: "PA FAN", "FD FAN" and "ID FAN" are different machines and are never suggested.
function emCommonPrefix(names) { let p = names[0]; names.forEach(n => { while (p && !n.startsWith(p)) p = p.slice(0, -1); }); return p; }
function emCleanTarget(p) {
  let s = p.replace(/[\s\-]+$/, '');
  const m = s.match(/^(.*?)[\s\-]+([A-Z]|[IVX]+)$/);     // drop a trailing lone letter / roman numeral: "STAKER - I" -> "STAKER"
  if (m && m[1].length >= 4) s = m[1].replace(/[\s\-]+$/, '');
  return s;
}
function emFamilySuggestions() {
  const g = emFamilyGroups(), names = Object.keys(g), pairs = [];
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const a = names[i], b = names[j], na = emAlnum(a), nb = emAlnum(b);
    let why = '', strength = 0;
    if (na === nb) { why = 'Identical apart from spaces / hyphens'; strength = 3; }
    else {
      const s = na.length <= nb.length ? na : nb, l = na.length <= nb.length ? nb : na, tail = l.slice(s.length);
      if (s.length >= 4 && l.startsWith(s) && /^[A-Z0-9]{1,2}$/.test(tail)) { why = 'Same name plus a short suffix'; strength = 2; }
      else if (na.length === nb.length && na.length >= 6 && na.slice(0, -1) === nb.slice(0, -1)) { why = 'Differ only in the last letter / number'; strength = 2; }
      // a one-character slip elsewhere ("SERVICS" / "SERVICE") is only suggested when one side is tiny: two big families that differ
      // by one character (FD FAN LOP / ID FAN LOP) are real, different machines
      else if (Math.min(na.length, nb.length) >= 8 && emLev(na, nb) === 1 && Math.min(g[a].length, g[b].length) <= 3) { why = 'Differ by a single character (typo?)'; strength = 1; }
    }
    if (strength) pairs.push({ a, b, why, strength });
  }
  const parent = {}; names.forEach(n => { parent[n] = n; });
  const find = x => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  pairs.forEach(p => { parent[find(p.a)] = find(p.b); });
  const clusters = {};
  pairs.forEach(p => { const r = find(p.a); (clusters[r] = clusters[r] || { fams: new Set(), whys: new Set(), strength: 0 }); const c = clusters[r]; c.fams.add(p.a); c.fams.add(p.b); c.whys.add(p.why); c.strength = Math.max(c.strength, p.strength); });
  return Object.keys(clusters).map(r => {
    const c = clusters[r], fams = Array.from(c.fams).sort((x, y) => g[y].length - g[x].length);
    let target = emCleanTarget(emCommonPrefix(fams));
    if (target.length < 4) target = fams[0];
    const machines = []; fams.forEach(f => g[f].forEach(m => machines.push(m)));
    const bigKeys = {}; g[fams[0]].forEach(m => { const k = emSpecKey(m); bigKeys[k] = (bigKeys[k] || 0) + 1; });
    const top = Object.keys(bigKeys).sort((x, y) => bigKeys[y] - bigKeys[x])[0], same = machines.filter(m => emSpecKey(m) === top).length;
    return { fams, target, why: Array.from(c.whys).join(' · '), strength: c.strength, machines, nMachines: machines.length, sameSpec: same === machines.length, someSpec: same > 1 };
  }).sort((x, y) => y.strength - x.strength || (y.sameSpec - x.sameSpec) || (y.nMachines - x.nMachines));
}// Machines alone in their family that share a leading word and the same points with an existing bigger family.
function emSingletonHints() {
  const g = emFamilyGroups(), names = Object.keys(g), hints = [];
  const first = s => (String(s).match(/^[A-Z0-9]+/) || [''])[0];
  const bigs = names.filter(n => g[n].length >= 3);
  names.filter(n => g[n].length === 1).forEach(sn => {
    const m = g[sn][0], pts = (m.points || []).join('|');
    let best = null;
    bigs.forEach(bn => {
      if (first(bn) !== first(sn) || first(sn).length < 3) return;
      const samePts = g[bn].some(x => (x.points || []).join('|') === pts);
      if (!samePts) return;
      let cp = 0; const A = emAlnum(sn), B = emAlnum(bn); while (cp < A.length && cp < B.length && A[cp] === B[cp]) cp++;
      if (cp < Math.max(6, Math.round(0.6 * Math.min(A.length, B.length)))) return;
      if (!best || cp > best.cp) best = { fam: bn, cp };
    });
    if (best) hints.push({ name: m.name, from: sn, to: best.fam });
  });
  return hints;
}

/* ───────────────────────── limits ───────────────────────── */
function emLimitsToForm(raw) {
  const n = normalizeLimits(raw);
  if (!n) return { unit: 'mm/s', a: '', at: '', c: '' };
  return { unit: n.u === 'mic' ? 'micron' : 'mm/s', a: String(n.a), at: n.at < n.c ? String(n.at) : '', c: String(n.c) };
}
function emFormToLimits(f) {
  const a = parseFloat(f.a), at = parseFloat(f.at), c = parseFloat(f.c);
  if (!isFinite(a) && !isFinite(at) && !isFinite(c)) return null;
  const out = { unit: f.unit || 'mm/s', normal: a };
  if (isFinite(at)) out.alarm = at;
  out.alert = c; out.critical = c;
  return out;
}
function emLimitErrors(f) {
  const a = parseFloat(f.a), at = parseFloat(f.at), c = parseFloat(f.c), e = [];
  if (!isFinite(a) && !isFinite(at) && !isFinite(c)) return e;   // no limits at all = the app's standard limits apply
  if (!isFinite(a) || a <= 0) e.push('"Alarm starts at" must be a number above 0.');
  if (!isFinite(c) || c <= 0) e.push('"Critical starts at" must be a number above 0.');
  if (isFinite(a) && isFinite(c) && c <= a) e.push('"Critical starts at" must be higher than "Alarm starts at".');
  if (isFinite(at) && isFinite(a) && isFinite(c) && (at <= a || at >= c)) e.push('"Alert starts at" must sit between the alarm and critical values (or be left empty for no separate alert level).');
  return e;
}
function emSevFor(v, f) {
  const a = parseFloat(f.a), at = parseFloat(f.at), c = parseFloat(f.c);
  if (!isFinite(v) || !isFinite(a) || !isFinite(c)) return '';
  if (v >= c) return 'CRITICAL';
  if (isFinite(at) && v >= at) return 'ALERT';
  if (v >= a) return 'ALARM';
  return 'NORMAL';
}
function emZonesHtml(f) {
  const a = parseFloat(f.a), at = parseFloat(f.at), c = parseFloat(f.c), u = f.unit === 'micron' ? 'µm' : 'mm/s';
  if (!isFinite(a) || !isFinite(c)) return '<span class="em-sub">No limits set — the app\'s standard limits apply (alarm 4.5 · alert 7.1 · critical 11.2 mm/s).</span>';
  return `<span class="em-z-n">NORMAL &lt; ${a}</span><span class="em-z-a">ALARM ${a} – ${isFinite(at) ? at : c}</span>` +
    (isFinite(at) ? `<span class="em-z-t">ALERT ${at} – ${c}</span>` : '') + `<span class="em-z-c">CRITICAL ≥ ${c}</span><span class="em-sub">${u}</span>`;
}
// The text the plant SQL Server keeps in VibeMon_EquipmentMaster.LimitsRaw (what VibeMon.ashx / the trainer parse)
function emLimitsRawText(l) {
  const u = /mic/i.test(l.unit || '') ? 'mic' : 'mm/s', a = l.normal, at = l.alarm, c = l.critical;
  return `Normal <${a}, ` + (at != null && at < c ? `Alarm ${a} to ${at} ${u}, Alert ${at} to ${c} ${u}, ` : `Alarm ${a} to ${c} ${u}, `) + `Critical >${c} ${u}`;
}

/* ───────────────────────── drafts ───────────────────────── */
function emMaster(name) { return (MASTER || []).find(m => m.name === name) || null; }
function emDraftFrom(m) {
  return {
    name: m.name || '', unit: m.unit || '', area: m.area || '', dept: m.dept || '',
    category: m.category || '', rpm: (m.rpm == null || m.rpm === '') ? '' : String(m.rpm),
    family: String(m.family || ''), points: (m.points || []).join('\n'),
    params: (m.params || []).slice(), lim: emLimitsToForm(m.limits)
  };
}
const emBlankDraft = () => ({ name: '', unit: '', area: '', dept: '', category: '', rpm: '', family: '', points: '', params: ['H Vel', 'V Vel', 'A Vel', 'Acc'], lim: { unit: 'mm/s', a: '', at: '', c: '' } });
const emParsePoints = t => { const seen = new Set(), out = []; String(t || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean).forEach(s => { if (!seen.has(s.toUpperCase())) { seen.add(s.toUpperCase()); out.push(s); } }); return out; };
function emOrderedParams(list) {
  const known = EM_PARAMS.filter(p => list.indexOf(p) >= 0), extra = list.filter(p => EM_PARAMS.indexOf(p) < 0);
  return known.concat(extra);
}
function emNameClash(name, exceptName) {
  const k = emNorm(name), k2 = emAlnum(name);
  return (MASTER || []).find(m => m.name !== exceptName && (emNorm(m.name) === k || emAlnum(m.name) === k2)) || null;
}
// DB-shaped values of a draft, or { errors }
function emResolveDraft(d, exceptName) {
  const errors = []; let name = String(d.name || '').trim().replace(/\s+/g, ' ');
  // some existing names contain line breaks / double spaces; an input box shows them as one space, which must not count as a rename
  if (exceptName && name === String(exceptName).trim().replace(/\s+/g, ' ')) name = exceptName;
  if (!name) errors.push('Name is required.');
  else { const c = emNameClash(name, exceptName); if (c) errors.push('"' + name + '" looks the same as the existing equipment "' + c.name + '" (names are compared ignoring case, spaces and hyphens).'); }
  const points = emParsePoints(d.points);
  if (!points.length) errors.push('Add at least one measurement point.');
  const params = emOrderedParams(d.params || []);
  if (!params.length) errors.push('Tick at least one parameter.');
  let rpm = null;
  if (String(d.rpm).trim() !== '') { rpm = parseFloat(d.rpm); if (!isFinite(rpm) || rpm < 0) errors.push('Speed (rpm) must be a number.'); }
  emLimitErrors(d.lim).forEach(e => errors.push(e));
  let family = String(d.family || '').trim().toUpperCase();
  if (family && family === EM_BASE_FAMILY(name)) family = '';     // same as automatic = no override needed
  return {
    errors, name, points, params, rpm, family: family || null,
    unit: String(d.unit || '').trim(), area: String(d.area || '').trim(), dept: String(d.dept || '').trim(),
    category: String(d.category || '').trim(), limits: emFormToLimits(d.lim)
  };
}
function emDiff(origName, r) {
  const m = emMaster(origName), o = m ? emResolveDraft(emDraftFrom(m), origName) : null, ch = {};
  if (!o) return ch;
  ['unit', 'area', 'dept', 'category'].forEach(k => { if (r[k] !== o[k]) ch[k] = { from: o[k], to: r[k] }; });
  if ((r.rpm == null ? '' : r.rpm) !== (o.rpm == null ? '' : o.rpm)) ch.rpm = { from: o.rpm, to: r.rpm };
  if (JSON.stringify(r.points) !== JSON.stringify(o.points)) ch.points = { from: o.points, to: r.points };
  if (JSON.stringify(r.params) !== JSON.stringify(o.params)) ch.params = { from: o.params, to: r.params };
  if (JSON.stringify(r.limits) !== JSON.stringify(o.limits)) ch.limits = { from: o.limits, to: r.limits };
  if ((r.family || '') !== (o.family || '')) ch.family = { from: o.family, to: r.family };
  if (r.name !== origName) ch.name = { from: origName, to: r.name };
  return ch;
}

/* ───────────────────────── data refresh ───────────────────────── */
async function emRefreshAll(renamed) {
  await fetchEquipmentMaster();
  if (renamed) { try { await _fetchAllFromGS(); } catch (e) {} try { await fetchVibeSchedule(); } catch (e) {} }
  try { populateFilters(); } catch (e) {}
  try { filterEntryList(); } catch (e) {}
  try { dsRender(); } catch (e) {}
}
async function emLog(action, equipment, details, oldName) {
  try {
    const { error } = await _supabase.from('equipment_changes').insert([{ changed_by: emUser(), action, equipment, old_name: oldName || null, details }]);
    if (error) throw error;
    EM.changesLoaded = false;
  } catch (e) { console.warn('equipment_changes log failed:', e.message); return false; }
  return true;
}
// Update equipment_master, dropping a column the database does not have yet (category / family) instead of failing.
async function emUpdateMaster(fields, filterFn) {
  let f = Object.assign({}, fields), dropped = [];
  for (let i = 0; i < 3; i++) {
    const { error } = await filterFn(_supabase.from('equipment_master').update(f));
    if (!error) return { dropped };
    const msg = (error.message || '') + ' ' + (error.details || '');
    const col = ['category', 'family'].find(c => f.hasOwnProperty(c) && new RegExp("['\"\\s]" + c + "['\"\\s]", 'i').test(msg) && /column|schema cache|could not find/i.test(msg));
    if (!col) throw error;
    delete f[col]; dropped.push(col);
    if (!Object.keys(f).length) return { dropped };
  }
  throw new Error('Could not update the equipment master.');
}

/* ───────────────────────── open / close / render shell ───────────────────────── */
function openEquipmentManager() {
  if (typeof AUTH === 'undefined' || AUTH.role !== 'admin') return;
  document.getElementById('equipment-manager-modal').classList.add('open');
  EM.msg = ''; EM.loaded = true;
  if (!EM.draft && !EM.add) EM.add = null;
  emRender();
}
function closeEquipmentManager() { document.getElementById('equipment-manager-modal').classList.remove('open'); }

function emTabsHtml() {
  const t = [['edit', '✏️ Edit equipment'], ['add', '➕ Add equipment'], ['fam', '🧩 Families'], ['sql', '🗄️ Office SQL' + (EM.changesLoaded ? ' (' + EM.changes.length + ')' : '')]];
  return '<div class="em-tabs">' + t.map(x => `<button class="em-tab${EM.tab === x[0] ? ' on' : ''}" data-em-tab="${x[0]}">${x[1]}</button>`).join('') + '</div>';
}
function emMsgHtml() { return EM.msg ? `<div class="em-msg ${EM.msgKind}">${escHtml(EM.msg)}</div>` : ''; }

function emRender() {
  const body = document.getElementById('em-body');
  if (!body) return;
  let h = emTabsHtml() + emMsgHtml();
  if (EM.tab === 'edit') h += emEditTabHtml();
  else if (EM.tab === 'add') h += emAddTabHtml();
  else if (EM.tab === 'fam') h += emFamTabHtml();
  else h += emSqlTabHtml();
  body.innerHTML = h;
  if (EM.tab === 'edit') emRenderList();
  if (EM.tab === 'add') emRenderCloneList();
  if (EM.tab === 'sql' && !EM.changesLoaded) emLoadChanges();
}
function emSay(msg, kind) { EM.msg = msg; EM.msgKind = kind || 'info'; emRender(); const b = document.getElementById('em-body'); if (b && b.parentElement) b.parentElement.scrollTop = 0; }

/* ───────────────────────── shared field editor ───────────────────────── */
function emFieldsHtml(d, ctx) {
  const depts = (typeof DEPTS_LIST !== 'undefined' ? DEPTS_LIST : []).slice();
  if (d.dept && depts.indexOf(d.dept) < 0) depts.push(d.dept);
  const cats = Array.from(new Set((MASTER || []).map(m => m.category).filter(c => c && c !== 'OTHER'))).sort();
  const fams = Object.keys(emFamilyGroups()).sort();
  const derived = d.name ? EM_BASE_FAMILY(d.name) : '';
  const eff = d.name ? (String(d.family || '').trim().toUpperCase() || derived) : '';
  const grp = emFamilyGroups()[eff];
  const inp = (f, label, val, extra) => `<div class="em-fg"><label>${label}</label><input data-ctx="${ctx}" data-f="${f}" value="${escHtml(val)}" ${extra || ''}></div>`;
  return `
    <div class="em-grid">
      ${inp('name', 'Name (nomenclature)', d.name, 'autocomplete="off"')}
      ${inp('unit', 'Unit', d.unit)}
      ${inp('area', 'Area', d.area)}
      <div class="em-fg"><label>Responsible dept</label><select data-ctx="${ctx}" data-f="dept"><option value="">—</option>${depts.map(x => `<option value="${escHtml(x)}"${x === d.dept ? ' selected' : ''}>${escHtml(x)}</option>`).join('')}</select></div>
      <div class="em-fg"><label>Category / type</label><input data-ctx="${ctx}" data-f="category" list="em-cats" value="${escHtml(d.category)}" placeholder="e.g. PUMP, FAN, MOTOR"><datalist id="em-cats">${cats.map(c => `<option value="${escHtml(c)}">`).join('')}</datalist></div>
      ${inp('rpm', 'Speed (rpm)', d.rpm, 'inputmode="decimal"')}
      <div class="em-fg"><label>Family</label><input data-ctx="${ctx}" data-f="family" list="em-fams" value="${escHtml(d.family)}" placeholder="${escHtml(derived || 'automatic from name')}"><datalist id="em-fams">${fams.map(c => `<option value="${escHtml(c)}">`).join('')}</datalist>
        <div class="em-sub" id="em-fam-hint-${ctx}">${d.name ? `Family: <b>${escHtml(eff)}</b>${grp ? ' — ' + grp.filter(x => x.name !== d.name).length + ' other machine(s)' : ' — new family'}${d.family ? '' : ' (automatic)'}` : ''}</div></div>
    </div>
    <div class="em-grid">
      <div class="em-fg" style="grid-column:span 2"><label>Measurement points — one per line, in walking order</label><textarea data-ctx="${ctx}" data-f="points">${escHtml(d.points)}</textarea><div class="em-sub" id="em-pt-count-${ctx}">${emParsePoints(d.points).length} point(s)</div></div>
      <div class="em-fg"><label>Parameters measured</label><div class="em-params">${EM_PARAMS.map(p => `<label><input type="checkbox" data-ctx="${ctx}" data-p="${p}"${d.params.indexOf(p) >= 0 ? ' checked' : ''}> ${p}</label>`).join('')}</div></div>
    </div>
    <div class="em-lim"><div class="em-h">Vibration limits <span class="em-sub">— each value is where that level <b>starts</b></span></div>
      <div class="em-grid" style="margin-bottom:4px">
        <div class="em-fg"><label>Unit</label><select data-ctx="${ctx}" data-l="unit"><option value="mm/s"${d.lim.unit === 'mm/s' ? ' selected' : ''}>mm/s (velocity)</option><option value="micron"${d.lim.unit === 'micron' ? ' selected' : ''}>micron (displacement, e.g. turbines)</option></select></div>
        <div class="em-fg"><label>Alarm starts at</label><input data-ctx="${ctx}" data-l="a" inputmode="decimal" value="${escHtml(d.lim.a)}"></div>
        <div class="em-fg"><label>Alert starts at <span style="text-transform:none">(optional)</span></label><input data-ctx="${ctx}" data-l="at" inputmode="decimal" value="${escHtml(d.lim.at)}"></div>
        <div class="em-fg"><label>Critical starts at</label><input data-ctx="${ctx}" data-l="c" inputmode="decimal" value="${escHtml(d.lim.c)}"></div>
        <div class="em-fg"><label>Try a reading</label><input data-ctx="${ctx}" data-l="test" inputmode="decimal" placeholder="e.g. 5.2"><div class="em-sub" id="em-test-${ctx}"></div></div>
      </div>
      <div class="em-zones" id="em-zones-${ctx}">${emZonesHtml(d.lim)}</div>
    </div>`;
}
// light-weight refresh of the live previews (does not rebuild the form, so typing keeps its focus)
function emRefreshPreviews(ctx) {
  const d = ctx === 'add' ? EM.add : EM.draft; if (!d) return;
  const z = document.getElementById('em-zones-' + ctx); if (z) z.innerHTML = emZonesHtml(d.lim);
  const pc = document.getElementById('em-pt-count-' + ctx); if (pc) pc.textContent = emParsePoints(d.points).length + ' point(s)';
  const fh = document.getElementById('em-fam-hint-' + ctx);
  if (fh) {
    const derived = d.name ? EM_BASE_FAMILY(d.name) : '', eff = d.name ? (String(d.family || '').trim().toUpperCase() || derived) : '', grp = emFamilyGroups()[eff];
    fh.innerHTML = d.name ? `Family: <b>${escHtml(eff)}</b>${grp ? ' — ' + grp.filter(x => x.name !== d.name).length + ' other machine(s)' : ' — new family'}${d.family ? '' : ' (automatic)'}` : '';
  }
  const t = document.getElementById('em-test-' + ctx);
  if (t) { const v = parseFloat(d.lim.test); t.textContent = isFinite(v) ? '→ ' + (emSevFor(v, d.lim) || 'enter the limits first') : ''; }
}

/* ───────────────────────── EDIT tab ───────────────────────── */
function emEditTabHtml() {
  return `<div class="em-note">Search a machine, change what you need, press <b>Save</b>. Renaming updates the name <b>everywhere</b> (master, all past readings, every schedule version, frequency rules) in one step. Equipment cannot be deleted from here.</div>
    <div class="em-split"><div class="em-list"><input type="search" id="em-q" placeholder="Search name, unit, area, family, category…" value="${escHtml(EM.q)}" autocomplete="off"><div id="em-list-items"></div></div>
    <div id="em-editor">${emEditorHtml()}</div></div>`;
}
function emRenderList() {
  const box = document.getElementById('em-list-items'); if (!box) return;
  const q = emNorm(EM.q), all = (MASTER || []);
  const hit = all.filter(m => !q || emNorm([m.name, m.unit, m.area, m.category, emFamilyOf(m.name)].join(' ')).includes(q));
  box.innerHTML = hit.slice(0, 150).map(m => `<div class="em-item${m.name === EM.sel ? ' on' : ''}" data-eq="${escHtml(m.name)}">${escHtml(m.name)}<div class="s">${escHtml(m.unit || '')} · ${escHtml(m.area || '')} · ${escHtml(emFamilyOf(m.name))}</div></div>`).join('') +
    `<div class="em-sub" style="padding:6px 10px">${hit.length} of ${all.length} equipment${hit.length > 150 ? ' — type more to narrow the list' : ''}</div>`;
}
function emSelect(name) {
  const m = emMaster(name); if (!m) return;
  const hadMsg = !!EM.msg;
  EM.sel = name; EM.draft = emDraftFrom(m); EM.orig = name; EM.applyFam = {}; EM.msg = '';
  if (hadMsg) return emRender();
  emRenderList();
  const ed = document.getElementById('em-editor'); if (ed) ed.innerHTML = emEditorHtml();
  const bar = document.getElementById('em-msgbar'); if (bar) bar.innerHTML = '';
}
function emEditorHtml() {
  if (!EM.draft) return '<div class="em-form"><div class="em-sub">Select an equipment from the list to edit it.</div></div>';
  const d = EM.draft, m = emMaster(EM.orig), fam = emFamilyOf(d.name);
  const others = (emFamilyGroups()[emFamilyOf(EM.orig)] || []).filter(x => x.name !== EM.orig).length;
  const ap = k => `<label><input type="checkbox" data-apf="${k}"${EM.applyFam[k] ? ' checked' : ''}> ${({ limits: 'limits', params: 'parameters', category: 'category', rpm: 'speed', dept: 'dept' })[k]}</label>`;
  return `<div class="em-form"><div class="em-h">Editing: ${escHtml(EM.orig)}</div>
    ${emFieldsHtml(d, 'edit')}
    <div class="em-fam"><b>Frequency:</b> ${escHtml(m ? (m.frequency || '—') : '—')} <span class="em-sub">— change how often a machine or family is read in <a href="#" data-em-go="sm">Schedule Manager</a>.</span></div>
    ${others ? `<div class="em-fam"><b>Also apply to the ${others} other machine(s) in family ${escHtml(fam)}:</b><br>${['limits', 'params', 'category', 'rpm', 'dept'].map(ap).join('')}<div class="em-sub">Unticked = only this machine changes. Points are never copied to other machines.</div></div>` : ''}
    <div id="em-msgbar"></div>
    <div class="em-row"><button class="btn btn-green" data-em="save"${EM.busy ? ' disabled' : ''}>💾 Save changes</button><button class="btn" data-em="revert">Revert</button>
      <span class="em-sub">Changes are also queued for your office SQL Server (Office SQL tab).</span></div></div>`;
}
async function emSave() {
  if (EM.busy || !EM.draft) return;
  const orig = EM.orig, r = emResolveDraft(EM.draft, orig);
  if (r.errors.length) return emSay('Please fix:\n• ' + r.errors.join('\n• '), 'err');
  const ch = emDiff(orig, r);
  const wantFam = Object.keys(EM.applyFam).filter(k => EM.applyFam[k]);
  const fields = {};
  ['unit', 'area', 'dept', 'category', 'rpm', 'points', 'params', 'limits', 'family'].forEach(k => { if (ch[k]) fields[k] = r[k]; });
  const others = wantFam.length ? (emFamilyGroups()[emFamilyOf(orig)] || []).filter(x => x.name !== orig).map(x => x.name) : [];
  if (!Object.keys(ch).length && !(others.length && wantFam.length)) return emSay('Nothing changed.', 'info');
  const renaming = !!ch.name;
  if (renaming && !confirm('Rename "' + orig + '" to "' + r.name + '"?\n\nThis changes the name EVERYWHERE in Supabase — equipment master, every past reading, all schedule versions, frequency rules and catch-ups — in one all-or-nothing step.\n\nAfterwards run the script in the "Office SQL" tab on your office VibeMonDB so it matches. Until then the plant dashboard and the AI model still know this machine as "' + orig + '".')) return;
  EM.busy = true; emSay('⏳ Saving…', 'info');
  let renamed = false, summary = [];
  try {
    if (renaming) {
      const { data, error } = await _supabase.rpc('rename_equipment', { p_old: orig, p_new: r.name, p_by: emUser() });
      if (error) throw error;
      renamed = true;
      summary.push(`Renamed everywhere: ${data.readings} reading rows, ${data.schedule_rows} schedule rows, ${data.rules} rules, ${data.catchups} catch-ups.`);
    }
    let dropped = [];
    if (Object.keys(fields).length) {
      const res = await emUpdateMaster(fields, q => q.eq('name', r.name));
      dropped = res.dropped;
      const logged = {}; Object.keys(fields).forEach(k => { if (dropped.indexOf(k) < 0) logged[k] = fields[k]; });
      if (Object.keys(logged).length) await emLog('edit', r.name, { targets: [r.name], changes: logged });
      summary.push('Saved: ' + Object.keys(fields).filter(k => dropped.indexOf(k) < 0).join(', ') + '.');
      if (dropped.length) summary.push('⚠️ Not saved (database column missing): ' + dropped.join(', ') + '. ' + EM_SQL_FIX);
    }
    if (others.length && wantFam.length) {
      const sub = {}, map = { limits: 'limits', params: 'params', category: 'category', rpm: 'rpm', dept: 'dept' };
      wantFam.forEach(k => { sub[map[k]] = r[map[k]]; });
      const res = await emUpdateMaster(sub, q => q.in('name', others));
      const logged = {}; Object.keys(sub).forEach(k => { if (res.dropped.indexOf(k) < 0) logged[k] = sub[k]; });
      if (Object.keys(logged).length) await emLog('edit', r.name, { targets: others, changes: logged, viaFamily: emFamilyOf(orig) });
      summary.push('Also applied ' + Object.keys(logged).join(', ') + ' to ' + others.length + ' other machine(s) in the family.');
    }
    await emRefreshAll(renamed);
    EM.sel = r.name; EM.orig = r.name; const m2 = emMaster(r.name); EM.draft = m2 ? emDraftFrom(m2) : null; EM.applyFam = {};
    EM.busy = false;
    emSay('✅ ' + summary.join('\n'), 'ok');
    emRenderList();
  } catch (e) {
    EM.busy = false;
    if (renamed) { await emRefreshAll(true); EM.sel = r.name; EM.orig = r.name; const m3 = emMaster(r.name); EM.draft = m3 ? emDraftFrom(m3) : EM.draft; }
    emSay('⚠️ ' + (renamed ? 'The rename was done, but a later step failed: ' : 'Nothing was saved: ') + emErrText(e), 'err');
  }
}

/* ───────────────────────── scheduling of NEW equipment ───────────────────────── */
let _emGeo = null;
const emGeo = () => (_emGeo = _emGeo || window.VibeEngine.buildGeo());
function emLoadPlan(y, m) { return window.VibeEngine.makePlan(smSourceRows(y, m)); }
function emMaps(plan) {
  const load = {}, locs = {};
  plan.visits.forEach(v => { const k = v.team + '|' + v.day; load[k] = (load[k] || 0) + 1; (locs[k] = locs[k] || new Map()).set(v.loc, ((locs[k].get(v.loc)) || 0) + 1); });
  return { load, locs };
}
function emSlotCost(mp, team, day, loc, prefTeam) {
  const cap = 26, k = team + '|' + day, l = mp.load[k] || 0;
  if (l >= cap + 4) return null;
  const lm = mp.locs[k]; let c;
  if (lm && lm.has(loc)) c = 0;
  else { let dm = 0; if (lm && lm.size) { dm = 9; lm.forEach((_, x) => { dm = Math.min(dm, emGeo().dist(loc, x)); }); } c = 1 + 0.7 * dm + (lm && lm.size >= 2 ? 1.2 : 0); }
  c += 0.6 * (l / cap);
  if (team !== prefTeam) c += 1.5;
  return c;
}
function emTake(mp, team, day, loc) { const k = team + '|' + day; mp.load[k] = (mp.load[k] || 0) + 1; (mp.locs[k] = mp.locs[k] || new Map()).set(loc, ((mp.locs[k].get(loc)) || 0) + 1); }

// THIS month, at the last free days: never in the past, spaced by frequency, counted back from the last working day.
function emPlanCurrent(spec) {
  const E = window.VibeEngine, now = new Date(); now.setHours(0, 0, 0, 0);
  const y = now.getFullYear(), m = now.getMonth(), wds = dsWorkingDaysOfMonth(y, m), T = wds.length;
  const start = wds.findIndex(d => d >= now) + 1;
  if (start <= 0) return { ok: false, reason: 'No regular working day is left in this month (only the reserve days remain).' };
  const plan = emLoadPlan(y, m), mp = emMaps(plan), gap = { W: 5, T: 7, F: 10, M: 99 }[spec.freq];
  const n = Math.max(1, Math.min(E.ROUNDS_OF[spec.freq], 1 + Math.floor((T - start) / gap)));
  const chosen = [];
  for (let i = 0; i < n; i++) {
    const target = T - i * gap; let best = null;
    for (let d = target; d >= Math.max(start, target - 3) && !best; d--) {      // latest day first: the first day with any room wins
      if (chosen.some(c => c.day === d)) continue;
      E.TEAMS.forEach(team => { const c = emSlotCost(mp, team, d, spec.loc, spec.team); if (c !== null && (!best || c < best.c)) best = { team, day: d, c }; });
    }
    if (best) { emTake(mp, best.team, best.day, spec.loc); chosen.push({ team: best.team, day: best.day, loc: spec.loc, freq: spec.freq }); }
  }
  if (!chosen.length) return { ok: false, reason: 'No free slot found in the remaining days of this month.' };
  chosen.sort((a, b) => a.day - b.day);
  return { ok: true, y, m, from: emMonthFirst(y, m), visits: chosen, basePlan: plan, partial: chosen.length < E.ROUNDS_OF[spec.freq] };
}
// A full month with the normal spacing for its frequency (same engine as the Schedule Manager's "change only what changed").
function emPlanFullMonth(spec, y, m) {
  const E = window.VibeEngine, base = emLoadPlan(y, m), plan = E.clonePlan(base), mp = emMaps(plan);
  const win = { W: [1, 4], T: [1, 6], F: [1, 11], M: [1, plan.T] }[spec.freq]; let best = null;
  for (let d = win[0]; d <= win[1]; d++) E.TEAMS.forEach(team => { const c = emSlotCost(mp, team, d, spec.loc, spec.team); if (c !== null && (!best || c < best.c)) best = { team, day: d, c }; });
  if (!best) return { ok: false, reason: 'No free slot found for ' + y + '-' + emPad(m + 1) + '.' };
  emTake(mp, best.team, best.day, spec.loc);
  const n = E.ROUNDS_OF[spec.freq], W = 26, ideal = W / n, T = plan.T, vis = [{ team: best.team, day: best.day, loc: spec.loc, freq: spec.freq }];
  while (vis.length < n) {
    let b2 = null;
    for (let d = 1; d <= T; d++) {
      if (vis.some(v => v.day === d)) continue;
      let sp = 99; vis.forEach(v => { const gp = Math.abs(d - v.day); sp = Math.min(sp, gp, W - gp); });
      E.TEAMS.forEach(team => { let c = emSlotCost(mp, team, d, spec.loc, spec.team); if (c === null) return; c += Math.abs(sp - ideal) * 0.5 + (sp < 3 ? 5 : 0); if (!b2 || c < b2.c) b2 = { team, day: d, c }; });
    }
    if (!b2) break;
    emTake(mp, b2.team, b2.day, spec.loc); vis.push({ team: b2.team, day: b2.day, loc: spec.loc, freq: spec.freq });
  }
  vis.sort((x, y) => x.day - y.day);  return { ok: true, y, m, from: emMonthFirst(y, m), visits: vis, basePlan: base };
}
function emFutureMonths() {   // [{y,m,from}] — the next month first, then any month that already has its own generated version
  const now = new Date(), out = [], seen = new Set();
  const nx = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  out.push({ y: nx.getFullYear(), m: nx.getMonth(), from: emMonthFirst(nx.getFullYear(), nx.getMonth()) }); seen.add(out[0].from);
  (VIBE_VERSIONS || []).forEach(v => {
    if (!v.from || v.from <= out[0].from || seen.has(v.from)) return;
    seen.add(v.from); out.push({ y: parseInt(v.from.slice(0, 4), 10), m: parseInt(v.from.slice(5, 7), 10) - 1, from: v.from });
  });
  return out;
}
// Write the new equipment's visits into the version that starts at `from`. If that month already has its own version only
// the new rows are inserted; otherwise a full copy of the version in force is created with the new rows added.
async function emWriteVisits(p, name) {
  const E = window.VibeEngine, exact = (VIBE_VERSIONS || []).some(v => v.from === p.from);
  if (exact) {
    const rows = smDbRows(E.makePlan(p.visits.map(v => [v.team, v.day, name, v.freq, v.loc])), p.from);
    const r = await _supabase.from('vibe_schedule').insert(rows); if (r.error) throw r.error;
    return rows;
  }
  const full = E.clonePlan(p.basePlan);
  p.visits.forEach(v => full.visits.push({ id: full.visits.length, team: v.team, day: v.day, eq: name, freq: v.freq, loc: v.loc }));
  const rows = smDbRows(full, p.from);
  try {
    for (let i = 0; i < rows.length; i += 500) { const r = await _supabase.from('vibe_schedule').insert(rows.slice(i, i + 500)); if (r.error) throw r.error; }
    const chk = await _supabase.from('vibe_schedule').select('id', { count: 'exact', head: true }).eq('effective_from', p.from);
    if (chk.error) throw chk.error;
    if (chk.count !== rows.length) throw new Error('Saved ' + chk.count + ' of ' + rows.length + ' schedule rows');
  } catch (e) { await _supabase.from('vibe_schedule').delete().eq('effective_from', p.from); throw e; }   // no version existed here before, so this only removes our own half-written copy
  return rows;
}
function emSpecFrom(a) { return { name: String(a.name || '').trim().replace(/\s+/g, ' '), loc: a.loc, team: a.team, freq: a.freqCode }; }
// everything that will be written, without writing it
function emBuildPlans(a) {
  const E = window.VibeEngine, spec = emSpecFrom(a), plans = [], notes = [];
  if (!window.VibeEngine || typeof smSourceRows !== 'function') return { ok: false, reason: 'The schedule engine is not loaded.' };
  if (!(VIBE_VERSIONS || []).length) return { ok: false, reason: 'The schedule has not loaded yet — open the Daily Schedule tab once, then try again.' };
  const future = emFutureMonths();
  if (a.start === 'current') {
    const c = emPlanCurrent(spec);
    if (c.ok) { plans.push(Object.assign({ label: 'This month (last free days)' }, c)); if (c.partial) notes.push('Only ' + c.visits.length + ' of ' + E.ROUNDS_OF[spec.freq] + ' visits fit in what is left of this month; the full frequency starts next month.'); }
    else notes.push(c.reason + ' It will start next month instead.');
  }
  for (const f of future) {
    const p = emPlanFullMonth(spec, f.y, f.m);
    if (!p.ok) return { ok: false, reason: p.reason };
    plans.push(Object.assign({ label: new Date(f.y, f.m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) + (f === future[0] ? ' (start of regular schedule)' : ' (already generated — new rows added)') }, p));
  }
  return { ok: true, plans, notes, spec };
}

/* ───────────────────────── ADD tab ───────────────────────── */
function emScheduleInfoFor(name) {
  try {
    const now = new Date(), rows = smSourceRows(now.getFullYear(), now.getMonth()).filter(r => r[2] === name);
    if (!rows.length) return null;
    const tc = {}; rows.forEach(r => { tc[r[0]] = (tc[r[0]] || 0) + 1; });
    return { team: Object.keys(tc).sort((a, b) => tc[b] - tc[a])[0], loc: (rows.find(r => r[4]) || [])[4] || '', freq: rows[0][3] };
  } catch (e) { return null; }
}
function emLocations() {
  const set = new Set();
  (VIBE_VERSIONS || []).forEach(v => Object.keys(v.data || {}).forEach(t => Object.keys(v.data[t]).forEach(d => (v.data[t][d] || []).forEach(it => { if (it.l) set.add(it.l); }))));
  return Array.from(set).sort();
}
function emNewAdd() { return Object.assign(emBlankDraft(), { clone: '', freqCode: 'F', team: 'Precise', loc: '', start: 'current' }); }
function emAddTabHtml() {
  if (!EM.add) EM.add = emNewAdd();
  const a = EM.add, E = window.VibeEngine, labels = (typeof smTeamLabels === 'function') ? smTeamLabels() : (E ? E.TEAM_LABEL : {});
  const locs = emLocations();
  return `<div class="em-note">Best way to add a machine: <b>start from a similar one</b> (it copies unit, area, points, parameters, limits, speed, family and where it is scheduled), then change the name and whatever differs.</div>
    <div class="em-split"><div class="em-list"><input type="search" id="em-cq" placeholder="Find a similar machine to copy…" autocomplete="off" value="${escHtml(EM.cloneQ || '')}"><div id="em-clone-items"></div></div>
    <div class="em-form"><div class="em-h">New equipment${a.clone ? ' — copied from <i>' + escHtml(a.clone) + '</i>' : ''}</div>
      ${emFieldsHtml(a, 'add')}
      <div class="em-lim"><div class="em-h">Reading frequency &amp; schedule</div>
        <div class="em-grid" style="margin-bottom:4px">
          <div class="em-fg"><label>Frequency (required)</label><select data-ctx="add" data-s="freqCode">${EM_FREQ.map(f => `<option value="${f.code}"${a.freqCode === f.code ? ' selected' : ''}>${f.text}</option>`).join('')}</select></div>
          <div class="em-fg"><label>Team</label><select data-ctx="add" data-s="team">${(E ? E.TEAMS : ['Precise', 'CB', 'CBA']).map(t => `<option value="${t}"${a.team === t ? ' selected' : ''}>${escHtml(labels[t] || t)}</option>`).join('')}</select></div>
          <div class="em-fg"><label>Location code</label><input data-ctx="add" data-s="loc" list="em-locs" value="${escHtml(a.loc)}" placeholder="e.g. A2"><datalist id="em-locs">${locs.map(l => `<option value="${escHtml(l)}">`).join('')}</datalist><div class="em-sub">Machines in the same location are visited together.</div></div>
        </div>
        <div class="em-modes" style="font-size:12.5px;line-height:1.5">
          <label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer"><input type="radio" name="em-start" data-s="start" value="current"${a.start === 'current' ? ' checked' : ''}> <span><b>Include in the current month</b> — placed on the last free days that are still ahead, then the regular schedule from next month.</span></label>
          <label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer"><input type="radio" name="em-start" data-s="start" value="next"${a.start === 'next' ? ' checked' : ''}> <span><b>Start from next month</b> — same as any other frequency change.</span></label>
        </div>
      </div>
      <div id="em-placement">${EM.place ? emPlacementHtml() : ''}</div>
      <div class="em-row"><button class="btn btn-primary" data-em="preview"${EM.busy ? ' disabled' : ''}>👁 Preview placement</button><button class="btn btn-green" data-em="addconfirm"${EM.busy ? ' disabled' : ''}>➕ Add equipment</button><button class="btn" data-em="addreset">Clear form</button></div>
    </div></div>`;
}
function emRenderCloneList() {
  const box = document.getElementById('em-clone-items'); if (!box) return;
  const q = emNorm((document.getElementById('em-cq') || {}).value || EM.cloneQ || ''), all = MASTER || [];
  const hit = q ? all.filter(m => emNorm([m.name, m.unit, m.area, emFamilyOf(m.name)].join(' ')).includes(q)).slice(0, 80) : [];
  box.innerHTML = q ? hit.map(m => `<div class="em-item${m.name === (EM.add && EM.add.clone) ? ' on' : ''}" data-clone="${escHtml(m.name)}">${escHtml(m.name)}<div class="s">${escHtml(m.unit || '')} · ${escHtml(m.area || '')} · ${escHtml(emFamilyOf(m.name))}</div></div>`).join('') || '<div class="em-sub" style="padding:8px 10px">No match.</div>'
    : '<div class="em-sub" style="padding:8px 10px">Type a few letters, e.g. "ESP VACUUM".</div>';
}
function emCloneFrom(name) {
  const m = emMaster(name); if (!m) return;
  const d = emDraftFrom(m), si = emScheduleInfoFor(name), a = EM.add || emNewAdd();
  Object.assign(a, d, { name: '', clone: name, family: emFamilyOf(name) === EM_BASE_FAMILY(name) ? '' : emFamilyOf(name) });
  if (si) { a.team = si.team || a.team; a.loc = si.loc || a.loc; a.freqCode = si.freq || emFreqCodeFromWord(m.frequency); } else a.freqCode = emFreqCodeFromWord(m.frequency);
  EM.add = a; EM.place = null; emRender();
  const cq = document.getElementById('em-cq'); if (cq) cq.value = name;
  const nm = document.querySelector('[data-ctx="add"][data-f="name"]'); if (nm) nm.focus();
}
function emPlacementHtml() {
  const P = EM.place; if (!P) return '';
  if (!P.ok) return `<div class="em-msg err">${escHtml(P.reason)}</div>`;
  return `<div class="em-prev"><div class="em-h">Where it will be scheduled</div>${P.notes.map(n => `<div class="em-sub em-warn">${escHtml(n)}</div>`).join('')}` +
    P.plans.map(p => {
      const teams = (typeof smTeamLabels === 'function') ? smTeamLabels() : window.VibeEngine.TEAM_LABEL;
      return `<div style="margin-top:8px"><b>${escHtml(p.label)}</b><div class="em-chips">${p.visits.map(v => { const dt = dsWDDate(p.y, p.m, v.day); return `<span>${emFmtDay(dt)} · ${escHtml(teams[v.team] || v.team)} · loc ${escHtml(v.loc || '?')}</span>`; }).join('')}</div></div>`;
    }).join('') + '</div>';
}
function emPreview() {
  const a = EM.add; if (!a) return;
  const problems = emAddProblems(a);
  if (problems.length) { EM.place = { ok: false, reason: problems.join('\n') }; return emRefreshPlacement(); }
  EM.place = emBuildPlans(a); emRefreshPlacement();
}
function emRefreshPlacement() { const b = document.getElementById('em-placement'); if (b) b.innerHTML = emPlacementHtml(); }
function emAddProblems(a) {
  const r = emResolveDraft(a, null), p = r.errors.slice();
  if (!String(a.loc || '').trim()) p.push('Location code is required (machines in the same location are visited together).');
  return p;
}
async function emAddConfirm() {
  if (EM.busy || !EM.add) return;
  const a = EM.add, problems = emAddProblems(a);
  if (problems.length) return emSay('Please fix:\n• ' + problems.join('\n• '), 'err');
  const r = emResolveDraft(a, null), plan = emBuildPlans(a);
  if (!plan.ok) return emSay('⚠️ ' + plan.reason, 'err');
  const f = emFreqOf(a.freqCode);
  if (!confirm('Add "' + r.name + '" (' + f.word + ', team ' + a.team + ', location ' + a.loc + ')?\n\n' + plan.plans.map(p => '• ' + p.label + ': ' + p.visits.length + ' visit(s)').join('\n') + (plan.notes.length ? '\n\n' + plan.notes.join('\n') : '') + '\n\nNothing can be deleted from the app afterwards, only edited.')) return;
  EM.busy = true; emSay('⏳ Adding…', 'info');
  let masterDone = false, steps = [];
  try {
    const row = { name: r.name, unit: r.unit, area: r.area, dept: r.dept, rpm: r.rpm, frequency: f.word, points: r.points, params: r.params, limits: r.limits };
    if (r.category) row.category = r.category;
    if (r.family) row.family = r.family;
    let dropped = [];
    for (let i = 0; i < 3; i++) {
      const { error } = await _supabase.from('equipment_master').insert([row]);
      if (!error) break;
      const msg = (error.message || '') + ' ' + (error.details || '');
      const col = ['category', 'family'].find(c => row.hasOwnProperty(c) && new RegExp("['\"\\s]" + c + "['\"\\s]", 'i').test(msg) && /column|schema cache|could not find/i.test(msg));
      if (!col) throw error; delete row[col]; dropped.push(col);
    }
    masterDone = true; steps.push('Added to the equipment master.');
    if (dropped.length) steps.push('⚠️ Not saved (database column missing): ' + dropped.join(', ') + '. ' + EM_SQL_FIX);
    const rule = await _supabase.from('schedule_rules').upsert([{ scope: 'equipment', target: r.name, frequency: f.label, updated_by: emUser() }], { onConflict: 'scope,target' });
    if (rule.error) steps.push('⚠️ Frequency rule not saved (' + rule.error.message + ') — set it in the Schedule Manager.'); else steps.push('Frequency rule saved (' + f.word + ').');
    const written = [];
    for (const p of plan.plans) {
      const rows = await emWriteVisits(p, r.name);
      written.push({ from: p.from, label: p.label, rows: rows.length });
      steps.push('Schedule: ' + p.label + ' — ' + p.visits.length + ' visit(s).');
    }
    try { await _supabase.from('schedule_runs').insert([{ effective_from: plan.plans[0].from, generated_by: emUser(), mode: 'add-equipment', readings_per_month: window.VibeEngine.ROUNDS_OF[a.freqCode], equipment_changed: 1, summary: { added: r.name, team: a.team, loc: a.loc, frequency: f.label } }]); } catch (e) {}
    const teamLabels = (typeof smTeamLabels === 'function') ? smTeamLabels() : window.VibeEngine.TEAM_LABEL;
    const steady = plan.plans.find(p => !/^This month/.test(p.label)) || plan.plans[0];
    await emLog('add', r.name, {
      row: { unit: r.unit, area: r.area, dept: r.dept, category: r.category, rpm: r.rpm, frequencyDays: f.days, frequency: f.word, points: r.points, params: r.params, limits: r.limits, family: r.family },
      schedule: steady.visits.map((v, i) => ({ team: teamLabels[v.team] || v.team, day: v.day, loc: v.loc, freq: f.label, rotation: (i + 1) + ' of ' + steady.visits.length })),
      cloneOf: a.clone || null
    });
    await emRefreshAll(false); try { await fetchVibeSchedule(); dsRender(); } catch (e) {}
    EM.add = null; EM.place = null; EM.busy = false;
    emSay('✅ ' + r.name + ' added.\n' + steps.join('\n') + '\nIt is queued in the Office SQL tab for your VibeMonDB.', 'ok');
  } catch (e) {
    EM.busy = false;
    if (masterDone) { try { await emRefreshAll(false); await fetchVibeSchedule(); } catch (e2) {} }
    emSay('⚠️ ' + (masterDone ? 'The equipment WAS added to the master, but a later step failed:\n' : 'Nothing was added:\n') + emErrText(e) + (masterDone ? '\nFix the cause, then place it with the Schedule Manager (its frequency rule is already saved if the step above says so).' : '') + (steps.length ? '\n\nDone so far: ' + steps.join(' ') : ''), 'err');
  }
}

/* ───────────────────────── FAMILIES tab ───────────────────────── */
function emFamTabHtml() {
  const g = emFamilyGroups(), sug = emFamilySuggestions(), hints = emSingletonHints();
  const q = emNorm(EM.famQ), names = Object.keys(g).filter(n => !q || emNorm(n).includes(q)).sort((a, b) => g[b].length - g[a].length || (a < b ? -1 : 1));
  const overrides = (MASTER || []).filter(m => String(m.family || '').trim()).length;
  return `<div class="em-note">A <b>family</b> is a group of similar machines (e.g. "ESP VACUUM PUMP") that you change together in the Schedule Manager. By default it is worked out from the name; anything you move here is remembered as a manual family. <b>${Object.keys(g).length}</b> families · <b>${overrides}</b> machine(s) with a manual family.</div>
    <div class="em-h">Suggested clean-ups <span class="em-sub">— names that look like the same family spelt differently. Nothing is changed until you press Merge.</span></div>
    ${sug.length ? `<div class="em-tblwrap" style="max-height:260px"><table class="em-tbl"><thead><tr><th>These families…</th><th>…become one family</th><th>Why</th><th>Specs</th><th></th></tr></thead><tbody>` +
      sug.slice(0, 60).map((s, i) => `<tr><td>${s.fams.map(f => '<b>' + escHtml(f) + '</b> <span class="em-sub">(' + (g[f] || []).length + ')</span>').join('<br>')}</td><td><b>${escHtml(s.target)}</b> <span class="em-sub">(${s.nMachines} machines)</span></td><td>${escHtml(s.why)}</td><td><span class="em-badge ${s.sameSpec ? 'hi' : 'mid'}">${s.sameSpec ? 'same points, params &amp; limits' : s.someSpec ? 'partly different' : 'different specs'}</span></td><td><button class="btn btn-sm" data-em="merge" data-i="${i}">Merge</button></td></tr>`).join('') + '</tbody></table></div>'
      : '<div class="em-sub" style="margin:6px 0 12px">No spelling variants found.</div>'}
    ${hints.length ? `<div class="em-h" style="margin-top:14px">Single machines that may belong to an existing family <span class="em-sub">(same first word and same points)</span></div><div class="em-tblwrap" style="max-height:200px"><table class="em-tbl"><thead><tr><th>Machine</th><th>Now in</th><th>Could join</th><th></th></tr></thead><tbody>` +
      hints.slice(0, 60).map((h, i) => `<tr><td>${escHtml(h.name)}</td><td>${escHtml(h.from)}</td><td><b>${escHtml(h.to)}</b></td><td><button class="btn btn-sm" data-em="joinhint" data-i="${i}">Move</button></td></tr>`).join('') + '</tbody></table></div>' : ''}
    <div class="em-h" style="margin-top:14px">All families</div>
    <div class="em-row"><input type="search" id="em-fq" placeholder="Filter families…" value="${escHtml(EM.famQ)}" style="padding:6px 10px;border:1px solid var(--border2);border-radius:var(--radius);font-size:12.5px;min-width:220px"></div>
    <div class="em-tblwrap"><table class="em-tbl"><thead><tr><th>Family</th><th>Machines</th><th>Frequencies today</th><th></th></tr></thead><tbody>` +
    names.slice(0, 200).map(n => { const c = {}; g[n].forEach(m => { const w = m.frequency || '—'; c[w] = (c[w] || 0) + 1; }); return `<tr><td><b>${escHtml(n)}</b></td><td>${g[n].length}</td><td class="em-sub">${escHtml(Object.keys(c).map(k => k + ' ×' + c[k]).join(', '))}</td><td><button class="btn btn-sm" data-em="famrename" data-fam="${escHtml(n)}">Rename family</button></td></tr>`; }).join('') + '</tbody></table></div>';
}
async function emSetFamily(names, family, label) {
  if (EM.busy || !names.length) return;
  EM.busy = true;
  try {
    const res = await emUpdateMaster({ family }, q => q.in('name', names));
    if (res.dropped.length) throw new Error('The family column does not exist yet. ' + EM_SQL_FIX);
    await emRefreshAll(false); EM.busy = false;
    emSay('✅ ' + label + ' — ' + names.length + ' machine(s) now in family "' + (family || 'automatic') + '". Frequencies for the whole family can now be changed together in the Schedule Manager.', 'ok');
  } catch (e) { EM.busy = false; emSay('⚠️ ' + emErrText(e), 'err'); }
}
function emMerge(i) {
  const s = emFamilySuggestions()[i]; if (!s) return;
  const names = s.machines.filter(m => emFamilyOf(m.name) !== s.target).map(m => m.name);
  if (!names.length) return emSay('Those machines are already in family "' + s.target + '".', 'info');
  if (!confirm('Put ' + names.length + ' machine(s) from ' + s.fams.length + ' families into ONE family called "' + s.target + '"?\n\n• ' + s.fams.join('\n• ') + '\n\n' + (s.sameSpec ? 'They all have the same points, parameters and limits.' : '⚠️ Their specs are not all identical — check that they really are the same kind of machine.') + '\nYou can undo this later by renaming or moving them.')) return;
  emSetFamily(names, s.target, 'Merged ' + s.fams.length + ' families into "' + s.target + '"');
}
function emJoinHint(i) {
  const h = emSingletonHints()[i]; if (!h) return;
  if (!confirm('Move "' + h.name + '" into family "' + h.to + '"?')) return;
  emSetFamily([h.name], h.to, 'Moved ' + h.name);
}
function emFamRename(fam) {
  const nv = (prompt('New name for family "' + fam + '":', fam) || '').trim().toUpperCase();
  if (!nv || nv === fam) return;
  if (emFamilyGroups()[nv] && !confirm('A family called "' + nv + '" already exists. Merge "' + fam + '" into it?')) return;
  emSetFamily((emFamilyGroups()[fam] || []).map(m => m.name), nv, 'Renamed family "' + fam + '" to "' + nv + '"');
}

/* ───────────────────────── OFFICE SQL tab ───────────────────────── */
async function emLoadChanges() {
  try {
    const { data, error } = await _supabase.from('equipment_changes').select('*').eq('office_applied', false).order('id', { ascending: true });
    if (error) throw error;
    EM.changes = data || []; EM.changesErr = '';
  } catch (e) { EM.changes = []; EM.changesErr = emErrText(e); }
  EM.changesLoaded = true;
  if (EM.tab === 'sql') emRender(); else { const t = document.querySelector('[data-em-tab="sql"]'); if (t) t.textContent = '🗄️ Office SQL (' + EM.changes.length + ')'; }
}
function emOfficeSql(list) {
  const L = [], now = new Date().toLocaleString();
  L.push('-- VibeMonDB office changes — generated ' + now + ' by the VibeMon app (' + list.length + ' change' + (list.length === 1 ? '' : 's') + ', in the order they were made).');
  L.push('-- Run once in SSMS against the office SQL Server. Everything is inside one transaction: if any line fails, nothing is applied.');
  L.push('USE VibeMonDB;', 'GO', 'SET XACT_ABORT ON;', 'SET NOCOUNT ON;', 'BEGIN TRAN;', '');
  const master = 'dbo.VibeMon_EquipmentMaster';
  // Dept / Category column names vary between installs, so look the real column up before updating it.
  const guarded = (col, val, whereSql, ix) => {
    const cands = col === 'dept' ? "'Dept','Department','Det'" : "'Category','EquipmentCategory'";
    const inner = ' = ' + emSqlStr(val) + ' WHERE ' + whereSql;
    return [`DECLARE @k${ix}${col} sysname = (SELECT TOP 1 name FROM sys.columns WHERE object_id = OBJECT_ID('${master}') AND name IN (${cands}));`,
      `IF @k${ix}${col} IS NOT NULL EXEC (N'UPDATE ${master} SET ' + QUOTENAME(@k${ix}${col}) + N'${inner.replace(/'/g, "''")}');`];
  };
  list.forEach((c, idx) => {
    const d = c.details || {}, ix = c.id || idx;
    L.push(`-- ── #${c.id} ${c.action.toUpperCase()}: ${c.action === 'rename' ? c.old_name + '  →  ' + c.equipment : c.equipment} (${c.changed_by || '?'}, ${new Date(c.changed_on).toLocaleString()})`);
    if (c.action === 'rename') {
      const o = emSqlStr(c.old_name), n = emSqlStr(c.equipment);
      L.push(`UPDATE dbo.VibeMon_Readings            SET Equipment = ${n} WHERE Equipment = ${o};`,
        `UPDATE ${master}  SET Name      = ${n} WHERE Name      = ${o};`,
        `UPDATE dbo.VibeMon_Schedule            SET Equipment = ${n} WHERE Equipment = ${o};`,
        `UPDATE dbo.VibeMon_VibrationExceptions SET Equipment = ${n} WHERE Equipment = ${o};`,
        `UPDATE dbo.VibeMon_SuccessStories      SET Equipment = ${n} WHERE Equipment = ${o};`);
    } else if (c.action === 'edit') {
      const ch = d.changes || {}, targets = (d.targets && d.targets.length ? d.targets : [c.equipment]), inList = targets.map(emSqlStr).join(', ');
      const sets = [];
      if (ch.unit !== undefined) sets.push('Unit = ' + emSqlStr(ch.unit));
      if (ch.area !== undefined) sets.push('Area = ' + emSqlStr(ch.area));
      if (ch.rpm !== undefined) sets.push('RPM = ' + (ch.rpm == null ? 'NULL' : ch.rpm));
      if (ch.points !== undefined) sets.push('Points = ' + emSqlStr((ch.points || []).join(', ')));
      if (ch.params !== undefined) sets.push('Params = ' + emSqlStr((ch.params || []).join(', ')));
      if (ch.limits !== undefined) sets.push('LimitsRaw = ' + (ch.limits ? emSqlStr(emLimitsRawText(ch.limits)) : 'NULL'));
      if (sets.length) L.push(`UPDATE ${master} SET ${sets.join(', ')} WHERE Name IN (${inList});`);
      ['dept', 'category'].forEach(col => { if (ch[col] !== undefined) guarded(col, ch[col], `Name IN (${inList})`, ix).forEach(x => L.push(x)); });
      if (ch.family !== undefined) L.push('-- (family is an app-only grouping — there is no SQL Server column for it)');
    } else if (c.action === 'add') {
      const r = d.row || {}, nm = emSqlStr(c.equipment);
      const cols = 'Unit, Area, Name, RPM, LimitsRaw, Points, Frequency, Params';
      const vals = `${emSqlStr(r.unit)}, ${emSqlStr(r.area)}, ${nm}, ${r.rpm == null ? 'NULL' : r.rpm}, ${r.limits ? emSqlStr(emLimitsRawText(r.limits)) : 'NULL'}, ${emSqlStr((r.points || []).join(', '))}, ${r.frequencyDays || 15}, ${emSqlStr((r.params || []).join(', '))}`;
      L.push(`IF NOT EXISTS (SELECT 1 FROM ${master} WHERE Name = ${nm})`, 'BEGIN',
        `  DECLARE @sno${ix} int = (SELECT ISNULL(MAX(TRY_CAST(SNo AS int)), 0) + 1 FROM ${master});`,
        `  IF COLUMNPROPERTY(OBJECT_ID('${master}'), 'SNo', 'IsIdentity') = 1`,
        `    INSERT INTO ${master} (${cols}) VALUES (${vals});`,
        '  ELSE',
        `    INSERT INTO ${master} (SNo, ${cols}) VALUES (@sno${ix}, ${vals});`, 'END;');
      ['dept', 'category'].forEach(col => { if (r[col]) guarded(col, r[col], `Name = ${nm}`, ix).forEach(x => L.push(x)); });
      L.push('-- Optional: only if the plant dashboard also uses dbo.VibeMon_Schedule (this is the regular-month pattern; the app keeps monthly versions of its own).');
      (d.schedule || []).forEach(s => L.push(`INSERT INTO dbo.VibeMon_Schedule (Team, WorkingDay, Equipment, Unit, Area, Frequency, Location, Rotation) VALUES (${emSqlStr(s.team)}, ${s.day}, ${nm}, ${emSqlStr(r.unit)}, ${emSqlStr(r.area)}, ${emSqlStr(s.freq)}, ${emSqlStr(s.loc)}, ${emSqlStr(s.rotation)});`));
    }
    L.push('');
  });
  L.push('COMMIT TRAN;', "PRINT 'VibeMon changes applied.';");
  return L.join('\n');
}
function emSqlTabHtml() {
  const n = EM.changes.length;
  return `<div class="em-note">Your office SQL Server is offline from Supabase, so every rename / edit / add made here is queued. Run the script below in SSMS on the office <b>VibeMonDB</b> to make it identical, then press <b>Mark all as applied</b>. Also re-train the model after renaming machines, so the AI knows the new names.</div>
    ${EM.changesErr ? `<div class="em-msg err">${escHtml(EM.changesErr)}</div>` : ''}
    ${!EM.changesLoaded ? '<div class="em-sub">Loading…</div>' : n ? `<div class="em-row"><b>${n} pending change${n === 1 ? '' : 's'}</b><button class="btn btn-primary btn-sm" data-em="copysql">📋 Copy script</button><button class="btn btn-sm" data-em="dlsql">⬇ Download .sql</button><button class="btn btn-green btn-sm" data-em="markapplied">✅ Mark all as applied</button></div>
      <textarea class="em-sql" id="em-sql-text" readonly spellcheck="false">${escHtml(emOfficeSql(EM.changes))}</textarea>` : '<div class="em-sub" style="padding:10px 0">✅ Nothing pending — the office database is up to date with the app.</div>'}`;
}
async function emMarkApplied() {
  if (!EM.changes.length || !confirm('Mark these ' + EM.changes.length + ' change(s) as applied to the office database?\nThey disappear from this list.')) return;
  try {
    const { error } = await _supabase.from('equipment_changes').update({ office_applied: true }).in('id', EM.changes.map(c => c.id));
    if (error) throw error;
    EM.changesLoaded = false; await emLoadChanges(); emSay('✅ Marked as applied.', 'ok');
  } catch (e) { emSay('⚠️ ' + emErrText(e), 'err'); }
}

/* ───────────────────────── events ───────────────────────── */
(function emEvents() {
  const body = document.getElementById('em-body');
  if (!body) return;
  body.addEventListener('click', ev => {
    const tab = ev.target.closest('[data-em-tab]');
    if (tab) { EM.tab = tab.getAttribute('data-em-tab'); EM.msg = ''; return emRender(); }
    const it = ev.target.closest('.em-item[data-eq]'); if (it) return emSelect(it.getAttribute('data-eq'));
    const cl = ev.target.closest('.em-item[data-clone]'); if (cl) return emCloneFrom(cl.getAttribute('data-clone'));
    const go = ev.target.closest('[data-em-go]'); if (go) { ev.preventDefault(); closeEquipmentManager(); return openScheduleManager(); }
    const b = ev.target.closest('button[data-em]'); if (!b) return;
    const a = b.getAttribute('data-em'), i = parseInt(b.getAttribute('data-i'), 10);
    if (a === 'save') emSave();
    else if (a === 'revert') { const m = emMaster(EM.orig); if (m) { EM.draft = emDraftFrom(m); EM.applyFam = {}; const ed = document.getElementById('em-editor'); if (ed) ed.innerHTML = emEditorHtml(); } }
    else if (a === 'preview') emPreview();
    else if (a === 'addconfirm') emAddConfirm();
    else if (a === 'addreset') { EM.add = null; EM.place = null; emRender(); }
    else if (a === 'merge') emMerge(i);
    else if (a === 'joinhint') emJoinHint(i);
    else if (a === 'famrename') emFamRename(b.getAttribute('data-fam'));
    else if (a === 'copysql') { const t = document.getElementById('em-sql-text'); if (t) { t.select(); try { navigator.clipboard.writeText(t.value).then(() => showToast('✅ Script copied', 'green')); } catch (e) { document.execCommand('copy'); } } }
    else if (a === 'dlsql') { const t = document.getElementById('em-sql-text'); if (t) { const blob = new Blob([t.value], { type: 'text/plain' }), u = URL.createObjectURL(blob), l = document.createElement('a'); l.href = u; l.download = 'VibeMon_office_changes_' + new Date().toISOString().slice(0, 10) + '.sql'; l.click(); setTimeout(() => URL.revokeObjectURL(u), 2000); } }
    else if (a === 'markapplied') emMarkApplied();
  });
  const onField = ev => {
    const t = ev.target, ctx = t.getAttribute('data-ctx');
    if (t.id === 'em-q') { EM.q = t.value; return emRenderList(); }
    if (t.id === 'em-cq') { EM.cloneQ = t.value; return emRenderCloneList(); }
    if (t.id === 'em-fq') { EM.famQ = t.value; const pos = t.selectionStart; emRender(); const el = document.getElementById('em-fq'); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) {} } return; }
    if (t.hasAttribute('data-apf')) { EM.applyFam[t.getAttribute('data-apf')] = t.checked; return; }
    if (!ctx) return;
    const d = ctx === 'add' ? EM.add : EM.draft; if (!d) return;
    if (t.hasAttribute('data-f')) d[t.getAttribute('data-f')] = t.value;
    else if (t.hasAttribute('data-l')) d.lim[t.getAttribute('data-l')] = t.value;
    else if (t.hasAttribute('data-p')) { const p = t.getAttribute('data-p'), i = d.params.indexOf(p); if (t.checked && i < 0) d.params.push(p); if (!t.checked && i >= 0) d.params.splice(i, 1); }
    else if (t.hasAttribute('data-s')) { d[t.getAttribute('data-s')] = t.value; if (EM.place) { EM.place = null; emRefreshPlacement(); } }
    emRefreshPreviews(ctx);
  };
  body.addEventListener('input', onField);
  body.addEventListener('change', onField);
})();
