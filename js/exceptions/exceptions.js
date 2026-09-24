/* VibeMon — Exceptions tab */

// ======= EXCEPTIONS TAB =======

function getExcFilters() {
  return {
    from:   document.getElementById('exc-from')?.value   || '',
    to:     document.getElementById('exc-to')?.value     || '',
    unit:   document.getElementById('exc-unit')?.value   || '',
    area:   document.getElementById('exc-area')?.value   || '',
    equip:  document.getElementById('exc-equip')?.value  || '',
    sev:    document.getElementById('exc-sev')?.value    || '',
    dept:   document.getElementById('exc-dept')?.value   || '',
    user:   document.getElementById('exc-user')?.value   || '',
    q:     (document.getElementById('exc-search')?.value || '').toLowerCase()
  };
}

function excFilteredRows() {
  const f = getExcFilters();
  const excSevs = f.sev ? [f.sev] : ['ALERT','CRITICAL'];

  // Step 1: Apply non-severity filters to ALL readings to find the latest date per equipment
  const baseFiltered = READINGS.filter(r =>
    (!f.from  || r.date >= f.from) &&
    (!f.to    || r.date <= f.to)   &&
    (!f.unit  || r.unit  === f.unit)  &&
    (!f.area  || r.area  === f.area)  &&
    (!f.equip || r.equipment === f.equip) &&
    (!f.user  || r.username === f.user || r.inspector === f.user) &&
    (!f.q     || r.equipment.toLowerCase().includes(f.q))
  );

  // Step 2: Find the latest date (and reportId if available) per equipment
  const latestByEquip = {};
  baseFiltered.forEach(r => {
    const key = r.equipment;
    const existing = latestByEquip[key];
    if (!existing || r.date > existing.date ||
        (r.date === existing.date && (r.createdOn||'') > (existing.createdOn||''))) {
      latestByEquip[key] = { date: r.date, reportId: r.reportId||null, createdOn: r.createdOn||'' };
    }
  });

  // Step 3: Keep only rows from the latest reading session per equipment,
  // AND only if that session has at least one exception severity reading
  const latestRows = baseFiltered.filter(r => {
    const latest = latestByEquip[r.equipment];
    if (!latest) return false;
    if (r.reportId && latest.reportId) return r.reportId === latest.reportId;
    return r.date === latest.date;
  });

  // Step 4: Determine which equipments have an exception in their latest session
  const equipHasException = new Set();
  latestRows.forEach(r => {
    if (excSevs.includes(r.severity)) equipHasException.add(r.equipment);
  });

  // Step 5: Return only rows from equipments whose latest session has exceptions,
  // filtered by severity (so we show only the exception-severity point rows)
  return latestRows.filter(r =>
    excSevs.includes(r.severity) && equipHasException.has(r.equipment) &&
    (!f.dept || excDeptFor(r.equipment, r.responsibleDept) === f.dept)
  );
}

function populateExcFilters() {
  // Unit, Area
  ['exc-unit','exc-area'].forEach(id=>{
    const isUnit = id==='exc-unit';
    const el = document.getElementById(id); if(!el) return;
    const cur = el.value; while(el.options.length>1) el.remove(1);
    const vals = [...new Set(MASTER.map(e=>isUnit?e.unit:e.area))].sort();
    vals.forEach(v=>el.add(new Option(v,v)));
    if(cur) el.value=cur;
  });
  // Equipment — from exception rows
  const excEl = document.getElementById('exc-equip'); if(!excEl) return;
  const curEq = excEl.value; while(excEl.options.length>1) excEl.remove(1);
  const equips = [...new Set(READINGS.filter(r=>['ALERT','CRITICAL'].includes(r.severity)).map(r=>r.equipment))].sort();
  equips.forEach(e=>excEl.add(new Option(e,e)));
  if(curEq) excEl.value=curEq;
  // Resp Dept — auto-fetched from readings (reading-entered dept, with legacy fallback)
  const deptEl = document.getElementById('exc-dept'); if(!deptEl) return;
  const curDept = deptEl.value; while(deptEl.options.length>1) deptEl.remove(1);
  const usedDeptSet = new Set();
  READINGS.filter(r=>['ALERT','CRITICAL'].includes(r.severity)).forEach(r=>{
    const d = excDeptFor(r.equipment, r.responsibleDept); if(d) usedDeptSet.add(d);
  });
  [...usedDeptSet].sort().forEach(d=>deptEl.add(new Option(d,d)));
  if(curDept) deptEl.value=curDept;
  // Users
  const usrEl = document.getElementById('exc-user'); if(!usrEl) return;
  const curUsr = usrEl.value; while(usrEl.options.length>1) usrEl.remove(1);
  const usrs = [...new Set(READINGS.map(r=>r.username||r.inspector).filter(Boolean))].sort();
  usrs.forEach(u=>usrEl.add(new Option(u,u)));
  if(curUsr) usrEl.value=curUsr;
}

// ── Exceptions sub-tab switcher ──
function switchExcTab(tab) {
  // Field Engineer App: only schedule exceptions panel exists
  renderPending();
}

function resetExcFilters() {
  ['exc-from','exc-to','exc-search'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  ['exc-unit','exc-area','exc-equip','exc-sev','exc-dept','exc-user'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  renderExceptions();
}

function renderExceptions() {
  populateExcFilters();
  const rows = excFilteredRows();
  const container = document.getElementById('exc-results');
  if(!container) return;

  // KPI strip
  const kpiEl = document.getElementById('exc-kpis');
  const cnt = {ALARM:0,ALERT:0,CRITICAL:0};
  const equips = new Set();
  rows.forEach(r=>{ if(cnt[r.severity]!==undefined) cnt[r.severity]++; equips.add(r.equipment); });
  if(kpiEl) kpiEl.innerHTML=`
    <div class="kpi" style="border-left-color:#DC2626">
      <div class="kpi-val" style="color:#DC2626">${cnt.CRITICAL}</div>
      <div class="kpi-lbl">🚨 Critical readings</div>
    </div>
    <div class="kpi kpi-at">
      <div class="kpi-val">${cnt.ALERT}</div>
      <div class="kpi-lbl">🔶 Alert readings</div>
    </div>
    <div class="kpi kpi-a">
      <div class="kpi-val">${cnt.ALARM}</div>
      <div class="kpi-lbl">⚠️ Alarm readings</div>
    </div>
    <div class="kpi" style="border-left-color:var(--blue)">
      <div class="kpi-val">${equips.size}</div>
      <div class="kpi-lbl">Equipment affected</div>
    </div>`;

  if(!rows.length) {
    container.innerHTML=`<div class="card"><div class="card-body" style="text-align:center;padding:32px;color:var(--muted)">
      <div style="font-size:32px;margin-bottom:10px">✅</div>
      <div style="font-weight:600;font-size:14px;margin-bottom:6px">No exceptions found</div>
      <div style="font-size:12px">No Alarm, Alert or Critical readings match the current filters.<br><small style="color:var(--hint)">Only the latest reading per equipment is shown. If latest reading is Normal, it will not appear here.</small></div>
    </div></div>`;
    return;
  }

  // Group by equipment + session (same as history)
  const sessionMap={};const _noidCE={};
  rows.forEach(r=>{
    let key;
    if(r.reportId){key=r.reportId+'||'+r.equipment;}
    else{const b=r.date+'||'+r.equipment+'||'+(r.inspector||r.username||'')+'||'+(r.createdOn||'');if(!_noidCE[b])_noidCE[b]=0;key=b||('_noid_E'+(_noidCE[b]++));}
    if(!sessionMap[key]) sessionMap[key]={date:r.date,equipment:r.equipment,unit:r.unit,area:r.area,inspector:r.inspector||r.username||'',rows:[],reportId:r.reportId||''};
    sessionMap[key].rows.push(r);
  });
  const sessions=Object.values(sessionMap).sort((a,b)=>b.date.localeCompare(a.date)||a.equipment.localeCompare(b.equipment));
  const shown = sessions.slice(0,200);

  // Always show all 7 parameter columns (matches the sheet-style report layout)
  const paramKeys  = ['H_Vel','V_Vel','A_Vel','Acc','H_Dis','V_Dis','A_Dis'];
  const paramLabels={H_Vel:'H Vel',V_Vel:'V Vel',A_Vel:'A Vel',Acc:'Acc',H_Dis:'H Dis',V_Dis:'V Dis',A_Dis:'A Dis'};
  const paramUnits ={H_Vel:'mm/s',V_Vel:'mm/s',A_Vel:'mm/s',Acc:'g',H_Dis:'µm',V_Dis:'µm',A_Dis:'µm'};
  const sevBlockColor={CRITICAL:'#B91C1C',ALERT:'#7A2E1E',ALARM:'#E07B1A',NORMAL:'#1E8449'};

  // Summary table — Excel/sheet style, with merged (rowspan) cells per equipment session
  let html=`<div class="card">
    <div class="card-head">
      <span class="card-title">🚨 Exception Readings — Latest Only <small style="font-weight:400;color:var(--muted)">${sessions.length} equipment, ${rows.length} exception readings</small></span>
      <span style="font-size:11px;color:var(--muted)">Showing latest reading per equipment only</span>
    </div>
    <div class="tbl-wrap">
      <table class="exc-table">
        <thead><tr>
          <th>Date</th><th>Equipment</th><th>Unit</th><th>Area</th><th>Overall Severity</th>
          <th>Point</th>
          ${paramKeys.map(k=>`<th>${paramLabels[k]}<span class="u">${paramUnits[k]}</span></th>`).join('')}
          <th>Recommendations</th>
          <th>Responsible Dept<span class="u">Auto from reading</span></th>
        </tr></thead>
        <tbody>`;

  shown.forEach((s,si)=>{
    const os=worstSev(s.rows.map(r=>r.severity));
    const rspan=s.rows.length;
    const grpCls = si%2===0 ? 'exc-grp-a' : 'exc-grp-b';
    const allRecs=[...new Set(s.rows.map(r=>r.recommendations||'').filter(Boolean).join('|').split('|').map(x=>x.trim()).filter(Boolean))];
    const recsHtml = allRecs.length ? allRecs.slice(0,3).join(' • ')+(allRecs.length>3?` +${allRecs.length-3} more`:'') : '<span style="color:var(--hint)">—</span>';
    const sessionDept = (s.rows.find(r=>r.responsibleDept)||{}).responsibleDept || '';
    const currentDept = excDeptFor(s.equipment, sessionDept);

    sortRowsByMasterPoints(s.rows, s.equipment).forEach((r,ri)=>{
      const ptSev=r.severity||'NORMAL';
      const ptEmoji={NORMAL:'✅',ALARM:'⚠️',ALERT:'🔶',CRITICAL:'🚨'}[ptSev]||'';
      html+=`<tr class="${grpCls}">`;
      if(ri===0){
        html+=`<td class="exc-date" rowspan="${rspan}">${s.date}</td>
          <td class="exc-equip" rowspan="${rspan}"><a href="#" onclick="showEquipTrend(${jsArg(s.equipment)});return false">${escHtml(s.equipment)}</a></td>
          <td class="exc-unit" rowspan="${rspan}">${s.unit}</td>
          <td class="exc-area" rowspan="${rspan}">${s.area}</td>
          <td rowspan="${rspan}" style="padding:0;border:1px solid #D9E1E8"><div class="exc-sev-block" style="background:${sevBlockColor[os]||sevBlockColor.NORMAL}">${os}</div></td>`;
      }
      // Point column — shown on every row
      html+=`<td class="exc-val" style="font-weight:600;white-space:nowrap;min-width:80px">${ptEmoji} ${r.point||'—'}</td>`;
      html+=paramKeys.map(k=>{
        const v=r[k];
        if(v===''||v===undefined||v===null) return '<td class="exc-val" style="color:var(--hint)">—</td>';
        const type=k.toLowerCase().includes('acc')?'acc':k.toLowerCase().includes('dis')?'dis':'vel';
        const sv=getSev(v,type,r.equipment);
        const style=sv==='CRITICAL'?'color:#DC2626;font-weight:700':sv==='ALERT'?'color:#EA580C;font-weight:700':sv==='ALARM'?'color:#D97706;font-weight:600':'';
        return `<td class="exc-val" style="${style}">${parseFloat(v).toFixed(2)}</td>`;
      }).join('');
      if(ri===0){
        html+=`<td class="exc-recs" rowspan="${rspan}">${recsHtml}</td>`;
        html+=`<td rowspan="${rspan}" style="text-align:center;vertical-align:middle;min-width:110px;width:110px;border:1px solid #D9E1E8;white-space:normal;word-break:break-word">
          ${currentDept ? `<span class="ss-dept-badge">${currentDept}</span>` : '<span style="color:var(--hint);font-size:11px">—</span>'}
        </td>`;
      }
      html+=`</tr>`;
    });
  });

  html+=`</tbody></table></div>
    ${sessions.length>200?`<div style="padding:8px 14px;font-size:11px;color:var(--muted)">Showing 200 sessions maximum. Use filters to narrow results.</div>`:''}
  </div>`;
  container.innerHTML=html;
}
