/* VibeMon — monthly performance store, team comparison */

/* === Monthly performance store === */
function dsSavePerf(p){}
function dsSavePerfSnapshot(team, y, m){}
function dsLoadPerf(){
  const p = {};
  const today = new Date();
  
  // Build per-team readings maps: team -> { 'normEq||ym' -> Set(dates) }
  const teamReadingsMap = {};
  (dsReadingsArr() || []).forEach(r => {
    if (!r.date || !r.equipment) return;
    const normEq = normalizeEquipName(r.equipment);
    const ym = r.date.slice(0, 7);
    const ds = r.date.slice(0, 10);
    const key = normEq + '||' + ym;
    // Determine which team this reading belongs to
    Object.keys(VIBE_SCHEDULE).forEach(t => {
      if (userBelongsToTeam(r, t)) {
        if (!teamReadingsMap[t]) teamReadingsMap[t] = {};
        if (!teamReadingsMap[t][key]) teamReadingsMap[t][key] = new Set();
        teamReadingsMap[t][key].add(ds);
      }
    });
  });

  function getReadingDaysCountOpt(equipName, y, m, uptoStr, team) {
    const ym = `${y}-${String(m+1).padStart(2,'0')}`;
    const key = normalizeEquipName(equipName) + '||' + ym;
    const tMap = team ? teamReadingsMap[team] : null;
    const datesSet = tMap ? tMap[key] : null;
    if (!datesSet) return 0;
    if (!uptoStr) return datesSet.size;
    let count = 0;
    datesSet.forEach(ds => {
      if (ds <= uptoStr) count++;
    });
    return count;
  }

  // Same visit-by-visit matching as the Daily Schedule tab (see dsOccurrenceStates): a visit counts when the
  // scheduled group itself took a reading inside that visit's window.
  function getMonthDoneFast(team, y, m, uptoStr) {
    return dsMonthDone(team, y, m, uptoStr);
  }

  const monthsSet = new Set();
  (dsReadingsArr() || []).forEach(r => {
    if (r.date && r.date.length >= 7) {
      monthsSet.add(r.date.slice(0, 7));
    }
  });
  const currentYM = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  monthsSet.add(currentYM);
  
  const teams = Object.keys(VIBE_SCHEDULE);
  
  monthsSet.forEach(ym => {
    const parts = ym.split('-');
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    
    teams.forEach(team => {
      const wds = dsWorkingDaysOfMonth(y, m);
      const doneMap = getMonthDoneFast(team, y, m, dsFmt(today));
      let scheduled = 0, completed = 0;
      
      wds.forEach((dt, i) => {
        if (dt > today) return;
        const items = dsSchedItems(team, i + 1, y, m);   // the schedule version in force in that month
        items.forEach(it => {
          scheduled++;
          if (doneMap[(i + 1) + '|' + it.n]) completed++;
        });
      });
      
      const key = `${y}-${parts[1]}_${team}`;
      p[key] = {
        team,
        year: y,
        month: m + 1,
        scheduled,
        completed,
        pct: scheduled ? Math.round(completed / scheduled * 100) : 0,
        updated: _localNowStr()
      };
    });
  });
  
  return p;
}

function dsRenderPerf(){
  const team = dsCurrentTeam(); if(!team) return;
  try { dsRenderTotalAllGroups(); } catch(e){ console.error('dsRenderTotalAllGroups failed:', e); const el=document.getElementById('ds-perf-total'); if(el) el.innerHTML = '<div style="color:var(--red);font-size:12px">Could not load totals — '+(e&&e.message?e.message:'error')+'</div>'; }
  try { dsRenderCompare(); } catch(e){ console.error('dsRenderCompare failed:', e); }
  try { dsRenderCompareMonthwise(); } catch(e){ console.error('dsRenderCompareMonthwise failed:', e); }
}

function dsRenderTotalAllGroups(){
  const container = document.getElementById('ds-perf-total');
  if(!container) return;
  const y = DS_VIEW.y, m = DS_VIEW.m;
  const today = new Date(); today.setHours(0,0,0,0);
  const monthStart = new Date(y,m,1); monthStart.setHours(0,0,0,0);
  const uptoStr = monthStart>today ? dsFmt(monthStart) : dsFmt(today);
  const teams = Object.keys(VIBE_SCHEDULE);
  const teamColors = { 'Precise': '#3b82f6', 'CB': '#f59e0b', 'CBA': '#10b981' };
  let totalSch = 0, totalDone = 0;
  const stats = teams.map(t=>{
    const wds = dsWorkingDaysOfMonth(y,m);
    const dmap = dsMonthDone(t,y,m,uptoStr);
    let sch=0, done=0;
    wds.forEach((dt,i)=>{ if(dt>today) return;
      const items=dsSchedItems(t,i+1,y,m);
      items.forEach(it=>{ sch++; if(dmap[(i+1)+'|'+it.n]) done++; });
    });
    // Count total unique equipment sessions taken by this team this month
    const mk = `${y}-${String(m+1).padStart(2,'0')}`;
    const sessionKeys = new Set();
    (dsReadingsArr()||[]).forEach(r=>{
      if(!r.equipment||!r.date) return;
      if((r.date||'').slice(0,7)!==mk) return;
      if(!userBelongsToTeam(r, t)) return;
      sessionKeys.add(r.date.slice(0,10)+'||'+normalizeEquipName(r.equipment));
    });
    const totalSessions = sessionKeys.size;
    totalSch+=sch; totalDone+=done;
    return {team:t, name:TEAM_NAME[t]||t, sch, done, pct: sch?Math.round(done/sch*100):0, totalSessions};
  });
  const totalPct = totalSch ? Math.round(totalDone/totalSch*100) : 0;
  const totalColor = totalPct>=90?'var(--green)':totalPct>=70?'var(--amber)':'var(--red)';
  const mn = new Date(y,m,1).toLocaleDateString(undefined,{month:'long',year:'numeric'});

  let html = `<div style="background:#EFF6FF;border-radius:8px;padding:10px 12px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
    <span style="font-weight:700;font-size:13px;color:var(--blue-text)">${mn}</span>
    <span style="font-weight:700;font-size:13px">${totalDone} completed · <span style="color:${totalColor}">${totalPct}%</span></span>
  </div>`;

  html += stats.map(r=>{
    const barColor = teamColors[r.team] || (r.pct>=90?'var(--green)':r.pct>=70?'var(--amber)':'var(--red)');
    const pctColor = r.pct>=90?'var(--green)':r.pct>=70?'var(--amber)':'var(--red)';
    return `<div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
        <span style="font-weight:600">${r.name}</span>
        <span style="color:var(--muted)">${r.done}/${r.sch} complied · <strong style="color:${pctColor}">${r.pct}%</strong> · <span style="color:var(--blue);font-weight:600">${r.totalSessions} sessions</span></span>
      </div>
      <div style="height:10px;background:var(--bg);border:1px solid var(--border);border-radius:5px;overflow:hidden">
        <div style="height:100%;width:${r.pct}%;background:${barColor};border-radius:5px;transition:width .3s"></div>
      </div>
    </div>`;
  }).join('');

  container.innerHTML = html;
}

function dsRenderCompareMonthwise() {
  const container = document.getElementById('ds-compare-monthwise');
  if(!container) return;
  const isAdmin = (AUTH && AUTH.role==='admin');
  if(!isAdmin) {
    container.innerHTML = '';
    return;
  }
  
  const today = new Date();
  const monthsSet = new Set();
  (dsReadingsArr() || []).forEach(r => {
    if (r.date && r.date.length >= 7) {
      monthsSet.add(r.date.slice(0, 7));
    }
  });
  const currentYM = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  monthsSet.add(currentYM);
  
  let sortedMonths = Array.from(monthsSet).sort().reverse();
  
  if (window.DS_HIST_RANGE === '3m' || !window.DS_HIST_RANGE) {
    sortedMonths = sortedMonths.slice(0, 3);
  } else if (window.DS_HIST_RANGE === 'fy') {
    const curYear = today.getFullYear();
    const curMonth = today.getMonth();
    let fyStartYear = (curMonth >= 3) ? curYear : (curYear - 1);
    const fyStartYM = `${fyStartYear}-04`;
    sortedMonths = sortedMonths.filter(ym => ym >= fyStartYM && ym <= currentYM);
  }
  const teams = Object.keys(VIBE_SCHEDULE);
  const teamColors = { 'Precise': '#3b82f6', 'CB': '#f59e0b', 'CBA': '#10b981' };
  
  const teamReadingsMap2 = {};
  (dsReadingsArr() || []).forEach(r => {
    if (!r.date || !r.equipment) return;
    const key = normalizeEquipName(r.equipment) + '||' + r.date.slice(0, 7);
    const ds = r.date.slice(0, 10);
    Object.keys(VIBE_SCHEDULE).forEach(t => {
      if (userBelongsToTeam(r, t)) {
        if (!teamReadingsMap2[t]) teamReadingsMap2[t] = {};
        if (!teamReadingsMap2[t][key]) teamReadingsMap2[t][key] = new Set();
        teamReadingsMap2[t][key].add(ds);
      }
    });
  });

  function getReadingDaysCountOpt(equipName, y, m, uptoStr, team) {
    const key = normalizeEquipName(equipName) + '||' + `${y}-${String(m+1).padStart(2,'0')}`;
    const tMap = team ? teamReadingsMap2[team] : null;
    const datesSet = tMap ? tMap[key] : null;
    if (!datesSet) return 0;
    if (!uptoStr) return datesSet.size;
    let count = 0;
    datesSet.forEach(ds => { if (ds <= uptoStr) count++; });
    return count;
  }

  function getMonthDoneFast(team, y, m, uptoStr) {
    return dsMonthDone(team, y, m, uptoStr);   // shared visit-by-visit matching (see dsOccurrenceStates)
  }

  let html = '';
  sortedMonths.forEach(ym => {
    const parts = ym.split('-');
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const formattedMonth = new Date(y, m, 1).toLocaleDateString(undefined, {month: 'long', year: 'numeric'});
    
    html += `<div style="background:var(--bg); border:1px solid var(--border); border-radius:8px; padding:10px; margin-bottom:10px">
      <div style="font-weight:700; font-size:12px; margin-bottom:8px; color:var(--text-main)">📅 ${formattedMonth}</div>
      <div style="display:flex; flex-direction:column; gap:6px">`;
      
    teams.forEach(team => {
      const wds = dsWorkingDaysOfMonth(y, m);
      const doneMap = getMonthDoneFast(team, y, m, dsFmt(today));
      let sch = 0, done = 0;
      
      wds.forEach((dt, i) => {
        if (dt > today) return;
        const items = dsSchedItems(team, i + 1, y, m);   // the schedule version in force in that month
        items.forEach(it => {
          sch++;
          if (doneMap[(i + 1) + '|' + it.n]) done++;
        });
      });
      
      const pct = sch ? Math.round(done / sch * 100) : 0;
      const color = teamColors[team] || '#8b949e';
      const displayName = TEAM_NAME[team] || team;
      // Count total sessions by this team in this month
      const mk2 = `${y}-${String(m+1).padStart(2,'0')}`;
      const sessKeys2 = new Set();
      (dsReadingsArr()||[]).forEach(r=>{
        if(!r.equipment||!r.date) return;
        if((r.date||'').slice(0,7)!==mk2) return;
        if(!userBelongsToTeam(r, team)) return;
        sessKeys2.add(r.date.slice(0,10)+'||'+normalizeEquipName(r.equipment));
      });
      
      html += `
        <div style="display:flex; align-items:center; gap:8px">
          <span style="width:130px; font-size:11px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap" title="${displayName}">${displayName}</span>
          <div style="flex:1; height:8px; background:rgba(0,0,0,0.05); border-radius:4px; overflow:hidden">
            <div style="height:100%; width:${pct}%; background:${color}; border-radius:4px; transition:width 0.3s"></div>
          </div>
          <span style="font-size:11px; font-weight:700; width:100px; text-align:right">${done}/${sch} (${pct}%) · ${sessKeys2.size}s</span>
        </div>`;
    });
    
    html += `</div></div>`;
  });
  
  container.innerHTML = html;
}

/* === Admin-only: compare all teams for the viewed month === */
function dsRenderCompare(){
  const wrap = document.getElementById('ds-compare');
  if(!wrap) return;
  const isAdmin = (AUTH && AUTH.role==='admin');
  wrap.style.display = isAdmin ? 'block' : 'none';
  if(!isAdmin) return;
  const y=DS_VIEW.y, m=DS_VIEW.m;
  const today=new Date(); today.setHours(0,0,0,0);
  // Only count days that have actually occurred (so current month is fair)
  const monthStart=new Date(y,m,1); monthStart.setHours(0,0,0,0);
  const uptoStr = monthStart>today ? dsFmt(monthStart) : dsFmt(today);
  const teams = Object.keys(VIBE_SCHEDULE);
  const stats = teams.map(t=>{
    const wds=dsWorkingDaysOfMonth(y,m);
    const dmap=dsMonthDone(t,y,m,uptoStr);
    let sch=0, done=0;
    wds.forEach((dt,i)=>{ if(dt>today) return;
      const items=dsSchedItems(t,i+1,y,m);
      items.forEach(it=>{ sch++; if(dmap[(i+1)+'|'+it.n]) done++; });
    });
    return {team:t, name:TEAM_NAME[t]||t, sch, done, pct: sch?Math.round(done/sch*100):0};
  }).sort((a,b)=>b.pct-a.pct);
  const mn=new Date(y,m,1).toLocaleDateString(undefined,{month:'long',year:'numeric'});
  document.getElementById('ds-compare-sub').textContent =
    `Completion by team for ${mn} (scheduled vs analysed, any inspector).`;
  const bars = stats.map((r,idx)=>{
    const color = r.pct>=90?'var(--green)':r.pct>=70?'var(--amber)':'var(--red)';
    const medal = idx===0?'🥇 ':idx===1?'🥈 ':idx===2?'🥉 ':'';
    return `<div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
        <span style="font-weight:600">${medal}${r.name}</span>
        <span style="color:var(--muted)">${r.done}/${r.sch} · <strong style="color:${color}">${r.pct}%</strong></span>
      </div>
      <div style="height:14px;background:var(--bg);border:1px solid var(--border);border-radius:7px;overflow:hidden">
        <div style="height:100%;width:${r.pct}%;background:${color};border-radius:7px;transition:width .3s"></div>
      </div>
    </div>`;
  }).join('');
  document.getElementById('ds-compare-bars').innerHTML = stats.some(r=>r.sch>0)
    ? bars
    : '<div style="text-align:center;color:var(--muted);padding:10px;font-size:12px">No scheduled work for this month yet.</div>';
}

// SQL Server Import & Range Toggle Helpers
window.DS_HIST_RANGE = '3m';
function dsToggleHistRange() {
  const btn = document.getElementById('ds-hist-toggle');
  if (window.DS_HIST_RANGE === '3m') {
    window.DS_HIST_RANGE = 'fy';
    if (btn) btn.textContent = 'View Last 3 Months';
  } else {
    window.DS_HIST_RANGE = '3m';
    if (btn) btn.textContent = 'View Current FY';
  }
  dsRenderCompareMonthwise();
}
