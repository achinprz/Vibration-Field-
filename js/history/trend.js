/* VibeMon — equipment trend / point detail modal */

// ── TREND MODAL: full equipment history across all dates ──────────────────
// Persists the user's chosen view mode across openings
let _trendViewMode = localStorage.getItem('vibemon-trend-view') || 'param'; // 'param' | 'point'

function showEquipTrend(equip, forceAutoscale = true, viewMode) {
  equip = String(equip ?? '').trim();
  if (viewMode !== undefined) { _trendViewMode = viewMode; localStorage.setItem('vibemon-trend-view', viewMode); }
  const trendModal = document.getElementById('trend-modal');
  const trendTitle = document.getElementById('trend-title');
  const trendBody  = document.getElementById('trend-body');
  if (!trendModal || !trendTitle || !trendBody) {
    alert('Trend window is not available. Please refresh and try again.');
    return;
  }
  const eqKey = equip.toLowerCase();
  const allRows = READINGS.filter(r => String(r.equipment || '').trim().toLowerCase() === eqKey)
    .sort((a,b) => String(a.date||'').localeCompare(String(b.date||'')) || String(a.createdOn||'').localeCompare(String(b.createdOn||'')));
  if (!allRows.length) { alert('No readings found for ' + equip); return; }
  equip = allRows[0].equipment || equip;

  // Build sessions using reportId (so same-date multiple entries show separately)
  const sessionMap = {}; const _noidCT = {};
  allRows.forEach(r => {
    let key;
    if (r.reportId) { key = r.reportId + '||' + r.equipment + '||' + r.date; }
    else { const b = r.date+'||'+r.equipment+'||'+(r.inspector||'')+'||'+(r.createdOn||''); if(!_noidCT[b]) _noidCT[b]=0; key = b || ('_noid_'+(_noidCT[b]++)); }
    if (!sessionMap[key]) sessionMap[key] = { date: r.date, key, inspector: r.inspector||'', rows: [] };
    sessionMap[key].rows.push(r);
  });
  let sessions = Object.values(sessionMap).sort((a,b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  if (sessions.length > 10) sessions = sessions.slice(-10);

  const points = [...new Set(allRows.map(r => r.point).filter(Boolean))];
  const velParams  = ['H_Vel','V_Vel','A_Vel'];
  const allParams  = ['H_Vel','V_Vel','A_Vel','Acc','H_Dis','V_Dis','A_Dis'];
  const paramLabels = { H_Vel:'Horizontal Velocity', V_Vel:'Vertical Velocity', A_Vel:'Axial Velocity', Acc:'Acceleration', H_Dis:'Horizontal Displacement', V_Dis:'Vertical Displacement', A_Dis:'Axial Displacement' };
  const paramUnits  = { H_Vel:'mm/s', V_Vel:'mm/s', A_Vel:'mm/s', Acc:'g', H_Dis:'µm', V_Dis:'µm', A_Dis:'µm' };
  const sevLimits   = {
    H_Vel:{alarm:2.8,alert:7.1,critical:11.2}, V_Vel:{alarm:2.8,alert:7.1,critical:11.2},
    A_Vel:{alarm:2.8,alert:7.1,critical:11.2}, Acc:{alarm:1.0,alert:3.5,critical:5.0},
    H_Dis:{alarm:50,alert:100,critical:150},    V_Dis:{alarm:50,alert:100,critical:150}, A_Dis:{alarm:50,alert:100,critical:150}
  };
  // Colors for measurement POINTS (param-wise view) – unchanged
  const ptColors     = ['#2563EB','#16A34A','#D97706','#9333EA','#DC2626','#0891B2','#65A30D','#F59E0B'];
  const ptColorsFill = ['rgba(37,99,235,0.08)','rgba(22,163,74,0.08)','rgba(215,119,6,0.08)','rgba(147,51,234,0.08)','rgba(220,38,38,0.08)','rgba(8,145,178,0.08)','rgba(101,163,13,0.08)','rgba(245,158,11,0.08)'];
  // Colors for PARAMETERS (combined-point view)
  const paramColors  = { H_Vel:'#2563EB', V_Vel:'#16A34A', A_Vel:'#9333EA', Acc:'#DC2626', H_Dis:'#0891B2', V_Dis:'#65A30D', A_Dis:'#F59E0B' };
  const paramFills   = { H_Vel:'rgba(37,99,235,0.07)', V_Vel:'rgba(22,163,74,0.07)', A_Vel:'rgba(147,51,234,0.07)', Acc:'rgba(220,38,38,0.07)', H_Dis:'rgba(8,145,178,0.07)', V_Dis:'rgba(101,163,13,0.07)', A_Dis:'rgba(245,158,11,0.07)' };

  const eqObj = MASTER.find(e => e.name === equip) || { unit:'', area:'' };

  trendTitle.textContent = `📈 Trend: ${equip}`;

  // Short x-label
  const dateCounts = {};
  sessions.forEach(s => { dateCounts[s.date] = (dateCounts[s.date]||0)+1; });
  const dateIdx = {};
  sessions.forEach(s => { dateIdx[s.date] = (dateIdx[s.date]||0); });
  const xLabels = sessions.map(s => {
    const mm_dd = s.date.slice(5).replace('-','/');
    if (dateCounts[s.date] > 1) { dateIdx[s.date]++; return `${mm_dd}(${dateIdx[s.date]})`; }
    return mm_dd;
  });

  // ── Shared chart helpers ─────────────────────────────────────────────────
  function smoothPath(pts) {
    if (!pts.length) return '';
    if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`;
    let d = `M${pts[0].x},${pts[0].y}`;
    for (let i = 0; i < pts.length-1; i++) {
      const p0=pts[i], p1=pts[i+1];
      const cx = (p1.x - p0.x) * 0.45;
      d += ` C${p0.x+cx},${p0.y} ${p1.x-cx},${p1.y} ${p1.x},${p1.y}`;
    }
    return d;
  }
  function niceMax(rawMax, critLimit) {
    const base = Math.max(rawMax * 1.18, critLimit * 1.15);
    if (base <= 0) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(base)));
    return Math.ceil(base / mag) * mag;
  }
  function niceYTicks(maxV, n) {
    const raw = maxV / n;
    if (raw <= 0) return [0];
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = Math.ceil(raw / mag) * mag;
    const ticks = [];
    for (let v = 0; v <= maxV + step*0.01; v += step) ticks.push(parseFloat(v.toFixed(6)));
    return ticks;
  }

  // ── Single-parameter chart SVG (for param-wise view) ────────────────────
  function buildParamSvg(param, pointsWithData, yMaxOverride) {
    const lims = sevLimits[param];
    const allVals = [];
    sessions.forEach(s => s.rows.forEach(r => { const v=parseFloat(r[param]); if(!isNaN(v)&&v>0) allVals.push(v); }));
    if (!allVals.length) return null;
    const rawMax = Math.max(...allVals);
    const maxV = yMaxOverride || (forceAutoscale ? niceMax(rawMax,0) : niceMax(rawMax,lims.critical));
    const yTicks = niceYTicks(maxV, 5);
    const n = sessions.length;
    const minColW = Math.max(44, Math.min(72, 520/n));
    const chartW = Math.max(n*minColW+80, 380);
    const chartH = 175, padL=46, padR=36, padT=22, padB=42;
    const W=chartW, H=chartH+padT+padB;
    const xOf = i => padL + (n>1 ? i*(W-padL-padR)/(n-1) : (W-padL-padR)/2);
    const yOf = v => padT + chartH - (v/maxV)*chartH;
    const zones = [
      { from:lims.critical, to:maxV,         color:'rgba(220,38,38,0.06)' },
      { from:lims.alert,    to:lims.critical, color:'rgba(234,88,12,0.06)' },
      { from:lims.alarm,    to:lims.alert,    color:'rgba(215,119,6,0.05)' },
      { from:0,             to:lims.alarm,    color:'rgba(22,163,74,0.04)' },
    ];
    let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;min-width:${Math.min(W,320)}px;height:auto;display:block;overflow:visible" xmlns="http://www.w3.org/2000/svg">`;
    svg += `<rect x="${padL}" y="${padT}" width="${W-padL-padR}" height="${chartH}" fill="#fafbfc" rx="5"/>`;
    zones.forEach(z => { const y1=yOf(Math.min(z.to,maxV)),y2=yOf(Math.max(z.from,0)); if(y2>y1) svg+=`<rect x="${padL}" y="${y1}" width="${W-padL-padR}" height="${y2-y1}" fill="${z.color}"/>`; });
    sessions.forEach((s,i) => { const x=xOf(i); svg+=`<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT+chartH}" stroke="#e5e7eb" stroke-width="0.6" stroke-dasharray="3,3"/>`; });
    yTicks.forEach(v => { const y=yOf(v),lbl=v<10?v.toFixed(v===0?0:1):v.toFixed(0); svg+=`<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="#e5e7eb" stroke-width="0.8"/>`;svg+=`<text x="${padL-5}" y="${y+3.5}" font-size="9" fill="#9ca3af" text-anchor="end">${lbl}</text>`; });
    [{v:lims.alarm,color:'#D97706',label:'Alarm'},{v:lims.alert,color:'#EA580C',label:'Alert'},{v:lims.critical,color:'#DC2626',label:'Crit'}].filter(g=>g.v<=maxV).forEach(g => { const y=yOf(g.v); svg+=`<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="${g.color}" stroke-width="1.5" stroke-dasharray="6,4" opacity="0.9"/>`;svg+=`<rect x="${W-padR+2}" y="${y-9}" width="${g.label.length*5+6}" height="11" fill="${g.color}" rx="3" opacity="0.92"/>`;svg+=`<text x="${W-padR+5}" y="${y+0.5}" font-size="7.5" fill="#fff" font-weight="700">${g.label}</text>`; });
    svg+=`<line x1="${padL}" y1="${padT+chartH}" x2="${W-padR}" y2="${padT+chartH}" stroke="#d1d5db" stroke-width="1.5"/>`;
    svg+=`<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT+chartH}" stroke="#d1d5db" stroke-width="1.5"/>`;
    const step=n<=12?1:Math.ceil(n/10);
    sessions.forEach((s,i) => { if(i%step===0||i===n-1){const x=xOf(i);svg+=`<line x1="${x}" y1="${padT+chartH}" x2="${x}" y2="${padT+chartH+4}" stroke="#9ca3af" stroke-width="1"/>`;svg+=`<text x="${x}" y="${H-4}" font-size="8.5" fill="#6b7280" text-anchor="middle">${escHtml(xLabels[i])}</text>`;} });
    svg+=`<text x="11" y="${padT+chartH/2}" font-size="8.5" fill="#9ca3af" text-anchor="middle" transform="rotate(-90,11,${padT+chartH/2})">${paramUnits[param]}</text>`;
    pointsWithData.forEach((pt,pi) => {
      const color=ptColors[pi%ptColors.length],fillC=ptColorsFill[pi%ptColorsFill.length];
      const ptData=sessions.map((s,i) => { const matching=s.rows.filter(r=>r.point===pt),vals=matching.map(r=>parseFloat(r[param])).filter(v=>!isNaN(v)&&v>0); if(!vals.length) return null; const v=vals.reduce((a,b)=>a+b,0)/vals.length; return {x:xOf(i),y:yOf(v),v,dt:s.date}; });
      const validPts=ptData.filter(Boolean); if(!validPts.length) return;
      const linePath=smoothPath(validPts);
      if(validPts.length>1){const areaPath=linePath+` L${validPts[validPts.length-1].x},${padT+chartH} L${validPts[0].x},${padT+chartH} Z`;svg+=`<path d="${areaPath}" fill="${fillC}"/>`;}
      svg+=`<path d="${linePath}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
      validPts.forEach(({x,y,v,dt}) => { const eqA=jsArg(equip),ptA=jsArg(pt),dtA=jsArg(dt),sevC=v>=lims.critical?'#DC2626':v>=lims.alert?'#EA580C':v>=lims.alarm?'#D97706':'#16A34A';svg+=`<circle cx="${x}" cy="${y}" r="12" fill="${color}" opacity="0.001" style="cursor:pointer" onclick="showPointDetail(${eqA},${ptA},${dtA})"><title>${escHtml(pt)} • ${escHtml(dt)}: ${v.toFixed(2)} ${paramUnits[param]}</title></circle>`;svg+=`<circle cx="${x}" cy="${y}" r="7" fill="${color}" opacity="0.12" pointer-events="none"/>`;svg+=`<circle cx="${x}" cy="${y}" r="5.5" fill="none" stroke="${sevC}" stroke-width="2" pointer-events="none"/>`;svg+=`<circle cx="${x}" cy="${y}" r="3.5" fill="${color}" pointer-events="none"/>`;if(n<=14)svg+=`<text x="${x}" y="${y-11}" font-size="8" fill="${color}" text-anchor="middle" font-weight="700" pointer-events="none">${v.toFixed(1)}</text>`; });
    });
    svg+='</svg>';
    return { svg, maxV, allVals };
  }

  // ── Combined-point chart SVG: all params on one chart per point ──────────
  function buildCombinedPointSvg(pt, paramsToPlot) {
    // Velocity params share left Y-axis; Acc gets right Y-axis if present
    const velParamsPresent = paramsToPlot.filter(p => ['H_Vel','V_Vel','A_Vel'].includes(p));
    const accPresent = paramsToPlot.includes('Acc');
    const velVals = [], accVals = [];
    sessions.forEach(s => s.rows.filter(r=>r.point===pt).forEach(r => {
      velParamsPresent.forEach(p => { const v=parseFloat(r[p]); if(!isNaN(v)&&v>0) velVals.push(v); });
      if(accPresent){ const v=parseFloat(r['Acc']); if(!isNaN(v)&&v>0) accVals.push(v); }
    }));
    if(!velVals.length && !accVals.length) return null;

    const velMax = velVals.length ? (forceAutoscale ? niceMax(Math.max(...velVals),0) : niceMax(Math.max(...velVals), 11.2)) : 0;
    const accMax = accVals.length ? (forceAutoscale ? niceMax(Math.max(...accVals),0) : niceMax(Math.max(...accVals), 5.0)) : 0;
    const velTicks = velMax>0 ? niceYTicks(velMax,5) : [];
    const accTicks = accMax>0 ? niceYTicks(accMax,5) : [];

    const n=sessions.length;
    const chartH=180, padL=48, padR=accPresent?52:20, padT=18, padB=40;
    const W=Math.max(n*Math.max(44,Math.min(72,480/n))+padL+padR, 340);
    const H=chartH+padT+padB;
    const xOf = i => padL+(n>1?i*(W-padL-padR)/(n-1):(W-padL-padR)/2);
    const yOfV = v => padT+chartH-(v/velMax)*chartH;
    const yOfA = v => padT+chartH-(v/accMax)*chartH;

    let svg=`<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;overflow:visible" xmlns="http://www.w3.org/2000/svg">`;
    svg+=`<rect x="${padL}" y="${padT}" width="${W-padL-padR}" height="${chartH}" fill="#fafbfc" rx="5"/>`;
    // light vertical grid
    sessions.forEach((s,i)=>{const x=xOf(i);svg+=`<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT+chartH}" stroke="#e5e7eb" stroke-width="0.5" stroke-dasharray="3,3"/>`;});
    // Left axis (velocity)
    if(velMax>0){
      velTicks.forEach(v=>{const y=yOfV(v),lbl=v<10?v.toFixed(v===0?0:1):v.toFixed(0);svg+=`<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="#e5e7eb" stroke-width="0.7"/>`;svg+=`<text x="${padL-5}" y="${y+3.5}" font-size="8.5" fill="#9ca3af" text-anchor="end">${lbl}</text>`;});
      svg+=`<text x="10" y="${padT+chartH/2}" font-size="8" fill="#2563EB" text-anchor="middle" transform="rotate(-90,10,${padT+chartH/2})">mm/s</text>`;
    }
    // Right axis (acceleration)
    if(accPresent && accMax>0){
      accTicks.forEach(v=>{const y=yOfA(v),lbl=v<10?v.toFixed(v===0?0:1):v.toFixed(0);svg+=`<text x="${W-padR+6}" y="${y+3.5}" font-size="8.5" fill="#DC2626" text-anchor="start">${lbl}</text>`;});
      svg+=`<text x="${W-padR+accTicks.reduce((m,v)=>{const l=(v<10?v.toFixed(v===0?0:1):v.toFixed(0)).length;return Math.max(m,l);},1)*5+14}" y="${padT+chartH/2}" font-size="8" fill="#DC2626" text-anchor="middle" transform="rotate(90,${W-padR+accTicks.reduce((m,v)=>{const l=(v<10?v.toFixed(v===0?0:1):v.toFixed(0)).length;return Math.max(m,l);},1)*5+14},${padT+chartH/2})">g</text>`;
    }
    // Axes borders
    svg+=`<line x1="${padL}" y1="${padT+chartH}" x2="${W-padR}" y2="${padT+chartH}" stroke="#d1d5db" stroke-width="1.5"/>`;
    svg+=`<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT+chartH}" stroke="#d1d5db" stroke-width="1.5"/>`;
    if(accPresent) svg+=`<line x1="${W-padR}" y1="${padT}" x2="${W-padR}" y2="${padT+chartH}" stroke="#DC262640" stroke-width="1.2"/>`;
    // X labels
    const step=n<=12?1:Math.ceil(n/10);
    sessions.forEach((s,i)=>{if(i%step===0||i===n-1){const x=xOf(i);svg+=`<line x1="${x}" y1="${padT+chartH}" x2="${x}" y2="${padT+chartH+4}" stroke="#9ca3af" stroke-width="1"/>`;svg+=`<text x="${x}" y="${H-4}" font-size="8" fill="#6b7280" text-anchor="middle">${escHtml(xLabels[i])}</text>`;}});

    // Draw each parameter
    paramsToPlot.forEach(param => {
      const isAcc = param==='Acc';
      const useMax = isAcc ? accMax : velMax;
      if(useMax<=0) return;
      const yOf_ = isAcc ? yOfA : yOfV;
      const color = paramColors[param];
      const fillC = paramFills[param];
      const lims = sevLimits[param];
      const ptData = sessions.map((s,i)=>{
        const matching=s.rows.filter(r=>r.point===pt);
        const vals=matching.map(r=>parseFloat(r[param])).filter(v=>!isNaN(v)&&v>0);
        if(!vals.length) return null;
        const v=vals.reduce((a,b)=>a+b,0)/vals.length;
        return {x:xOf(i),y:yOf_(v),v,dt:s.date};
      });
      const validPts=ptData.filter(Boolean); if(!validPts.length) return;
      const linePath=smoothPath(validPts);
      if(validPts.length>1){const areaPath=linePath+` L${validPts[validPts.length-1].x},${padT+chartH} L${validPts[0].x},${padT+chartH} Z`;svg+=`<path d="${areaPath}" fill="${fillC}"/>`;}
      svg+=`<path d="${linePath}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
      validPts.forEach(({x,y,v,dt})=>{
        const eqA=jsArg(equip),ptA=jsArg(pt),dtA=jsArg(dt);
        const sevC=v>=lims.critical?'#DC2626':v>=lims.alert?'#EA580C':v>=lims.alarm?'#D97706':'#16A34A';
        svg+=`<circle cx="${x}" cy="${y}" r="12" fill="${color}" opacity="0.001" style="cursor:pointer" onclick="showPointDetail(${eqA},${ptA},${dtA})"><title>${escHtml(paramLabels[param])} • ${escHtml(dt)}: ${v.toFixed(2)} ${paramUnits[param]}</title></circle>`;
        svg+=`<circle cx="${x}" cy="${y}" r="6" fill="${color}" opacity="0.15" pointer-events="none"/>`;
        svg+=`<circle cx="${x}" cy="${y}" r="4.5" fill="none" stroke="${sevC}" stroke-width="1.8" pointer-events="none"/>`;
        svg+=`<circle cx="${x}" cy="${y}" r="2.8" fill="${color}" pointer-events="none"/>`;
        if(n<=10) svg+=`<text x="${x}" y="${y-10}" font-size="7.5" fill="${color}" text-anchor="middle" font-weight="700" pointer-events="none">${v.toFixed(1)}</text>`;
      });
    });
    svg+='</svg>';
    return svg;
  }

  // ── Build the header toolbar (shared by both views) ──────────────────────
  const eqA = jsArg(equip);
  const autoscaleChk = `<label style="font-size:11px;display:inline-flex;align-items:center;gap:4px;cursor:pointer;background:var(--blue-light);color:var(--blue-text);padding:3px 9px;border-radius:8px;font-weight:600">
    <input type="checkbox" id="trend-autoscale-chk" ${forceAutoscale?'checked':''} onchange="showEquipTrend(${eqA},this.checked)" style="margin:0;cursor:pointer"/>
    Autoscale Y
  </label>`;

  // ── View mode toggle UI ──────────────────────────────────────────────────
  // Store equip name on window so the delegated handler can read it without
  // embedding quotes-inside-quotes inside an innerHTML onclick attribute.
  window._trendToggleEquip = equip;
  const isParam = _trendViewMode === 'param';
  const modeToggle = `<div style="display:inline-flex;align-items:center;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:3px;gap:2px">
    <button data-trendmode="param" onclick="_trendSwitchMode(this)"
      style="padding:4px 12px;border-radius:6px;border:none;cursor:pointer;font-size:11px;font-weight:600;transition:.15s;
        background:${isParam ? '#1D4E8A' : 'transparent'};
        color:${isParam ? '#fff' : '#64748b'}">
      &#8862; By Parameter
    </button>
    <button data-trendmode="point" onclick="_trendSwitchMode(this)"
      style="padding:4px 12px;border-radius:6px;border:none;cursor:pointer;font-size:11px;font-weight:600;transition:.15s;
        background:${!isParam ? '#1D4E8A' : 'transparent'};
        color:${!isParam ? '#fff' : '#64748b'}">
      &#9678; By Point
    </button>
  </div>`;

  let html = `<div style="margin-bottom:14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
    <div style="font-size:12px;color:var(--muted)">${escHtml(eqObj.unit)} · ${escHtml(eqObj.area)}</div>
    <span style="font-size:11px;background:var(--blue-light);color:var(--blue-text);padding:2px 8px;border-radius:8px;font-weight:600">${sessions.length} session${sessions.length!==1?'s':''}</span>
    <span style="font-size:11px;background:#f3f4f6;color:var(--muted);padding:2px 8px;border-radius:8px">${points.length} point${points.length!==1?'s':''}</span>
    <span style="font-size:11px;background:#f3f4f6;color:var(--muted);padding:2px 8px;border-radius:8px">${escHtml(sessions[0].date)} → ${escHtml(sessions[sessions.length-1].date)}</span>
    <div style="margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      ${autoscaleChk}
      ${modeToggle}
    </div>
  </div>`;

  // ════════════════════════════════════════════════════════════════
  // MODE 1: By Parameter (existing behaviour)
  // ════════════════════════════════════════════════════════════════
  if (_trendViewMode === 'param') {
    let chartsRendered = 0;
    allParams.forEach(param => {
      const lims = sevLimits[param];
      const pointsWithData = points.filter(pt =>
        sessions.some(s => s.rows.some(r => r.point === pt && parseFloat(r[param]) > 0))
      );
      const result = buildParamSvg(param, pointsWithData);
      if (!result) return;
      chartsRendered++;
      const { svg, allVals } = result;
      const peakVal = Math.max(...allVals);
      const peakSev = peakVal>=sevLimits[param].critical?'CRITICAL':peakVal>=sevLimits[param].alert?'ALERT':peakVal>=sevLimits[param].alarm?'ALARM':'NORMAL';
      const peakColor = {CRITICAL:'#DC2626',ALERT:'#EA580C',ALARM:'#D97706',NORMAL:'#16A34A'}[peakSev];
      const legend = pointsWithData.map((pt,pi) => {
        const c=ptColors[pi%ptColors.length];
        return `<span style="display:inline-flex;align-items:center;gap:5px;font-size:10px;margin-right:10px;margin-bottom:3px">
          <svg width="18" height="10" style="flex-shrink:0"><line x1="0" y1="5" x2="18" y2="5" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/><circle cx="9" cy="5" r="3.5" fill="${c}"/></svg>
          <span style="font-weight:600;color:${c}">${escHtml(pt)}</span>
        </span>`;
      }).join('');
      html += `<div style="margin-bottom:18px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06)">
        <div style="padding:10px 14px;border-bottom:1px solid #f3f4f6;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;background:linear-gradient(135deg,#f8fafc 0%,#f0f4ff 100%)">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-size:13px;font-weight:700;color:#111827">${paramLabels[param]}</span>
            <span style="font-size:10px;color:#9ca3af;background:#f3f4f6;padding:2px 7px;border-radius:6px">${paramUnits[param]}</span>
            <span style="font-size:10px;font-weight:700;color:${peakColor};background:${peakColor}18;padding:2px 7px;border-radius:6px">Peak: ${peakVal.toFixed(2)}</span>
          </div>
          <div style="display:flex;flex-wrap:wrap;align-items:center">${legend}</div>
        </div>
        <div style="padding:10px 8px 4px;overflow-x:auto;background:#fff">${svg}</div>
        <div style="padding:7px 14px;border-top:1px solid #f3f4f6;display:flex;gap:12px;font-size:10px;background:#fafbfc;flex-wrap:wrap;align-items:center">
          <span style="display:inline-flex;align-items:center;gap:4px;color:#D97706"><span style="width:14px;height:2px;background:#D97706;display:inline-block;border-radius:1px;border-top:1px dashed #D97706"></span> Alarm (${lims.alarm})</span>
          <span style="display:inline-flex;align-items:center;gap:4px;color:#EA580C"><span style="width:14px;height:2px;background:#EA580C;display:inline-block;border-radius:1px"></span> Alert (${lims.alert})</span>
          <span style="display:inline-flex;align-items:center;gap:4px;color:#DC2626"><span style="width:14px;height:2px;background:#DC2626;display:inline-block;border-radius:1px"></span> Critical (${lims.critical})</span>
          <span style="margin-left:auto;font-size:10px;color:#9ca3af">Dot ring = severity · Tap for details</span>
        </div>
      </div>`;
    });
    if (!chartsRendered) html += `<div class="alert-box alert-info">No numerical readings found for this equipment.</div>`;
  }

  // ════════════════════════════════════════════════════════════════
  // MODE 2: By Point — combined chart per measurement point, 2-col grid
  // ════════════════════════════════════════════════════════════════
  else {
    // Only show the main 4 parameters (velocity trio + acceleration)
    const combinedParams = allParams.filter(p => ['H_Vel','V_Vel','A_Vel','Acc'].includes(p));

    // Legend bar (same for every point card)
    const combinedLegend = combinedParams.map(p => {
      const c = paramColors[p];
      const isAcc = p==='Acc';
      return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px">
        <svg width="20" height="10" style="flex-shrink:0"><line x1="0" y1="5" x2="20" y2="5" stroke="${c}" stroke-width="2" stroke-linecap="round"/><circle cx="10" cy="5" r="3" fill="${c}"/></svg>
        <span style="font-weight:600;color:${c}">${paramLabels[p]} ${isAcc?'<span style="font-size:9px;opacity:.7">(right axis)</span>':''}</span>
      </span>`;
    }).join('');

    // Inline CSS for 2-col responsive grid
    html += `<style>
      .vt-pt-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:4px}
      @media(max-width:700px){.vt-pt-grid{grid-template-columns:1fr}}
    </style>
    <div style="margin-bottom:10px;padding:8px 12px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;display:flex;flex-wrap:wrap;gap:10px;align-items:center">
      <span style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-right:4px">Legend</span>
      ${combinedLegend}
      <span style="font-size:10px;color:#94a3b8;margin-left:auto">Left axis = mm/s · Right axis = g · Tap dot for detail</span>
    </div>
    <div class="vt-pt-grid">`;

    let ptRendered = 0;
    points.forEach(pt => {
      // Filter params that have any data for this point
      const paramsForPt = combinedParams.filter(p =>
        sessions.some(s => s.rows.some(r => r.point===pt && parseFloat(r[p])>0))
      );
      if (!paramsForPt.length) return;
      const svg = buildCombinedPointSvg(pt, paramsForPt);
      if (!svg) return;
      ptRendered++;

      // Peak severity across all params for this point
      let worstSev = 'NORMAL';
      const sevOrder = ['NORMAL','ALARM','ALERT','CRITICAL'];
      paramsForPt.forEach(p => {
        const lims = sevLimits[p];
        sessions.forEach(s => s.rows.filter(r=>r.point===pt).forEach(r=>{
          const v=parseFloat(r[p]); if(isNaN(v)||v<=0) return;
          const s2=v>=lims.critical?'CRITICAL':v>=lims.alert?'ALERT':v>=lims.alarm?'ALARM':'NORMAL';
          if(sevOrder.indexOf(s2)>sevOrder.indexOf(worstSev)) worstSev=s2;
        }));
      });
      const peakColor={CRITICAL:'#DC2626',ALERT:'#EA580C',ALARM:'#D97706',NORMAL:'#16A34A'}[worstSev];
      const peakBg={CRITICAL:'#fef2f2',ALERT:'#fff7ed',ALARM:'#fffbeb',NORMAL:'#f0fdf4'}[worstSev];

      html += `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06)">
        <div style="padding:9px 14px;border-bottom:1px solid #f3f4f6;display:flex;align-items:center;justify-content:space-between;gap:6px;background:linear-gradient(135deg,#f8fafc 0%,#eef2ff 100%)">
          <div style="display:flex;align-items:center;gap:7px">
            <span style="font-size:13px;font-weight:700;color:#111827">📍 ${escHtml(pt)}</span>
            <span style="font-size:10px;font-weight:700;color:${peakColor};background:${peakBg};padding:2px 7px;border-radius:6px;border:1px solid ${peakColor}30">${worstSev}</span>
          </div>
          <span style="font-size:10px;color:#9ca3af">${paramsForPt.length} param${paramsForPt.length!==1?'s':''}</span>
        </div>
        <div style="padding:10px 6px 4px;overflow-x:auto;background:#fff">${svg}</div>
      </div>`;
    });
    html += '</div>';
    if (!ptRendered) html += `<div class="alert-box alert-info">No numerical readings found for this equipment.</div>`;
  }

  // ── Summary table (both modes) ───────────────────────────────────────────
  html += `<div style="margin-top:8px;border-top:1px solid var(--border);padding-top:12px">
    <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:8px">Latest readings by point</div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Point</th><th>Date</th><th>H Vel mm/s</th><th>V Vel mm/s</th><th>A Vel mm/s</th><th>Acc g</th><th>Severity</th></tr></thead>
      <tbody>
        ${points.map(pt => {
          const ptRows = allRows.filter(r => r.point === pt);
          const latest = ptRows.sort((a,b) => b.date.localeCompare(a.date))[0];
          if (!latest) return '';
          return `<tr>
            <td style="font-weight:600">${escHtml(pt)}</td>
            <td>${escHtml(latest.date)}</td>
            <td>${escHtml(latest.H_Vel||'—')}</td><td>${escHtml(latest.V_Vel||'—')}</td><td>${escHtml(latest.A_Vel||'—')}</td><td>${escHtml(latest.Acc||'—')}</td>
            <td>${badgeHtml(latest.severity)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>
  </div>`;

  trendBody.innerHTML = html;
  trendModal.classList.add('open');
  trendModal.style.display = 'flex';
}

function showPointDetail(equip, point, date){
  const r = READINGS.find(x=>x.equipment===equip && x.point===point && x.date===date);
  if(!r){ alert('No reading found for this point.'); return; }
  const fields=[['H Vel','H_Vel','mm/s'],['V Vel','V_Vel','mm/s'],['A Vel','A_Vel','mm/s'],['Acc','Acc','g'],['H Dis','H_Dis','\u00b5m'],['V Dis','V_Dis','\u00b5m'],['A Dis','A_Dis','\u00b5m']];
  let rowsHtml='';
  fields.forEach(([lbl,key,unit])=>{
    const val=r[key];
    if(val===''||val===undefined||val===null) return;
    const t=key.toLowerCase().includes('acc')?'acc':key.toLowerCase().includes('dis')?'dis':'vel';
    const sev=getSev(val,t,equip)||'NORMAL';
    rowsHtml+=`<tr><td style="padding:6px 8px;border-bottom:1px solid var(--border)">${escHtml(lbl)}</td><td style="padding:6px 8px;border-bottom:1px solid var(--border);font-weight:700;text-align:right">${escHtml(String(val))} <span style="font-weight:400;color:var(--muted);font-size:11px">${unit}</span></td><td style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:right">${badgeHtml(sev)}</td></tr>`;
  });
  const recs=(r.recommendations||'').split('|').map(x=>x.trim()).filter(Boolean);
  const ptSev=r.severity||'NORMAL';
  const ex=document.getElementById('_pt_detail'); if(ex)ex.remove();
  const modal=document.createElement('div');
  modal.id='_pt_detail';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.onclick=function(e){if(e.target===modal)modal.remove();};
  modal.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:440px;width:100%;max-height:85vh;overflow:auto;box-shadow:0 12px 40px rgba(0,0,0,.3)">
    <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:8px">
      <div><div style="font-weight:700;font-size:14px">\ud83d\udccd ${escHtml(equip)} — ${escHtml(point)}</div><div style="font-size:11px;color:var(--muted);margin-top:3px">\ud83d\udcc5 ${escHtml(date)} · ${badgeHtml(ptSev)}</div></div>
      <button onclick="document.getElementById('_pt_detail').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7280;line-height:1">\u00d7</button>
    </div>
    <div style="padding:12px 16px">
      <table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr><th style="text-align:left;padding:5px 8px;color:var(--muted);font-size:11px;font-weight:600">Parameter</th><th style="text-align:right;padding:5px 8px;color:var(--muted);font-size:11px;font-weight:600">Value</th><th style="text-align:right;padding:5px 8px;color:var(--muted);font-size:11px;font-weight:600">Status</th></tr></thead><tbody>${rowsHtml||'<tr><td colspan="3" style="padding:8px;color:var(--muted)">No values recorded.</td></tr>'}</tbody></table>
      ${recs.length?`<div style="margin-top:12px"><div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px">RECOMMENDATIONS</div>${recs.map(x=>`<div style="font-size:12px;padding:4px 0;border-bottom:1px solid var(--border)">\u2022 ${escHtml(x)}</div>`).join('')}</div>`:''}
      <div style="margin-top:10px;font-size:11px;color:var(--muted)">\ud83d\udc64 ${escHtml(r.inspector||'\u2014')}</div>
    </div>
  </div>`;
  document.body.appendChild(modal);
}

function showTrend(equip,pt){showEquipTrend(equip);}
function closeTrend(){const m=document.getElementById('trend-modal'); if(m){m.classList.remove('open');m.style.display='';} }

// Delegated handler for the By Parameter / By Point toggle buttons.
// Called via onclick="_trendSwitchMode(this)" — avoids embedding single-quoted
// string literals inside a double-quoted HTML attribute (which breaks innerHTML parsing).
function _trendSwitchMode(btn) {
  const mode = btn.getAttribute('data-trendmode'); // 'param' or 'point'
  const equip = window._trendToggleEquip || '';
  const autoscaleChk = document.getElementById('trend-autoscale-chk');
  const autoscale = autoscaleChk ? autoscaleChk.checked : true;
  showEquipTrend(equip, autoscale, mode);
}
