/* VibeMon — History tab (grouped sessions) */

// ---- HISTORY ----
// ── HISTORY: group by equipment+date session ──────────────────────────────
// ---- HISTORY: UPDATE SESSION SEVERITY ----
function updateHistorySeverity(date, equipment, newSev, sessionKey) {
  if (!newSev) return; // no-op if "Auto" selected
  // sessionKey is passed from the select's onchange — it's the reportId or date||equipment
  const keyToUse = sessionKey || (date + '||' + equipment);
  // Update all point rows for this session in READINGS memory
  const reportId = sessionKey || (READINGS.find(r => r.date === date && r.equipment === equipment) || {}).reportId || null;
  READINGS.forEach(r => {
    const rKey = r.reportId ? r.reportId : (r.date + '||' + r.equipment);
    if (rKey === keyToUse) {
      r.severity = newSev;
    }
  });
  saveReadings();
  // Sync severity change to Supabase
  if (reportId) {
    _supabase
      .from('readings')
      .update({ severity: newSev, updated_on: _localNowStr() })
      .eq('report_id', reportId)
      .then(({ error }) => { if (error) console.warn('Supabase severity update failed:', error.message); });
  }
  // Update just the badge in this card without full re-render (smooth UX)
  const badgeEl = document.querySelector(`[data-session-badge="${CSS.escape(keyToUse)}"]`);
  if (badgeEl) badgeEl.innerHTML = badgeHtml(newSev);
  // Update card border color
  const cardEl = document.querySelector(`[data-session-key="${CSS.escape(keyToUse)}"]`);
  if (cardEl) {
    const colors = {NORMAL:'var(--green)',ALARM:'#D97706',ALERT:'var(--orange)',CRITICAL:'#DC2626'};
    cardEl.style.borderLeft = `4px solid ${colors[newSev]||'var(--border)'}`;
  }
}

function updateHistoryDept(date, equipment, newDept, sessionKey) {
  if (!newDept) return; // no-op on blank
  const keyToUse = sessionKey || (date + '||' + equipment);
  // Resolve reportId from sessionKey or first matching row
  const reportId = (READINGS.find(r => {
    const rKey = r.reportId ? r.reportId : (r.date + '||' + r.equipment);
    return rKey === keyToUse;
  }) || {}).reportId || null;
  // Update in-memory rows for this session
  READINGS.forEach(r => {
    const rKey = r.reportId ? r.reportId : (r.date + '||' + r.equipment);
    if (rKey === keyToUse) r.responsibleDept = newDept;
  });
  saveReadings();
  // Sync dept change to Supabase (fire-and-forget)
  if (reportId) {
    _supabase
      .from('readings')
      .update({ responsible_dept: newDept, updated_on: _localNowStr() })
      .eq('report_id', reportId)
      .then(({ error }) => { if (error) console.warn('Supabase dept update failed:', error.message); });
  }
  // Update the dept badge in the card without full re-render
  const deptBadgeEl = document.querySelector(`[data-session-dept="${CSS.escape(keyToUse)}"]`);
  if (deptBadgeEl) deptBadgeEl.textContent = newDept || '—';
}

function renderHistory() {
  const from=document.getElementById('h-from').value;
  const to=document.getElementById('h-to').value;
  const unit=document.getElementById('h-unit').value;
  const area=document.getElementById('h-area').value;
  const sev=document.getElementById('h-sev').value;
  const decoupledFilter=document.getElementById('h-decoupled')?.value||'';
  const q=document.getElementById('h-search').value.toLowerCase();

  // Populate h-user dropdown dynamically
  const hUserSel=document.getElementById('h-user');
  if(hUserSel){
    const currentVal=hUserSel.value;
    const users=[...new Set(READINGS.map(r=>r.username||r.inspector).filter(Boolean))].sort();
    while(hUserSel.options.length>1) hUserSel.remove(1);
    users.forEach(u=>{const o=document.createElement('option');o.value=u;o.textContent=u;hUserSel.add(o);});
    if(users.includes(currentVal)) hUserSel.value=currentVal;
  }
  const user=hUserSel?hUserSel.value:'';
  const sortDir=(document.getElementById('h-sort')?.value||'desc')==='asc'?1:-1;

  let rows=READINGS.filter(r=>
    (!from||r.date>=from)&&(!to||r.date<=to)&&
    (!unit||r.unit===unit)&&(!area||r.area===area)&&
    (!user||(r.username===user||r.inspector===user))&&
    (!q||r.equipment.toLowerCase().includes(q))
  ).sort((a,b)=>{
    const aKey=(a.date||'')+'T'+(a.createdOn||'');
    const bKey=(b.date||'')+'T'+(b.createdOn||'');
    return sortDir*aKey.localeCompare(bKey)||a.equipment.localeCompare(b.equipment);
  });

  // Group into sessions: primary key = reportId + equipment (equipment included as safety net against duplicate reportIds)
  // Fallback for old data without reportId: use date+equipment+createdOn so same-day same-equipment re-entries each get their own card.
  const sessionMap={};
  const noIdCounters={};
  rows.forEach(r=>{
    let key;
    if(r.reportId){
      // Always scope reportId to equipment to prevent cross-equipment merges from old duplicate IDs
      key = r.reportId + '||' + r.equipment;
    } else {
      const base = r.date + '||' + r.equipment + '||' + (r.inspector||r.username||'') + '||' + (r.createdOn||'');
      if(!noIdCounters[base]) noIdCounters[base]=0;
      key = base || ('_noid_'+(noIdCounters[base]++));
    }
    if(!sessionMap[key]) sessionMap[key]={
      date:r.date, equipment:r.equipment, unit:r.unit, area:r.area,
      inspector:r.inspector, rows:[], recs:r.recommendations||'',
      reportId:r.reportId||'', createdOn:r.createdOn||'',
      isDecoupled: r.isDecoupled || (r.remarks && r.remarks.includes('Decoupled Trial')) || false
    };
    sessionMap[key].rows.push(r);
    // Keep isDecoupled updated from all rows (in case first row didn't have the flag)
    if (r.isDecoupled || (r.remarks && r.remarks.includes('Decoupled Trial'))) {
      sessionMap[key].isDecoupled = true;
    }
  });
  const sessionList=Object.values(sessionMap).sort((a,b)=>{
    const aKey=(a.date||'')+'T'+(a.createdOn||'');
    const bKey=(b.date||'')+'T'+(b.createdOn||'');
    return sortDir*aKey.localeCompare(bKey)||a.equipment.localeCompare(b.equipment);
  });

  // Filter by severity at session level
  let filtered=sev ? sessionList.filter(s=>worstSev(s.rows.map(r=>r.severity))===sev) : sessionList;
  // Filter by decoupled trial
  if (decoupledFilter === 'yes') {
    filtered = filtered.filter(s => s.rows.some(r => r.isDecoupled || (r.remarks && r.remarks.includes('Decoupled Trial'))));
  } else if (decoupledFilter === 'no') {
    filtered = filtered.filter(s => !s.rows.some(r => r.isDecoupled || (r.remarks && r.remarks.includes('Decoupled Trial'))));
  }

  const totalRecs=filtered.length;
  // Re-use h-count if it exists; if not just skip
  const countEl=document.querySelector('#tab-history .card-title small');
  const container=document.getElementById('history-groups');
  container.innerHTML='';

  if(!filtered.length){
    container.innerHTML='<div class="card"><div class="card-body" style="text-align:center;padding:30px;color:var(--muted)">No readings found for selected filters.</div></div>';
    return;
  }

  // Show count in a small header bar
  const hdr=document.createElement('div');
  hdr.style='display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:6px';
  hdr.innerHTML=`<span style="font-size:12px;color:var(--muted)">${filtered.length} equipment session${filtered.length!==1?'s':''} · ${rows.filter(r=>sev?r.severity===sev:true).length} readings</span>
    <span style="font-size:11px;color:var(--muted)">Click equipment name to view trend</span>`;
  container.appendChild(hdr);

  // PERF: precompute per-equipment distinct reportId/date counts ONCE (O(n)) instead of
  // re-scanning the entire READINGS array inside the per-session loop below (was O(n*m)
  // and the main cause of History tab slowness with large datasets).
  const equipDistinctKeyCount={};
  READINGS.forEach(r=>{
    if(!r.equipment) return;
    const k=r.equipment;
    let set=equipDistinctKeyCount[k];
    if(!set){ set=new Set(); equipDistinctKeyCount[k]=set; }
    set.add(r.reportId||r.date);
  });

  filtered.slice(0,300).forEach(session=>{
    const os=worstSev(session.rows.map(r=>r.severity));
    const card=document.createElement('div');
    card.className='card';
    card.style='margin-bottom:10px';

    // Collect unique recommendations (de-duplicate)
    const allRecs=[...new Set(session.rows.map(r=>r.recommendations||'').filter(Boolean).join('|').split('|').map(s=>s.trim()).filter(Boolean))];

    // Determine which param columns have data
    const paramKeys=['H_Vel','V_Vel','A_Vel','Acc','H_Dis','V_Dis','A_Dis'];
    const paramLabels={'H_Vel':'H Vel','V_Vel':'V Vel','A_Vel':'A Vel','Acc':'Acc','H_Dis':'H Dis','V_Dis':'V Dis','A_Dis':'A Dis'};
    const paramUnits={'H_Vel':'mm/s','V_Vel':'mm/s','A_Vel':'mm/s','Acc':'g','H_Dis':'µm','V_Dis':'µm','A_Dis':'µm'};
    const activeCols=paramKeys.filter(k=>session.rows.some(r=>r[k]!==undefined&&r[k]!==''));

    // Check if equipment has multi-date history for trend button (now O(1) lookup)
    const hasMultiDate=(equipDistinctKeyCount[session.equipment]?.size||0)>1;

    const sessionKey = session.reportId ? session.reportId : (session.date + '||' + session.equipment);
    const sevBorderColors = {NORMAL:'#1E8449',ALARM:'#D97706',ALERT:'#EA580C',CRITICAL:'#DC2626'};
    card.setAttribute('data-session-key', sessionKey);
    card.style.borderLeft = `4px solid ${sevBorderColors[os] || '#e2e4e8'}`;
    card.style.borderRadius = 'var(--radius-lg)';

    const sessionDept = (session.rows.find(r=>r.responsibleDept)||{}).responsibleDept || '';
    const safeDept = sessionDept.replace(/'/g, "\\'");
    card.innerHTML = `
      <div class="card-head" style="background:var(--bg-card-header)">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-size:14px;font-weight:700;cursor:pointer;color:var(--blue)"
            onclick="showEquipTrend(${jsArg(session.equipment)})">📍 ${escHtml(session.equipment)}</span>
          <span style="font-size:12px;color:var(--muted)">${session.unit} · ${session.area}</span>
          <span data-session-badge="${sessionKey}">${badgeHtml(os)}</span>
          ${hasMultiDate ? `<button class="btn btn-sm" style="color:var(--blue);border-color:var(--blue)" onclick="showEquipTrend(${jsArg(session.equipment)})">📈 Trend</button>` : ''}
          ${(AUTH.role==='admin'||(AUTH.role==='editor'&&((session.inspector||'')=== AUTH.displayName||(session.rows[0]&&session.rows[0].username===AUTH.username)))) ? `<label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;background:${session.isDecoupled?'#FEF3C7':'var(--bg)'};border:1px solid ${session.isDecoupled?'#D97706':'var(--border2)'};border-radius:var(--radius);padding:3px 8px;font-size:11px;font-weight:600;color:#92400E" title="Toggle Decoupled Trial status"><input type="checkbox" ${session.isDecoupled?'checked':''} onchange="toggleHistoryDecoupled(${jsArg(session.date)},${jsArg(session.equipment)},${jsArg(session.reportId||'')},this.checked)" style="width:14px;height:14px;cursor:pointer;accent-color:#D97706;margin:0">Decoupled</label>` : (session.isDecoupled ? `<span style="display:inline-flex;align-items:center;gap:4px;background:#FEF3C7;border:1px solid #D97706;border-radius:var(--radius);padding:3px 8px;font-size:11px;font-weight:600;color:#92400E">🔗 Decoupled</span>` : '')}
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <span style="font-size:11px;color:var(--muted)">📅 ${fmtDateDisplay(session.date)}</span>
          ${session.createdOn ? `<span style="font-size:11px;color:var(--muted)" title="Entry time (local)">🕐 ${(session.createdOn.replace('T',' ').split(' ')[1] || '').slice(0,8)}</span>` : ''}
          <span style="font-size:11px;color:var(--muted)">👤 ${session.inspector || '—'}</span>
          <div title="Overall equipment status" style="display:inline-flex;align-items:center;gap:4px;background:var(--bg);border:1px solid var(--border2);border-radius:var(--radius);padding:3px 7px">
            <span style="font-size:9px;font-weight:700;color:var(--muted);letter-spacing:.04em">STATUS</span>
            ${(AUTH.role === 'viewer' || (AUTH.role === 'editor' && session.date !== _todayFmt()))
              ? `<span style="font-size:11px;font-weight:700;padding:1px 2px">${badgeHtml(os)}</span>`
              : `<select onchange="updateHistorySeverity(${jsArg(session.date)},${jsArg(session.equipment)},this.value,${jsArg(sessionKey)})"
              style="font-size:11px;font-weight:700;border:none;background:transparent;color:var(--text);padding:1px 2px;cursor:pointer;max-width:140px">
              <option value="">— Change —</option>
              <option value="NORMAL"   ${os==='NORMAL'  ?'selected':''} style="color:#1E8449">✅ NORMAL</option>
              <option value="ALARM"    ${os==='ALARM'   ?'selected':''} style="color:#D97706">⚠️ ALARM</option>
              <option value="ALERT"    ${os==='ALERT'   ?'selected':''} style="color:#EA580C">🔶 ALERT</option>
              <option value="CRITICAL" ${os==='CRITICAL'?'selected':''} style="color:#DC2626">🚨 CRITICAL</option>
            </select>`}
          </div>
          ${(AUTH.role === 'admin' || (AUTH.role === 'editor' && session.date === _todayFmt())) ? `
          <div title="Responsible Department" style="display:inline-flex;align-items:center;gap:4px;background:var(--bg);border:1px solid var(--border2);border-radius:var(--radius);padding:3px 7px">
            <span style="font-size:9px;font-weight:700;color:var(--muted);letter-spacing:.04em">DEPT</span>
            <select onchange="updateHistoryDept(${jsArg(session.date)},${jsArg(session.equipment)},this.value,${jsArg(sessionKey)})"
              style="font-size:11px;font-weight:700;border:none;background:transparent;color:var(--text);padding:1px 2px;cursor:pointer;max-width:110px">
              <option value="">— Set —</option>
              ${(typeof DEPTS_LIST!=='undefined'?DEPTS_LIST:['AHD','CHP','EMD','OFS','BMD','TMD','C&I','TAD']).map(d=>`<option value="${d}" ${sessionDept===d?'selected':''}>${d}</option>`).join('')}
            </select>
          </div>` : (sessionDept ? `<div style="display:inline-flex;align-items:center;gap:4px;background:var(--bg);border:1px solid var(--border2);border-radius:var(--radius);padding:3px 7px"><span style="font-size:9px;font-weight:700;color:var(--muted);letter-spacing:.04em">DEPT</span><span style="font-size:11px;font-weight:700" data-session-dept="${sessionKey}">${sessionDept}</span></div>` : '')}
          ${(AUTH.role==='admin'||(AUTH.role==='editor'&&((session.inspector||'')=== AUTH.displayName||(session.rows[0]&&session.rows[0].username===AUTH.username))&&session.date===_todayFmt())) ? `<button class="btn btn-sm" style="color:var(--blue);border-color:var(--blue)" onclick="openEditReport(${jsArg(session.date)},${jsArg(session.equipment)},${jsArg(session.reportId||'')})">✏️ Edit</button>` : ''}
          ${AUTH.role==='admin' ? `<button class="btn btn-sm" style="color:var(--red);border-color:var(--red)" onclick="deleteSessionReadings(${jsArg(session.date)},${jsArg(session.equipment)},${jsArg(session.reportId||'')})">🗑 Delete</button>` : ''}
          ${AUTH.role!=='viewer' ? `<button class="btn btn-sm btn-wa" onclick="openWASessionModal(${jsArg(session.date)},${jsArg(session.equipment)},${jsArg(session.reportId||'')})">📲 WhatsApp</button>` : ''}
        </div>
      </div>
      <div class="tbl-wrap">
        <table>
          <thead><tr>
            <th style="min-width:100px">Point</th>
            ${activeCols.map(k => `<th style="min-width:70px">${paramLabels[k]}<br><span style="font-weight:400;font-size:9px">${paramUnits[k]}</span></th>`).join('')}
          </tr></thead>
          <tbody>
            ${sortRowsByMasterPoints(session.rows, session.equipment).map(r => {
              const liveSevs = activeCols.map(k => {
                const v = r[k]; if (!v && v !== 0) return '';
                const type = k.toLowerCase().includes('acc') ? 'acc' : k.toLowerCase().includes('dis') ? 'dis' : 'vel';
                return getSev(v, type, r.equipment);
              }).filter(Boolean);
              const ptSev = liveSevs.length ? worstSev(liveSevs) : (r.severity || 'NORMAL');
              const rowBg = ptSev==='CRITICAL'?'background:var(--sev-critical-bg,#FFF0F0)':ptSev==='ALERT'?'background:var(--sev-alert-bg,#FFF4EE)':ptSev==='ALARM'?'background:var(--sev-alarm-bg,#FFFBEB)':'';
              const ptEmoji = {NORMAL:'✅',ALARM:'⚠️',ALERT:'🔶',CRITICAL:'🚨'}[ptSev] || '';
              return `<tr style="${rowBg}">
                <td style="font-weight:600">${ptEmoji} ${r.point}</td>
                ${activeCols.map(k => {
                  const v = r[k]; if (!v && v !== 0) return '<td style="color:var(--hint)">—</td>';
                  const type = k.toLowerCase().includes('acc') ? 'acc' : k.toLowerCase().includes('dis') ? 'dis' : 'vel';
                  const sv = getSev(v, type, r.equipment);
                  const style = sv==='CRITICAL'?'color:#DC2626;font-weight:700':sv==='ALERT'?'color:#EA580C;font-weight:700':sv==='ALARM'?'color:#D97706;font-weight:600':'color:var(--green)';
                  return `<td style="${style}">${parseFloat(v).toFixed(2)}</td>`;
                }).join('')}
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      ${allRecs.length ? `
      <div style="padding:8px 14px;border-top:1px solid var(--border);background:var(--bg-card-header,#fafbfc)">
        <span style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em">Recommendations</span>
        <div style="margin-top:5px;display:flex;flex-direction:column;gap:3px">
          ${allRecs.map((rec, i) => `<div style="font-size:12px;display:flex;gap:6px"><span style="color:var(--muted);min-width:14px">${i+1}.</span><span>${rec}</span></div>`).join('')}
        </div>
      </div>` : ''}
      ${(()=>{
        const sessionRemarks=[...new Set(session.rows.map(r=>r.remarks||'').filter(Boolean))].join(' | ');
        if(!sessionRemarks) return '';
        const isDecoupledRemark = sessionRemarks.includes('Decoupled Trial');
        return `<div style="padding:8px 14px;border-top:1px solid var(--border);background:${isDecoupledRemark?'#FFFBEB':'var(--bg-card-header,#fafbfc)'}">
          <span style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em">Remarks</span>
          <div style="margin-top:4px;font-size:12px;color:${isDecoupledRemark?'#92400E':'var(--text)'}">
            ${isDecoupledRemark?'🔗 ':''}${escHtml(sessionRemarks)}
          </div>
        </div>`;
      })()}`;

    container.appendChild(card); // ← attach card to DOM
  });

  if(filtered.length>300){
    const more=document.createElement('div');
    more.style='text-align:center;padding:10px;font-size:12px;color:var(--muted)';
    more.textContent=`Showing 300 of ${filtered.length} sessions. Use filters to narrow results.`;
    container.appendChild(more);
  }
}
