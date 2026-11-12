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
  try { dsRenderDailyBars(); } catch(e){ console.error('dsRenderDailyBars failed:', e); }
  try { dsRenderCompare(); } catch(e){ console.error('dsRenderCompare failed:', e); }
  try { dsRenderCompareMonthwise(); } catch(e){ console.error('dsRenderCompareMonthwise failed:', e); }
}

/* === Admin-only: equipment actually read each day, one bar chart per group, with a trend line (viewed month) ===
   Bars = DISTINCT equipment with a real reading that day. "Not running / Standby" outcomes are not readings
   (they live in equipment_status_log, not in READINGS), so they are never counted here. */
function dsRenderDailyBars(){
  const host = document.getElementById('ds-perf-daily'); if(!host) return;
  if(!(AUTH && AUTH.role==='admin')){ host.innerHTML=''; host.style.display='none'; return; }
  host.style.display = '';
  const y = DS_VIEW.y, m = DS_VIEW.m, dim = new Date(y, m+1, 0).getDate();
  const mk = `${y}-${String(m+1).padStart(2,'0')}`;
  const teams = Object.keys(VIBE_SCHEDULE);
  const palette = { 'Precise': ['#3b82f6','#1d4ed8'], 'CB': ['#f59e0b','#b45309'], 'CBA': ['#10b981','#047857'] };
  const fallback = [['#8b5cf6','#6d28d9'], ['#ef4444','#b91c1c'], ['#14b8a6','#0f766e']];
  const colorsOf = (t, i) => palette[t] || fallback[i % fallback.length];
  const perDay = {}; teams.forEach(t => { perDay[t] = Array.from({length: dim}, () => new Set()); });
  (dsReadingsArr()||[]).forEach(r => {
    if(!r.equipment || !r.date || r.date.slice(0,7) !== mk) return;
    const d = parseInt(r.date.slice(8,10), 10); if(!(d >= 1 && d <= dim)) return;
    const eq = normalizeEquipName(r.equipment);
    teams.forEach(t => { if(userBelongsToTeam(r, t)) perDay[t][d-1].add(eq); });
  });
  const counts = {}; let maxV = 0;
  teams.forEach(t => { counts[t] = perDay[t].map(s => s.size); counts[t].forEach(v => { if(v > maxV) maxV = v; }); });
  const mn = new Date(y, m, 1).toLocaleDateString(undefined, {month:'long', year:'numeric'});
  const trendKey = `<span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--text-muted,var(--muted))"><svg width="26" height="8"><line x1="1" y1="4" x2="25" y2="4" style="stroke:var(--text-main,#1e293b)" stroke-width="2.4" stroke-linecap="round"/></svg>Trend</span>`;
  const head = `<div class="card" style="margin-top:12px"><div class="card-head" style="background:#EFF6FF"><span class="card-title" style="color:var(--blue-text)">📊 Equipment read per day · ${mn}</span>${trendKey}</div><div class="card-body" style="padding:6px 12px 10px">`;
  if(!maxV){ host.innerHTML = head + '<div style="text-align:center;color:var(--muted);padding:14px;font-size:12px">No readings in this month yet.</div></div></div>'; return; }

  const slot = 40, padL = 8, padR = 8, padT = 24, chartH = 112, padB = 22;
  const W = padL + padR + slot * dim, H = padT + chartH + padB;
  const yMax = Math.max(4, Math.ceil(maxV * 1.12));                   // one shared scale, so the three groups can be compared by eye
  const yOf = v => padT + chartH - (v / yMax) * chartH;
  const barW = 22;
  const smooth = pts => {                                              // soft curve through the points
    if(pts.length < 2) return '';
    let d = `M${pts[0].x},${pts[0].y}`;
    for(let i = 0; i < pts.length - 1; i++){ const a = pts[i], b = pts[i+1], c = (b.x - a.x) * 0.4; d += ` C${a.x + c},${a.y} ${b.x - c},${b.y} ${b.x},${b.y}`; }
    return d;
  };

  const charts = teams.map((t, i) => {
    const [light, dark] = colorsOf(t, i), arr = counts[t];
    let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;min-width:${Math.min(W, 900)}px;height:auto;display:block" xmlns="http://www.w3.org/2000/svg">`;
    svg += `<line x1="${padL}" y1="${padT+chartH}" x2="${W-padR}" y2="${padT+chartH}" style="stroke:var(--text-muted,#94a3b8)" stroke-width="1" opacity="0.6"/>`;
    const pts = [];
    for(let d = 1; d <= dim; d++){
      const v = arr[d-1], cx = padL + (d - 0.5) * slot;
      svg += `<text x="${cx}" y="${H-6}" font-size="10" text-anchor="middle" style="fill:var(--text-muted,var(--muted,#6b7280))">${d}</text>`;
      if(!v) continue;
      const by = yOf(v);
      svg += `<rect x="${cx - barW/2}" y="${by}" width="${barW}" height="${padT+chartH-by}" rx="4" fill="${light}" opacity="0.88"><title>${escHtml(TEAM_NAME[t]||t)} · ${String(d).padStart(2,'0')}-${String(m+1).padStart(2,'0')}-${y}: ${v}</title></rect>`;
      pts.push({ d, v, x: cx });
    }
    // trend: 3-day moving average over the days that have readings
    const tp = pts.map((p, k) => { const w = pts.slice(Math.max(0, k-1), k + 2), avg = w.reduce((s, q) => s + q.v, 0) / w.length; return { x: p.x, y: yOf(avg) }; });
    if(tp.length >= 2){ const dpath = smooth(tp);
      svg += `<path d="${dpath}" fill="none" style="stroke:var(--bg-card,#fff)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/><path d="${dpath}" fill="none" style="stroke:var(--text-main,#1e293b)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`; }
    pts.forEach(p => { svg += `<text x="${p.x}" y="${yOf(p.v) - 6}" font-size="10.5" text-anchor="middle" font-weight="700" style="fill:var(--text-main,#111827);paint-order:stroke;stroke:var(--bg-card,#fff);stroke-width:3px;stroke-linejoin:round" pointer-events="none">${p.v}</text>`; });
    svg += '</svg>';
    return `<div style="margin-top:10px"><div style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;margin:0 0 2px 2px;color:var(--text-main,inherit)"><span style="width:12px;height:12px;border-radius:4px;background:${light};display:inline-block"></span>${escHtml(TEAM_NAME[t]||t)}</div><div style="overflow-x:auto">${svg}</div></div>`;
  }).join('');
  host.innerHTML = head + charts + '</div></div>';
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
