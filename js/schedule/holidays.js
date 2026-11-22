/* VibeMon — plant holidays. Shown as GREY bars (like Sundays) in Performance → "Equipment read per day".
   The list lives in Supabase (table app_settings, key 'holidays', JSON [{d:'YYYY-MM-DD', n:'name'}]) so every phone sees the same days.
   Only an admin can change it (button "🗓 Holidays" on that chart). No new SQL is needed — app_settings already exists. */

const HOLIDAYS_KEY = 'holidays';
const HOLIDAYS_CACHE = 'vibemon_holidays_v1';
let HOLIDAYS = (function () {          // { 'YYYY-MM-DD': 'Name' } — last known list, so it also works offline
  try { const c = JSON.parse(localStorage.getItem(HOLIDAYS_CACHE)); if (c && typeof c === 'object' && !Array.isArray(c)) return c; } catch (e) {}
  return {};
})();
let _holOpen = false;

function holidayName(ds) { return HOLIDAYS[ds] || ''; }
function _holCache() { try { localStorage.setItem(HOLIDAYS_CACHE, JSON.stringify(HOLIDAYS)); } catch (e) {} }

async function loadHolidays() {
  try {
    const { data, error } = await _supabase.from('app_settings').select('value').eq('key', HOLIDAYS_KEY).limit(1);
    if (error) throw error;
    const v = data && data[0] && data[0].value;
    if (v) {
      const map = {};
      (JSON.parse(v) || []).forEach(x => { if (x && /^\d{4}-\d{2}-\d{2}$/.test(x.d || '')) map[x.d] = String(x.n || 'Holiday'); });
      HOLIDAYS = map; _holCache();
      try { if (typeof dsRenderDailyBars === 'function' && document.getElementById('ds-perf-daily')) dsRenderDailyBars(); } catch (e) {}
    }
  } catch (e) { console.warn('loadHolidays failed (using the saved copy):', e.message || e); }
}

async function _holSave() {
  const arr = Object.keys(HOLIDAYS).sort().map(d => ({ d, n: HOLIDAYS[d] }));
  const { error } = await _supabase.from('app_settings').upsert({ key: HOLIDAYS_KEY, value: JSON.stringify(arr), updated_by: (AUTH && AUTH.username) || 'admin', updated_on: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
  _holCache();
}

function holidayEditorToggle() { _holOpen = !_holOpen; if (typeof dsRenderDailyBars === 'function') dsRenderDailyBars(); }

// editor panel for the month on screen (admin only — the chart itself is admin-only)
function holidayEditorHtml(y, m) {
  if (!_holOpen) return '';
  const mk = `${y}-${String(m + 1).padStart(2, '0')}`;
  const list = Object.keys(HOLIDAYS).filter(d => d.slice(0, 7) === mk).sort();
  const items = list.length
    ? list.map(d => `<span style="display:inline-flex;align-items:center;gap:6px;background:rgba(156,163,175,.18);border-radius:8px;padding:3px 8px;font-size:12px"><b>${d.slice(8)}</b> ${escHtml(HOLIDAYS[d])}<button onclick="holidayRemove('${d}')" title="Remove" style="background:none;border:none;cursor:pointer;color:var(--text-muted,#6b7280);font-size:14px;line-height:1">&times;</button></span>`).join(' ')
    : '<span style="font-size:12px;color:var(--muted)">No holidays added for this month. Sundays are grey automatically.</span>';
  return `<div style="padding:10px 14px;border-bottom:1px solid var(--border)">
    <div style="font-size:12px;font-weight:700;margin-bottom:6px">🗓 Holidays in this month</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">${items}</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
      <input type="date" id="hol-date" value="${mk}-01" min="${mk}-01" max="${mk}-${String(new Date(y, m + 1, 0).getDate()).padStart(2, '0')}" style="min-width:140px">
      <input type="text" id="hol-name" placeholder="Holiday name (e.g. Diwali)" maxlength="40" style="flex:1;min-width:150px">
      <button class="btn btn-sm btn-primary" onclick="holidayAdd()">＋ Add</button>
    </div></div>`;
}

async function holidayAdd() {
  if (!(AUTH && AUTH.role === 'admin')) return;
  const d = (document.getElementById('hol-date') || {}).value || '';
  const n = ((document.getElementById('hol-name') || {}).value || '').trim() || 'Holiday';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { showToast('Pick a date first.', 'red'); return; }
  const before = HOLIDAYS[d];
  HOLIDAYS[d] = n;
  try { await _holSave(); showToast('✅ Holiday saved.', 'green'); }
  catch (e) { if (before === undefined) delete HOLIDAYS[d]; else HOLIDAYS[d] = before; showToast('Could not save the holiday: ' + (e.message || e), 'red'); }
  dsRenderDailyBars();
}

async function holidayRemove(d) {
  if (!(AUTH && AUTH.role === 'admin')) return;
  const before = HOLIDAYS[d];
  delete HOLIDAYS[d];
  try { await _holSave(); showToast('Holiday removed.', 'green'); }
  catch (e) { HOLIDAYS[d] = before; showToast('Could not save: ' + (e.message || e), 'red'); }
  dsRenderDailyBars();
}
