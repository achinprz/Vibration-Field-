/* VibeMon — Daily Schedule tab (team maps, calendar, compliance) */

const USER_TEAM_MAP = {
  '4000361991': 'Precise',
  '4000352155': 'CB',
  '4000352156': 'CBA'
};
const TEAM_NAME = { 'Precise':'Precise Group', 'CB':'Chaitanya Bharthi Group', 'CBA':'Chaitanya Bharthi Group A', 'ALL':'All Groups' };
// Reverse map: team -> Set of usernames that belong to it
const TEAM_USERS = {};
const ALL_MAPPED_USERS = new Set();
Object.entries(USER_TEAM_MAP).forEach(([u,t])=>{ (TEAM_USERS[t]=TEAM_USERS[t]||new Set()).add(u); ALL_MAPPED_USERS.add(u); });
function userBelongsToTeam(reading, team) {
  if (!team || team === 'ALL') return true;
  const ru = (reading.username||'').trim();
  if (!ru) return true; // no username info → count for any team
  // If user is mapped to a specific team, only count for that team
  const userTeam = USER_TEAM_MAP[ru];
  if (userTeam) return userTeam === team;
  // User not in any team mapping → count for all teams (backward compat)
  return true;
}
const PERF_KEY = 'vibemon_monthly_perf_v1';

function dsCurrentTeam(){
  let A = null;
  try { A = (typeof AUTH !== 'undefined') ? AUTH : null; } catch(e){}
  if(!A){
    try { A = JSON.parse(localStorage.getItem('vibromon_auth_v2')||'null'); } catch(e){}
  }
  const role = (A && A.role) || 'viewer';
  if(role==='admin'){
    const sel = document.getElementById('ds-team-admin') || document.getElementById('dp-team-admin');
    const v = sel ? sel.value : 'auto';
    if(v && v!=='auto') return v;
    // admin default: Precise
    return 'Precise';
  }
  const u = (A && A.username) || '';
  return USER_TEAM_MAP[u] || USER_TEAM_MAP[String(u).trim()] || null;
}

function dsWorkingDaysOfMonth(year, month){
  // month: 0-indexed. Returns array of Date objects (non-Sundays), max 23.
  const days=[]; const last=new Date(year,month+1,0).getDate();
  for(let d=1; d<=last; d++){
    const dt=new Date(year,month,d);
    if(dt.getDay()!==0){ days.push(dt); if(days.length>=23) break; }
  }
  return days;
}
function dsDateToWD(dt){
  const wds = dsWorkingDaysOfMonth(dt.getFullYear(), dt.getMonth());
  const ds = dt.toDateString();
  const idx = wds.findIndex(d=>d.toDateString()===ds);
  return idx>=0 ? idx+1 : null;
}
function dsWDDate(year, month, wd){
  const wds = dsWorkingDaysOfMonth(year,month);
  return wds[wd-1] || null;
}
function dsFmt(dt){ const p=n=>String(n).padStart(2,'0'); return `${dt.getFullYear()}-${p(dt.getMonth()+1)}-${p(dt.getDate())}`; }

// Count of DISTINCT reading dates for an equipment within a given month (any inspector / team),
// optionally limited to on-or-before uptoStr (YYYY-MM-DD). Source of truth = READINGS (the database).
function normalizeEquipName(name) {
  if (!name) return '';
  return String(name)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .trim();
}

// Source of truth for schedule COMPLIANCE.
// Uses the live READINGS array (fetched from Supabase) directly.
// COMPLIANCE_LOG is kept as a legacy alias but always mirrors READINGS so
// schedule completion, missed status, and reading dates are always accurate.
let COMPLIANCE_LOG = [];

function dsReadingsArr(){
  // Always use live READINGS from Supabase — COMPLIANCE_LOG was always empty
  // which caused every equipment to appear as "Missed" even when readings existed.
  return (typeof READINGS !== 'undefined' && READINGS.length > 0) ? READINGS : COMPLIANCE_LOG;
}

// compliance_log removed — schedule completion derived from readings
async function fetchComplianceLog(){ return true; }

function dsReadingDaysCount(equipName, y, m, uptoStr){
  const mk = `${y}-${String(m+1).padStart(2,'0')}`;
  const set = new Set();
  const target = normalizeEquipName(equipName);
  (dsReadingsArr()||[]).forEach(r => {
    if(normalizeEquipName(r.equipment) !== target) return;
    const ds = (r.date||'').slice(0,10);
    if(ds.slice(0,7) !== mk) return;          // same year-month
    if(uptoStr && ds > uptoStr) return;       // not in the future
    set.add(ds);
  });
  return set.size;
}

// ── OCCURRENCE MATCHING ─────────────────────────────────────────────────────────────────────
// Every scheduled visit of an equipment is an "occurrence" (team + working day). A reading is matched to the
// occurrence whose WINDOW contains its date. Windows split the month at the midpoint between two consecutive
// planned visits of the same equipment (across ALL teams), so:
//   • a reading taken a little EARLY counts for the upcoming visit (that date shows as done early),
//   • a reading taken a little LATE counts for the visit that was missed,
//   • one reading can never fill two visits, and one team's reading never fills the other team's later visit.
// Each occurrence ends up as one of:  own   – read by the team that was scheduled (or an unmapped account)
//                                     other – read only by a different team (shown yellow: covered)
//                                     (none) – not read yet → Upcoming / Pending / Missed (red)
const DS_INSPECTOR_TEAM = { 'PRECISE GROUP':'Precise', 'CHAITANYA BHARTHI GROUP':'CB', 'CHAITANYA BHARTHI GROUP A':'CBA' };
function dsReaderTeam(r){
  const u = String(r.username||'').trim();
  if(USER_TEAM_MAP[u]) return USER_TEAM_MAP[u];
  return DS_INSPECTOR_TEAM[String(r.inspector||'').trim().toUpperCase()] || '';   // '' = not a team account (e.g. admin)
}
let _dsOccMemo = null;
// Returns { team: { 'WD|EQUIP': {state:'own'|'other', date:'YYYY-MM-DD', by:'Precise'|'CB'|'CBA'|'', insp:'…', delta:days} } }
function dsOccurrenceStates(y, m, uptoStr){
  const rd = dsReadingsArr() || [];
  const S = dsScheduleFor(y, m);   // the schedule version in force in that month
  const sig = [y, m, uptoStr||'', rd.length, dsVersionFor(y, m), JSON.stringify(Object.keys(S).map(t=>Object.keys(S[t]||{}).length))].join('|');
  if(_dsOccMemo && _dsOccMemo.sig === sig && Date.now() - _dsOccMemo.t < 300) return _dsOccMemo.val;
  const wds = dsWorkingDaysOfMonth(y,m);
  const lastDay = new Date(y,m+1,0).getDate();
  const mk = `${y}-${String(m+1).padStart(2,'0')}`;
  // 1. all occurrences per equipment (every team)
  const occ = {};
  Object.keys(S).forEach(team=>{
    wds.forEach((dt,i)=>{
      const items = (S[team] && S[team][String(i+1)]) || [];
      items.forEach(it=>{
        if(!it || !it.n) return;
        const k = normalizeEquipName(it.n);
        (occ[k] = occ[k] || []).push({ team, key:(i+1)+'|'+it.n, day: dt.getDate() });
      });
    });
  });
  // 2. readings of this month, per equipment and date
  const reads = {};
  rd.forEach(r=>{
    if(!r.equipment || !r.date) return;
    const ds = String(r.date).slice(0,10);
    if(ds.slice(0,7) !== mk) return;
    if(uptoStr && ds > uptoStr) return;
    const k = normalizeEquipName(r.equipment);
    if(!occ[k]) return;
    const byDate = (reads[k] = reads[k] || {});
    const e = (byDate[ds] = byDate[ds] || { teams: new Set(), insp: {} });
    const t = dsReaderTeam(r);
    e.teams.add(t);
    if(!e.insp[t]) e.insp[t] = r.inspector || r.username || '';
  });
  // 3. match readings to occurrences
  const out = {};
  Object.keys(occ).forEach(k=>{
    const list = occ[k];
    const days = Array.from(new Set(list.map(o=>o.day))).sort((a,b)=>a-b);
    const dates = reads[k] ? Object.keys(reads[k]).sort() : [];
    if(!dates.length) return;
    list.forEach(o=>{
      const ix = days.indexOf(o.day);
      const lo = ix === 0 ? 1 : Math.floor((days[ix-1] + o.day)/2) + 1;
      const hi = ix === days.length-1 ? lastDay : Math.floor((o.day + days[ix+1])/2);
      let own = null, other = null;
      dates.forEach(ds=>{
        const d = parseInt(ds.slice(8,10),10);
        if(d < lo || d > hi) return;
        const e = reads[k][ds], dist = Math.abs(d - o.day);
        if(e.teams.has(o.team) || e.teams.has('')){ if(!own || dist < own.dist) own = { ds, d, dist, e }; }
        else if(!other || dist < other.dist) other = { ds, d, dist, e };
      });
      const b = own || other;
      if(!b) return;
      const by = own ? (b.e.teams.has(o.team) ? o.team : '') : (Array.from(b.e.teams).find(t=>t && t !== o.team) || '');
      (out[o.team] = out[o.team] || {})[o.key] = { state: own ? 'own' : 'other', date: b.ds, by, insp: b.e.insp[by] || '', delta: b.d - o.day };
    });
  });
  _dsOccMemo = { sig, t: Date.now(), val: out };
  return out;
}

// Completion map for one team's month — visits read by that team itself. Returns { 'WD|EQUIP': true, ... }.
function dsMonthDone(team, y, m, uptoStr){
  const st = dsOccurrenceStates(y,m,uptoStr)[team] || {};
  const done = {};
  Object.keys(st).forEach(k=>{ if(st[k].state === 'own') done[k] = true; });
  return done;
}

// Back-compat: true if equipment analysed in dt's month (any inspector), up to today.
function dsEquipDoneOn(team, dt, equipName){
  const wd = dsDateToWD(dt);
  if(!wd) return false;
  const today = new Date(); today.setHours(0,0,0,0);
  const map = dsMonthDone(team, dt.getFullYear(), dt.getMonth(), dsFmt(today));
  return !!map[wd+'|'+equipName];
}

// Returns the scheduled equipment list for a given working day, merged across ALL teams
// (deduped by equipment name) when team === 'ALL'; otherwise the single team's list.
function dsItemsForTeamWD(team, wd, y, m){
  if(y === undefined){ y = DS_VIEW.y; m = DS_VIEW.m; }   // default: the month on screen
  const S = dsScheduleFor(y, m);
  if(team === 'ALL'){
    const seen = {}; const merged = [];
    Object.keys(S).forEach(t=>{
      const items = (S[t] && S[t][String(wd)]) || [];
      items.forEach(it=>{
        if(!it || !it.n) return;
        const key = normalizeEquipName(it.n);
        if(!seen[key]){ seen[key]=true; merged.push(it); }
      });
    });
    return merged;
  }
  return (S[team] && S[team][String(wd)]) || [];
}

// Returns the completion map for a month, merged across ALL teams when team === 'ALL'.
function dsMonthDoneAny(team, y, m, uptoStr){
  if(team === 'ALL'){
    const merged = {};
    Object.keys(VIBE_SCHEDULE).forEach(t=>{ Object.assign(merged, dsMonthDone(t,y,m,uptoStr)); });
    return merged;
  }
  return dsMonthDone(team, y, m, uptoStr);
}

// Counts done status using ANY reading (regardless of which team took it)
// Used to detect "covered by other group" in the schedule table
function dsMonthDoneUnfiltered(team, y, m, uptoStr){
  const st = dsOccurrenceStates(y,m,uptoStr)[team] || {};
  const done = {};
  Object.keys(st).forEach(k=>{ done[k] = true; });   // read by its own team OR covered by another team
  return done;
}

let DS_VIEW = { y: new Date().getFullYear(), m: new Date().getMonth(), sel: null };

// Keep the team filter on the 📅 Daily Schedule and ⏳ Pending Daily Schedule tabs
// in lock-step: changing one mirrors the value to the other and re-renders both,
// so switching tabs always shows the same group's data.
async function reloadScheduleNow(){
  const ok = await fetchVibeSchedule();
  try { dsRender(); } catch(e){}
  return ok;
}

function dsSyncTeamSelect(value){
  ['ds-team-admin','dp-team-admin'].forEach(id=>{
    const s = document.getElementById(id);
    if(s && s.value !== value) s.value = value;
  });
  try { dsRender(); } catch(e){ console.error('dsRender (sync) failed:', e); }
}

function dsRender(){
  try { if (typeof dsqRefresh === 'function') dsqRefresh(); } catch(e) {}   // keep the equipment search in step with month / data changes
  try { if (typeof dsvGuard === 'function') dsvGuard(); } catch(e) {}
  const team = dsCurrentTeam();
  const userPill = document.getElementById('ds-user-pill');
  const adminSel = document.getElementById('ds-team-admin');
  if(adminSel) adminSel.style.display = (AUTH.role==='admin')?'inline-block':'none';
  if(!team){
    if(userPill) userPill.textContent = 'No group assigned — contact admin';
    const cal = document.getElementById('ds-cal'); if(cal) cal.innerHTML='';
    return;
  }
  if(userPill) userPill.textContent = TEAM_NAME[team] || team;
  const y=DS_VIEW.y, m=DS_VIEW.m;
  document.getElementById('ds-month-label').textContent =
    new Date(y,m,1).toLocaleDateString(undefined,{month:'long',year:'numeric'});
  const wds = dsWorkingDaysOfMonth(y,m);
  const firstDow = new Date(y,m,1).getDay(); // 0=Sun
  const last = new Date(y,m+1,0).getDate();
  const today = new Date(); today.setHours(0,0,0,0);
  // Status of every scheduled visit: read by the scheduled team (green), read only by another team (yellow), not read (red/upcoming)
  let stMap = {}, allStates = {};
  try {
    allStates = dsOccurrenceStates(y, m, dsFmt(today));
    if (team === 'ALL') {   // admin "All groups" view: any reading counts as done
      Object.keys(allStates).forEach(t=>{ Object.keys(allStates[t]).forEach(k=>{ stMap[k] = Object.assign({}, allStates[t][k], { state:'own' }); }); });
    } else stMap = allStates[team] || {};
  } catch(e){ console.error('dsOccurrenceStates failed:', e); }
  window.DS_STATE = stMap;
  window.DS_STATE_ALL = allStates;
  // Dynamic Recovery: load this month's catch-up assignments (cached ~60s) and merge them in once fetched.
  if (typeof dyLoadMonth === 'function') {
    dyLoadMonth(y, m).then(res => {
      if (res.fresh && DS_VIEW.y === y && DS_VIEW.m === m) dsRender();
      try { dyRenderPanel(); } catch (e) {}
    });
  }
  const cal = document.getElementById('ds-cal');
  let html='';
  ['S','M','T','W','T','F','S'].forEach(d=> html+=`<div class="dow">${d}</div>`);
  for(let i=0;i<firstDow;i++) html+='<div class="ds-day empty"></div>';
  for(let d=1; d<=last; d++){
    const dt=new Date(y,m,d); dt.setHours(0,0,0,0);
    const isSun=dt.getDay()===0;
    const wdIdx = wds.findIndex(x=>x.getDate()===d);
    const wd = wdIdx>=0?wdIdx+1:null;
    let cls='ds-day';
    if(isSun) cls+=' sunday';
    if(dt.getTime()===today.getTime()) cls+=' today';
    let prog=0, dst='';
    const dateStr = dsFmt(dt);
    const catchups = (typeof dyActiveFor === 'function') ? dyActiveFor(y, m, team, dateStr) : [];
    const items = wd ? dsItemsForTeamWD(team, wd) : [];
    if(items.length || catchups.length){
      let own=0, other=0;
      items.forEach(it=>{ const s = stMap[wd+'|'+it.n]; if(s){ if(s.state==='own') own++; else other++; } });
      catchups.forEach(c=>{ const os = (window.DS_STATE_ALL[c.original_team]||{})[c.original_day+'|'+c.equipment]; if(os){ if(os.state==='own') own++; else other++; } });
      const total = items.length+catchups.length, open = total-own-other;
      prog = total?Math.round((own+other)/total*100):0;
      const fullClass = other ? ' covered' : ' done';
      if(dt < today){
        if(own+other===0) cls+=' pending';          // red: nobody took any of it
        else if(open>0) cls+=' partial';             // some still missing
        else cls+=fullClass;                         // green (own) / yellow (some covered by another group)
      } else if(dt.getTime()===today.getTime()){
        if(open===0) cls+=fullClass; else if(own+other>0) cls+=' partial';
      } else if(open===0) cls+=fullClass;            // whole day already read ahead of time
      if(dt <= today){ const parts=[]; if(own) parts.push('✓'+own); if(other) parts.push('⚠'+other); if(open && dt<today) parts.push('✗'+open); dst = parts.join(' '); }
      else if(own+other) dst = '✓'+(own+other)+' early';
      if(catchups.length) { cls += ' has-catchup'; dst += (dst?' · ':'') + '🔁'+catchups.length; }
    }
    if(DS_VIEW.sel===d) cls+=' selected';
    html += `<div class="${cls}" onclick="${isSun?'':'dsSelectDay('+d+')'}">
      <div class="dnum">${d}</div>
      ${isSun?'<div class="dwd">Off</div>':(wd?`<div class="dwd">WD${wd} · ${items.length+catchups.length}</div>`:(catchups.length?`<div class="dwd">Reserve · ${catchups.length}</div>`:''))}
      ${dst?`<div class="dst">${dst}</div>`:''}
      ${(prog>0 && !isSun)?`<div class="dprog"><i style="width:${prog}%"></i></div>`:''}
    </div>`;
  }
  cal.innerHTML = html;
  try { dsFitCalendar(); } catch(e) {}
  // Auto-select today if same month
  if(today.getFullYear()===y && today.getMonth()===m && !DS_VIEW.sel) DS_VIEW.sel = today.getDate();
  try {
    if(DS_VIEW.sel) dsSelectDay(DS_VIEW.sel, true); else { document.getElementById('ds-sel-empty').style.display='block'; document.getElementById('ds-sel-wrap').style.display='none'; }
  } catch(e){ console.error('dsSelectDay failed:', e); }
  try { dsRenderPerf(); } catch(e){ console.error('dsRenderPerf failed:', e); }
  try { dyRenderPanel(); } catch(e){}
  if (today.getFullYear()===y && today.getMonth()===m) { try { dyAutoRunIfDue(); } catch(e){} }
}
function dsSelectDay(d, keep){
  DS_VIEW.sel = d;
  const team = dsCurrentTeam(); if(!team) return;
  const dt = new Date(DS_VIEW.y, DS_VIEW.m, d); dt.setHours(0,0,0,0);
  document.querySelectorAll('#ds-cal .ds-day').forEach(el=>el.classList.remove('selected'));
  // re-mark
  const cells = document.querySelectorAll('#ds-cal .ds-day:not(.empty)');
  // simpler: re-render? avoid recursion
  if(!keep) dsRender();
  const _scrollToTable = !keep;
  const isSun = dt.getDay()===0;
  const wd = dsDateToWD(dt);
  const dateStr = dsFmt(dt);
  const baseItems = wd ? dsItemsForTeamWD(team, wd) : [];
  const catchups = (typeof dyActiveFor === 'function') ? dyActiveFor(DS_VIEW.y, DS_VIEW.m, team, dateStr) : [];
  // One list: native items keep their own (team,wd) identity; catch-up items keep the ORIGINAL
  // team/wd they belong to, so their status is looked up from where they were actually scheduled.
  const items = baseItems.map(it=>({ n:it.n, u:it.u, a:it.a, f:it.f, l:it.l, _team:team, _wd:wd, _cu:false }))
    .concat(catchups.map(c=>{ const inf = dsScheduleInfo(c.equipment); return ({ n:c.equipment, u:'', a:'', f:inf.f, l:c.location || inf.l, _team:c.original_team, _wd:c.original_day, _cu:true, _srcTeam:c.assigned_team, _origDate:c.original_date, _source:c.source, _id:c.id }); }));
  document.getElementById('ds-sel-title').textContent =
    dt.toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'short',year:'numeric'}) +
    (wd?` — Working Day ${wd}`:(catchups.length?' — Reserve day':(isSun?' — Sunday (Off)':'')));
  document.getElementById('ds-sel-meta').textContent = items.length?`${items.length} equipment scheduled${catchups.length?` (${catchups.length} catch-up)`:''}`:'';
  if(!items.length){
    document.getElementById('ds-sel-empty').style.display='block';
    document.getElementById('ds-sel-empty').textContent = isSun?'Sunday — no schedule.':'No schedule for this day.';
    document.getElementById('ds-sel-wrap').style.display='none'; return;
  }
  document.getElementById('ds-sel-empty').style.display='none';
  document.getElementById('ds-sel-wrap').style.display='';
  if (_scrollToTable) { try { document.getElementById('ds-sel-title').closest('.card').scrollIntoView({ behavior:'smooth', block:'start' }); } catch(e) {} }
  const today = new Date(); today.setHours(0,0,0,0);
  const tbody = document.getElementById('ds-sel-body');
  const allStatesFull = window.DS_STATE_ALL || dsOccurrenceStates(DS_VIEW.y, DS_VIEW.m, dsFmt(today));
  tbody.innerHTML = items.map((it,i)=>{
    const stMapFor = allStatesFull[it._team] || {};
    const s = stMapFor[it._wd+'|'+it.n];               // reading that fulfils THIS visit (if any)
    const ownDone = !!s && s.state === 'own';         // taken by the scheduled group → green
    const coveredByOther = !!s && s.state === 'other';// taken by another group → yellow
    const future = dt > today;

    let readDateStr = '—', completedBy = '—', timing = '';
    if (s) {
      readDateStr = dsShortDate(s.date);
      completedBy = s.by ? (TEAM_NAME[s.by] || s.by) : (s.insp || '—');
      if (s.delta) timing = `<div class="dsmeta">${Math.abs(s.delta)} d ${s.delta < 0 ? 'early' : 'late'}</div>`;
    }

    // the row colour says what happened to this visit (the old Status column is gone):
    // green = read by its own group, yellow = covered by another group, blue = upcoming, orange = due today, red = missed
    let rowBg, stateTip;
    if (ownDone) { rowBg = 'background:#D5F5E3'; stateTip = 'Done'; }
    else if (coveredByOther) { rowBg = 'background:#FEF08A'; stateTip = 'Covered by ' + completedBy; }
    else if (future) { rowBg = 'background:#EFF6FF'; stateTip = 'Upcoming'; }
    else if (dt.getTime()===today.getTime()) { rowBg = 'background:#FFEDD5'; stateTip = 'Pending today'; }
    else { rowBg = 'background:#FEE2E2'; stateTip = 'Missed'; }
    // last reading of this machine before this visit's reading (or, if not read yet, the latest one so far)
    const refDate = s ? s.date : (future ? dsFmt(new Date(today.getTime() + 864e5)) : dsFmt(dt));
    const lastR = dsLastReadingBefore(it.n, refDate);
    const lastHtml = lastR ? `<span class="dslast">${dsShortDate(lastR.date)}</span><div class="dsmeta">${escHtml(lastR.by)}</div>` : '<span style="color:#6b7280">—</span>';
    const eqObj = MASTER.find(m=>m.name===it.n) || MASTER.find(m=>normalizeEquipName(m.name)===normalizeEquipName(it.n));
    const dispUnit = it.u || (eqObj && eqObj.unit) || '';
    const dispArea = it.a || (eqObj && eqObj.area) || '';
    const dispLoc  = it.l || dsScheduleInfo(it.n).l || '';
    const canClick = !ownDone && eqObj && AUTH.role !== 'viewer';
    // Catch-up rows get a purple left-accent (on top of, not instead of, the normal status colour)
    // plus a badge — so both "what happened" and "is this a re-assigned reading" are visible at once.
    const cuStyle = it._cu ? 'box-shadow:inset 4px 0 0 #7C3AED;' : '';
    const clickAttr = canClick ? `style="cursor:pointer;${cuStyle}${rowBg}" onclick="openEquipmentForEntry(${jsArg(it.n)},'daily')" title="${escHtml(stateTip)} — click to take reading"` : `style="${cuStyle}${rowBg}" title="${escHtml(stateTip)}"`;
    const cuBadge = it._cu ? `<div><span class="cu-badge"title="Originally due ${escHtml(it._origDate)} for ${escHtml(TEAM_NAME[it._team]||it._team)} — moved here (${escHtml(DY_SRC_LABEL[it._source]||it._source)})">🔁 Catch-up</span></div>` : '';
    const cuUndo = (it._cu && typeof AUTH!=='undefined' && AUTH.role==='admin') ? `<button class="btn btn-sm" style="color:#7C3AED;border-color:#7C3AED" onclick="event.stopPropagation();dyUndo(${it._id})" title="Undo this catch-up — equipment goes back to Missed until reassigned">↩ Undo</button>` : '';
    const actionHtml = `<td class="actcell" data-label="Action"><div class="dsa">
      ${canClick ? `<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();openEquipmentForEntry(${jsArg(it.n)},'daily')" title="Take Reading">📝 Take Reading</button>` : ''}
      <button class="btn btn-sm" onclick="event.stopPropagation();viewEquipHistory(${jsArg(it.n)})">👁 History</button>
      ${cuUndo}
    </div></td>`;
    return `<tr ${clickAttr} class="${ownDone?'done':''}"><td data-label="#">${i+1}</td><td class="eqcell" data-label="Equipment"><strong>${escHtml(it.n)}</strong>${dsEquipMeta(dispUnit, dispArea, it.f)}${cuBadge}</td><td data-label="Loc">${escHtml(dispLoc)}</td><td data-label="Last reading">${lastHtml}</td><td data-label="Completed by" style="font-size:11px;color:${coveredByOther?'#92400E':'var(--muted)'}${coveredByOther?';font-weight:700':''}">${escHtml(completedBy)}</td><td data-label="Reading date" style="font-weight:600;color:${ownDone?'var(--green-text)':coveredByOther?'#92400E':'var(--text)'}">${readDateStr}${timing}</td>${actionHtml}</tr>`;
  }).join('');
}
function dsPrevMonth(){ DS_VIEW.m--; if(DS_VIEW.m<0){DS_VIEW.m=11;DS_VIEW.y--;} DS_VIEW.sel=null; dsRender(); }
function dsNextMonth(){ DS_VIEW.m++; if(DS_VIEW.m>11){DS_VIEW.m=0;DS_VIEW.y++;} DS_VIEW.sel=null; dsRender(); }
function dsToday(){ const t=new Date(); DS_VIEW.y=t.getFullYear(); DS_VIEW.m=t.getMonth(); DS_VIEW.sel=t.getDate(); dsRender(); }


// Size the calendar rows so the whole month (and its legend) fits in the window: no page scrolling to see it.
// Rows shrink to a compact one-line cell when the window is short, and grow (up to 96px) when there is room.
function dsFitCalendar() {
  const cal = document.getElementById('ds-cal');
  if (!cal || !cal.offsetParent) return;
  const rows = Math.ceil((new Date(DS_VIEW.y, DS_VIEW.m, 1).getDay() + new Date(DS_VIEW.y, DS_VIEW.m + 1, 0).getDate()) / 7);
  const legend = cal.parentElement && cal.parentElement.querySelector('.ds-legend');
  const top = cal.getBoundingClientRect().top + (window.scrollY || 0);
  const reserve = (legend ? legend.offsetHeight + 8 : 0) + 26;               // legend + card padding + breathing room
  const avail = window.innerHeight - top - reserve;
  const gap = 3, dowH = 22;
  let h = Math.floor((avail - dowH - gap * rows - 6) / rows);
  h = Math.max(34, Math.min(96, h));
  cal.style.gridTemplateRows = dowH + 'px';
  cal.style.gridAutoRows = h + 'px';
  cal.classList.toggle('compact', h < 56);
}
window.addEventListener('resize', () => { try { dsFitCalendar(); } catch(e) {} });


// "2026-09-14" -> "14/09/2026"
function dsShortDate(ds) {
  const p = String(ds || '').slice(0, 10).split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(ds || '');
}
// Every reading of every machine, oldest -> newest, with the group that took it (rebuilt only when READINGS changes)
let _dsLastIdx = null;
function dsLastIndex() {
  const rd = (typeof dsReadingsArr === 'function' ? dsReadingsArr() : []) || [];
  const sig = rd.length + '|' + (rd.length ? String(rd[0].date) + String(rd[rd.length - 1].date) : '');
  if (_dsLastIdx && _dsLastIdx.sig === sig) return _dsLastIdx.map;
  const map = {};
  rd.forEach(r => {
    if (!r.equipment || !r.date) return;
    const k = normalizeEquipName(r.equipment), ds = String(r.date).slice(0, 10);
    const t = dsReaderTeam(r);
    const by = t ? (TEAM_NAME[t] || t) : String(r.inspector || r.username || '').trim();
    const arr = (map[k] = map[k] || []);
    const last = arr[arr.length - 1];
    if (last && last.date === ds && last.by === by) return;   // same group, same day (several points of one session)
    arr.push({ date: ds, by });
  });
  Object.keys(map).forEach(k => map[k].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  _dsLastIdx = { sig, map };
  return map;
}
// The latest reading of a machine taken STRICTLY BEFORE beforeStr (YYYY-MM-DD): {date, by} or null.
// (A reading taken on that very day is skipped, so for a visit that was just read it shows the reading before it.)
function dsLastReadingBefore(equip, beforeStr) {
  const arr = dsLastIndex()[normalizeEquipName(equip)];
  if (!arr) return null;
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i].date < beforeStr) {
    // if several groups read on that same date, list them all
    const same = arr.filter(x => x.date === arr[i].date).map(x => x.by).filter((v, j, a) => v && a.indexOf(v) === j);
    return { date: arr[i].date, by: same.join(' + ') };
  }
  return null;
}
// "Fortnightly" -> "Fortn","EVERY 10 DAYS" -> "10-day": short enough to sit on the small line under the equipment name
function dsFreqShort(f) {
  const u = String(f || '').toUpperCase().trim();
  if (!u) return '';
  if (/WEEK/.test(u)) return 'Wkly';
  if (/10/.test(u)) return '10-day';
  if (/FORT/.test(u)) return 'Fortn';
  if (/MONTH/.test(u)) return 'Mthly';
  return u.slice(0, 6);
}
// the small grey line under an equipment name: unit · area · frequency
function dsEquipMeta(unit, area, freq) {
  const parts = [unit, area].map(x => String(x || '').trim()).filter(Boolean).map(escHtml);
  const fs = dsFreqShort(freq);
  if (fs) parts.push('<span title="' + escHtml(String(freq)) + '">' + fs + '</span>');
  return parts.length ? '<div class="dsmeta">' + parts.join(' · ') + '</div>' : '';
}
