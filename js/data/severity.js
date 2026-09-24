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

// Get per-equipment limits — reads from DYNAMIC_EQUIP_LIMITS (loaded from Google Sheet)
// Falls back to SEV_VEL defaults if not found
function getEquipLimits(equipName, type) {
  if (!equipName) return null;
  const el = DYNAMIC_EQUIP_LIMITS[equipName] || DYNAMIC_EQUIP_LIMITS[equipName.trim()];
  if (el) return el;
  // Try matching by MASTER data
  const me = MASTER.find(m => m.name === equipName);
  if (me && me.limits) return me.limits;
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
