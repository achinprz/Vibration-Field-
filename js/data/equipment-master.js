/* VibeMon — equipment master map and department resolution */

/* ===== EQUIPMENT MASTER — SINGLE SOURCE OF TRUTH FOR DEPARTMENT =====
   Equipment Master (Department = Column K) is loaded ONCE and cached into an
   in-memory map (EQUIP_MAP) that is reused everywhere: Data Entry, Previous
   Readings, Bulk Template Download, History and Schedule Log. */
const EQUIP_MAP = Object.create(null);

function _eqKey(s){ return String(s==null?'':s).trim().toLowerCase().replace(/\s+/g,' '); }

// Department field name variants (legacy compatibility kept for any imported data)
// (Column K = "Department" / "Dept" / "Resp Dept" ...). Normalise them all.
function _masterDeptOf(m){
  if(!m) return '';
  // Cover every possible field name for the dept value
  const keys=['dept','department','Dept','Department','DEPT','DEPARTMENT',
              'respDept','responsibleDept','Responsible_Dept','Responsible Dept',
              'resp_dept','K','k','colK',
              // Additional variants for backward compat with imported data:
              'responsible_dept','Responsible_dept','resp dept','Resp Dept',
              'RespDept','RESP_DEPT','deptName','DeptName','deptname','DEPTNAME'];
  for(const k of keys){
    const v=m[k];
    if(v!=null && String(v).trim()!=='' && String(v).trim()!=='undefined') return String(v).trim();
  }
  // Last resort: scan all keys of the master object for anything that looks like a dept value
  for(const k of Object.keys(m)){
    const kl=k.toLowerCase();
    if((kl.includes('dept')||kl.includes('department')||kl==='k')&&m[k]){
      const v=String(m[k]).trim();
      if(v && v!=='undefined' && v.length<=10) return v; // dept codes are short
    }
  }
  return '';
}

// Build the map once per Equipment Master load.
function buildEquipmentMap(){
  for(const k in EQUIP_MAP) delete EQUIP_MAP[k];
  (MASTER||[]).forEach(m=>{
    const dept=_masterDeptOf(m);
    m.dept=dept;                       // normalise onto the master record itself
    const info={ name:m.name, code:m.code||m.equipCode||m.id||'', department:dept,
                 dept:dept, unit:m.unit||'', area:m.area||'', frequency:m.frequency,
                 points:m.points||[], params:m.params||[], master:m };
    [m.name, m.code, m.equipCode, m.id].forEach(k=>{
      const key=_eqKey(k);
      if(key) EQUIP_MAP[key]=info;
    });
    // Master departments extend the picklist (no hardcoded mapping tables)
    if(dept && !DEPTS_LIST.includes(dept)) DEPTS_LIST.push(dept);
  });
  console.log('[EquipmentMaster] map built:', Object.keys(EQUIP_MAP).length, 'keys');
}

// O(1) lookup by equipment name OR equipment code.
function equipInfo(equip){ return EQUIP_MAP[_eqKey(equip)] || null; }

// Department straight from Equipment Master (Column K). '' when unknown.
function deptFromMaster(equip){ const i=equipInfo(equip); return i? (i.department||'') : ''; }

// Sort measurement point rows by the Equipment Master route sequence.
// Points not found in the master order are appended at the end in their original order.
function sortRowsByMasterPoints(rows, equipment) {
  const info = equipInfo(equipment);
  if (!info || !info.points || !info.points.length) return rows; // no master order — keep as-is
  const masterOrder = info.points.map(p => String(p).trim().toUpperCase());
  const masterIdx = pt => {
    const idx = masterOrder.indexOf(String(pt).trim().toUpperCase());
    return idx === -1 ? masterOrder.length : idx; // unknowns go to end
  };
  return [...rows].sort((a, b) => masterIdx(a.point) - masterIdx(b.point));
}

// Preserve-existing rule: keep the value already on the record, else use master.
function resolveDept(existing, equip){
  const e=String(existing==null?'':existing).trim();
  return e || deptFromMaster(equip);
}

// Resolve responsible dept for an equipment exception:
// reads the dept entered on the reading directly (no external sheet fallback).
function excDeptFor(equipment, readingDept) {
  const rd = (readingDept || '').trim();
  if (rd) return rd;
  // Fallback: look for the most recent Alert/Critical reading for this equipment
  // that has a dept assigned, in case this specific reading row doesn't have one.
  const alertRows = READINGS.filter(r =>
    r.equipment === equipment &&
    ['ALERT','CRITICAL','ALARM'].includes(r.severity) &&
    r.responsibleDept
  );
  if (alertRows.length) {
    return alertRows.sort((a,b) => (b.date||'').localeCompare(a.date||''))[0].responsibleDept;
  }
  // Final fallback: Equipment Master (Column K) — single source of truth
  return (typeof deptFromMaster === 'function') ? deptFromMaster(equipment) : '';
}
