/* VibeMon — vibration limits, severity calculation, badges */

// (SUCCESS_STORIES feature removed — sheet, actions, and code deleted.)

// Dynamic equipment limits — populated from Equipment Master
const DYNAMIC_EQUIP_LIMITS = {};

// Equipment limits are now loaded dynamically from Google Sheet Equipment Master.
// DYNAMIC_EQUIP_LIMITS is populated by fetchEquipmentMaster().
// Fallback defaults used when sheet not available:
const EQUIP_LIMITS = DYNAMIC_EQUIP_LIMITS;

// Fallback limits when equipment not found in master
const SEV_VEL = {alarm:4.5, alert:7.1, critical:11.2};
const SEV_ACC = {alarm:1.0, alert:3.5, critical:5.0};
const SEV_DIS = {alarm:50,  alert:75, critical:100};
// Decoupled Trial severity limits — velocity only (mm/s): <2.0 Normal, 2.0-2.5 Alarm, 2.5-3.0 Alert, >3.0 Critical
const SEV_DECOUPLED_VEL = {alarm:2.0, alert:2.5, critical:3.0};

// equipment_master.limits in Supabase stores each zone's UPPER bound:
//   {"unit":"mm/s"|"micron", "normal":4.5, "alarm":7.1, "alert":11.2, "critical":11.2}
//   i.e. NORMAL up to 4.5 · ALARM up to 7.1 · ALERT up to 11.2 · CRITICAL from 11.2.
// The severity engine below works with zone START points instead:
//   a = ALARM starts, at = ALERT starts, c = CRITICAL starts, u = 'mic' | 'mm'.
// Reading el.a/el.at/el.c straight off the database object gave undefined, so every
// velocity check silently fell through to NORMAL and the limits banner showed "undefined".
// A missing "alarm" key means the machine has no separate alert tier: ALARM runs to critical.
const _limitsNormCache = new WeakMap();
function normalizeLimits(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (_limitsNormCache.has(raw)) return _limitsNormCache.get(raw);
  const num = v => { const n = parseFloat(v); return isFinite(n) && n > 0 ? n : null; };
  let out = null;
  if (raw.a != null && raw.c != null) {
    out = { a: num(raw.a), at: num(raw.at) ?? num(raw.c), c: num(raw.c), u: raw.u === 'mic' ? 'mic' : 'mm' };
  } else {
    const isMic = /mic/i.test(String(raw.unit || raw.u || ''));
    const def = isMic ? SEV_DIS : SEV_VEL;
    const tops = [num(raw.alert), num(raw.critical)].filter(x => x !== null);
    const c = tops.length ? Math.min(...tops) : null;
    const a = num(raw.normal);
    if (a !== null || c !== null || num(raw.alarm) !== null) {
      const cVal = c ?? def.critical;
      out = { a: a ?? def.alarm, at: num(raw.alarm) ?? cVal, c: cVal, u: isMic ? 'mic' : 'mm' };
    }
  }
  _limitsNormCache.set(raw, out);
  return out;
}

// Get per-equipment limits in engine form ({a, at, c, u}) — null when the machine has none.
function getEquipLimits(equipName, type) {
  if (!equipName) return null;
  const el = DYNAMIC_EQUIP_LIMITS[equipName] || DYNAMIC_EQUIP_LIMITS[equipName.trim()];
  if (el) return normalizeLimits(el);
  const me = MASTER.find(m => m.name === equipName);
  if (me && me.limits) return normalizeLimits(me.limits);
  const info = (typeof equipInfo === 'function') ? equipInfo(equipName) : null;
  if (info && info.master && info.master.limits) return normalizeLimits(info.master.limits);
  return null;
}

function getSev(val, type, equipName, isDecoupled) {
  if(val===''||val===null||val===undefined) return '';
  const v = parseFloat(val);
  if(isNaN(v)||v<0) return '';

  // ── Decoupled Trial limits — apply to velocity, acc, dis uniformly ──
  if (isDecoupled && type === 'vel') {
    const t = SEV_DECOUPLED_VEL;
    if(v>=t.critical) return 'CRITICAL';
    if(v>=t.alert)    return 'ALERT';
    if(v>=t.alarm)    return 'ALARM';
    return 'NORMAL';
  }
  
  // Try per-equipment limits first
  const el = equipName ? getEquipLimits(equipName, type) : null;
  if (el) {
    // For turbines: limits in microns (mic) - apply to Displacement only (dis type)
    // Velocity/Acc readings on turbines are also in mm/s standard
    // "mic" units means it's a turbine with displacement in microns
    const useMic = (el.u === 'mic');
    // For turbine: vel/acc use mm/s standard fallback but dis uses micron limits
    if (useMic && type === 'dis') {
      if(v >= el.c) return 'CRITICAL';
      if(v >= el.at) return 'ALERT';
      if(v >= el.a)  return 'ALARM';
      return 'NORMAL';
    }
    if (!useMic) {
      // mm/s limits apply to velocity; acc still uses standard
      if (type === 'vel') {
        if(v >= el.c) return 'CRITICAL';
        if(v >= el.at) return 'ALERT';
        if(v >= el.a)  return 'ALARM';
        return 'NORMAL';
      }
      if (type === 'acc') {
        // acceleration: use standard thresholds
        const t = SEV_ACC;
        if(v>=t.critical) return 'CRITICAL';
        if(v>=t.alert)    return 'ALERT';
        if(v>=t.alarm)    return 'ALARM';
        return 'NORMAL';
      }
      if (type === 'dis') {
        // displacement for non-turbine: use standard
        const t = SEV_DIS;
        if(v>=t.critical) return 'CRITICAL';
        if(v>=t.alert)    return 'ALERT';
        if(v>=t.alarm)    return 'ALARM';
        return 'NORMAL';
      }
    }
    // turbine vel/acc: fall through to defaults
  }
  
  // Default fallback limits
  const t = type==='acc' ? SEV_ACC : type==='dis' ? SEV_DIS : SEV_VEL;
  if(v>=t.critical) return 'CRITICAL';
  if(v>=t.alert)    return 'ALERT';
  if(v>=t.alarm)    return 'ALARM';
  return 'NORMAL';
}

function worstSev(arr) {
  const rank = {NORMAL:1,ALARM:2,ALERT:3,CRITICAL:4};
  let best = '';
  arr.filter(Boolean).forEach(s => { if(!best || (rank[s]||0)>(rank[best]||0)) best = s; });
  return best || 'NORMAL';
}

function badgeHtml(sev) {
  if(!sev) return '<span class="badge badge-p">—</span>';
  const m = {NORMAL:'badge-n',ALARM:'badge-al',ALERT:'badge-at',CRITICAL:'badge-cr'};
  const labels = {NORMAL:'NORMAL',ALARM:'ALARM (Under Obs.)',ALERT:'ALERT (Attend PM)',CRITICAL:'CRITICAL — STOP!'};
  return `<span class="badge ${m[sev]||'badge-p'}">${labels[sev]||sev}</span>`;
}

function sevColor(s) {
  return s==='CRITICAL'?'#DC2626':s==='ALERT'?'#EA580C':s==='ALARM'?'#D97706':'#166534';
}
