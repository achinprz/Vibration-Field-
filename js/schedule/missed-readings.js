/* VibeMon — Missed Readings tab */

// ============================================================
// MISSED READINGS — Features 5, 6, 7, 8, 9
// ============================================================

let _mrAllRows = [];

function mrFreqDays(eq) {
  const f = parseInt(eq.frequency, 10);
  return isNaN(f) ? 30 : f;
}

function mrBuildRows() {
  const periodSel = document.getElementById('mr-period');
  const period = periodSel ? periodSel.value : '1';
  const today = new Date(); today.setHours(0,0,0,0);
  const latestMap = buildLastReadingMap();

  // Only include equipment that appears in the current team's daily schedule
  const team = dsCurrentTeam();
  const scheduledEquips = new Map(); // normalizedName -> {teams: [{team, schedDate}], equipName}
  if (team && VIBE_SCHEDULE) {
    // Always check ALL teams so we can find who was responsible
    const teamsToCheck = Object.keys(VIBE_SCHEDULE);
    const y = today.getFullYear(), m = today.getMonth();
    // Check current month and previous month schedules
    for (let mOff = -1; mOff <= 0; mOff++) {
      const cm = m + mOff;
      const cy = cm < 0 ? y - 1 : y;
      const am = cm < 0 ? cm + 12 : cm;
      const wds = dsWorkingDaysOfMonth(cy, am);
      teamsToCheck.forEach(t => {
        wds.forEach((dt, i) => {
          const items = dsSchedItems(t, i + 1, cy, am);   // the schedule version in force in that month
          items.forEach(it => {
            const nk = normalizeEquipName(it.n);
            const schedDateStr = dsFmt(dt);
            if (!scheduledEquips.has(nk)) {
              scheduledEquips.set(nk, { teams: [{ team: t, schedDate: schedDateStr }], equipName: it.n });
            } else {
              const existing = scheduledEquips.get(nk);
              // Add this team if not already present, or update schedDate if later
              const existingEntry = existing.teams.find(x => x.team === t);
              if (!existingEntry) {
                existing.teams.push({ team: t, schedDate: schedDateStr });
              } else if (schedDateStr > existingEntry.schedDate) {
                existingEntry.schedDate = schedDateStr; // update to latest schedule date
              }
            }
          });
        });
      });
    }
  }

  // If no schedule data, fall back to all MASTER
  const useScheduleFilter = scheduledEquips.size > 0;

  return MASTER.map(eq => {
    const nk = normalizeEquipName(eq.name);
    // Filter to schedule-only equipment
    if (useScheduleFilter && !scheduledEquips.has(nk)) return null;

    const last = latestMap[eq.name] || null;
    const lastDate = last ? new Date(last.date) : null;
    if (lastDate) lastDate.setHours(0,0,0,0);
    const freqDays = mrFreqDays(eq);
    const daysSince = lastDate ? Math.floor((today - lastDate) / 86400000) : null;

    // Missed = no reading ever OR overdue (days since > freq)
    const isMissed = !lastDate || (daysSince !== null && daysSince > freqDays);
    if (!isMissed) return null;

    let statusKey, statusLabel, statusColor, statusBg;
    const cyclesMissed = daysSince !== null ? Math.floor(daysSince / freqDays) : 99;
    if (!lastDate || daysSince === null) {
      statusKey='critical'; statusLabel='Never Read'; statusColor='#991B1B'; statusBg='#FEE2E2';
    } else if (cyclesMissed >= 3) {
      statusKey='critical'; statusLabel=cyclesMissed+' cycles missed'; statusColor='#991B1B'; statusBg='#FEE2E2';
    } else {
      statusKey='overdue'; statusLabel='Overdue '+(daysSince-freqDays)+'d'; statusColor='#EA580C'; statusBg='#FFEDD5';
    }

    const schedInfo = scheduledEquips.get(nk) || {};
    const teamsList = (schedInfo.teams || []);
    const responsibleGroup = teamsList.map(x => TEAM_NAME[x.team] || x.team).join(', ') || '—';
    const schedDate = teamsList.length > 0 ? teamsList[teamsList.length - 1].schedDate : '—';

    return {
      name: eq.name, unit: eq.unit, area: eq.area,
      frequency: freqDays, lastDate: last ? last.date : null,
      daysSince: daysSince !== null ? daysSince : 9999,
      responsibleGroup, responsibleTeams: teamsList, schedDate,
      statusKey, statusLabel, statusColor, statusBg, eqObj: eq
    };
  }).filter(Boolean).sort((a,b) => b.daysSince - a.daysSince); // Sort by days since descending
}

function mrPopulateFilters(rows) {
  const groupsSet = new Set();
  rows.forEach(r => {
    (r.responsibleTeams || []).forEach(x => {
      const name = TEAM_NAME[x.team] || x.team;
      if (name && name !== '—') groupsSet.add(name);
    });
  });
  const groups = [...groupsSet].sort();
  const el = document.getElementById('mr-f-group');
  if (el) {
    const cur = el.value; while(el.options.length>1) el.remove(1);
    groups.forEach(g => el.add(new Option(g, g)));
    if(cur) el.value = cur;
  }
  // Unit filter
  const units = [...new Set(rows.map(r=>r.unit).filter(Boolean))].sort();
  const uEl = document.getElementById('mr-f-unit');
  if (uEl) {
    const cur = uEl.value; while(uEl.options.length>1) uEl.remove(1);
    units.forEach(u => uEl.add(new Option(u, u)));
    if(cur) uEl.value = cur;
  }
  // Area filter
  const areas = [...new Set(rows.map(r=>r.area).filter(Boolean))].sort();
  const aEl = document.getElementById('mr-f-area');
  if (aEl) {
    const cur = aEl.value; while(aEl.options.length>1) aEl.remove(1);
    areas.forEach(a => aEl.add(new Option(a, a)));
    if(cur) aEl.value = cur;
  }
}

function mrApplyFilters() {
  const group = document.getElementById('mr-f-group')?.value||'';
  const unit = document.getElementById('mr-f-unit')?.value||'';
  const area = document.getElementById('mr-f-area')?.value||'';
  const daysMin = parseInt(document.getElementById('mr-f-days')?.value||'0',10);
  const q = (document.getElementById('mr-f-search')?.value||'').toLowerCase();
  const filtered = _mrAllRows.filter(r=>{
    if(group && !r.responsibleGroup.includes(group)) return false;
    if(unit && r.unit!==unit) return false;
    if(area && r.area!==area) return false;
    if(daysMin && (r.daysSince===null || r.daysSince < daysMin)) return false;
    if(q && !r.name.toLowerCase().includes(q) &&
       !(r.unit||'').toLowerCase().includes(q) &&
       !(r.area||'').toLowerCase().includes(q)) return false;
    return true;
  });
  mrRenderRows(filtered);
}

function mrClearFilters() {
  ['mr-f-group','mr-f-unit','mr-f-area','mr-f-days'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const s=document.getElementById('mr-f-search');if(s)s.value='';
  mrApplyFilters();
}

function mrRenderRows(rows) {
  const tbody = document.getElementById('mr-body');
  const empty = document.getElementById('mr-empty');
  const wrap  = document.getElementById('mr-wrap');
  const meta  = document.getElementById('mr-meta');
  if(!tbody) return;
  if(meta) meta.textContent = rows.length + ' equipment';
  if(!rows.length){ empty.style.display='block'; wrap.style.display='none'; return; }
  empty.style.display='none'; wrap.style.display='';
  tbody.innerHTML = rows.map(r=>{
    const canClick = AUTH.role !== 'viewer';
    const rowClick = canClick
      ? `style="cursor:pointer;background:${r.statusBg}" onclick="openEquipmentForEntry(${jsArg(r.name)},'missed')" title="Click to take reading"`
      : `style="background:${r.statusBg}"`;
    const statusBadge = `<span class="badge" style="background:${r.statusBg};color:${r.statusColor};border:1px solid ${r.statusColor}33">${r.statusLabel}</span>`;
    const actionHtml = `<td style="white-space:nowrap">
      ${canClick?`<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();openEquipmentForEntry(${jsArg(r.name)},'missed')" title="Take Reading">📝 Take</button>`:''}
      <button class="btn btn-sm" onclick="event.stopPropagation();viewEquipHistory(${jsArg(r.name)})">👁</button>
    </td>`;
    const daysSinceDisplay = r.daysSince !== null && r.daysSince < 9999 ? r.daysSince+'d' : '—';
    return `<tr ${rowClick}>
      <td data-label="Equipment"><strong>${escHtml(r.name)}</strong></td>
      <td data-label="Unit">${r.unit}</td>
      <td data-label="Area">${r.area}</td>
      <td data-label="Days Since" style="font-weight:700;font-size:13px;color:${r.statusColor}">${daysSinceDisplay}</td>
      <td data-label="Last Reading" style="color:var(--muted)">${r.lastDate?fmtDateDisplay(r.lastDate):'Never'}</td>
      <td data-label="Resp. Group" style="font-weight:600;font-size:11px">${r.responsibleGroup}</td>
      <td data-label="Sched. Date" style="color:var(--muted);font-size:11px">${r.schedDate!=='—'?fmtDateDisplay(r.schedDate):r.schedDate}</td>
      <td data-label="Status">${statusBadge}</td>
      ${actionHtml}
    </tr>`;
  }).join('');
}

function mrRender() {
  const periodSel = document.getElementById('mr-period');
  const period = periodSel ? periodSel.value : '1';
  const customDiv = document.getElementById('mr-custom-range');
  if(customDiv) customDiv.style.display = period==='custom'?'block':'none';

  _mrAllRows = mrBuildRows();
  mrPopulateFilters(_mrAllRows);

  const total = _mrAllRows.length;
  const neverRead = _mrAllRows.filter(r=>!r.lastDate).length;
  const critical  = _mrAllRows.filter(r=>r.statusKey==='critical'&&r.lastDate).length;
  const overdue   = _mrAllRows.filter(r=>r.statusKey==='overdue').length;
  const kpiEl = document.getElementById('mr-kpis');
  if(kpiEl) kpiEl.innerHTML = `
    <div class="kpi" style="border-left-color:var(--blue)"><div class="kpi-val">${total}</div><div class="kpi-lbl">Total Missed</div></div>
    <div class="kpi kpi-r"><div class="kpi-val" style="color:#DC2626">${neverRead}</div><div class="kpi-lbl">Never Read</div></div>
    <div class="kpi" style="border-left-color:#DC2626"><div class="kpi-val" style="color:#DC2626">${critical}</div><div class="kpi-lbl">3+ Cycles Missed</div></div>
    <div class="kpi kpi-at"><div class="kpi-val">${overdue}</div><div class="kpi-lbl">Overdue</div></div>
  `;
  const periodLabels={'1':'Last Month','2':'Last 2 Months','3':'Last 3 Months','custom':'Custom Range'};
  const titleEl = document.getElementById('mr-card-title');
  if(titleEl) titleEl.textContent = `Missed Readings — ${periodLabels[period]||period}`;
  mrApplyFilters();
}

async function mrExport() {
  if(typeof XLSX==='undefined'){ alert('Excel engine loading, please try again.'); return; }
  const rows = _mrAllRows;
  if(!rows.length){ alert('No missed readings to export.'); return; }
  const wb = XLSX.utils.book_new();
  const headers = ['Equipment','Code','Unit','Area','Dept','Frequency (days)','Last Reading','Days Since','Expected Next','Status'];
  const data = rows.map(r=>[r.name,r.code||'',r.unit,r.area,r.dept||'',r.frequency,r.lastDate||'—',r.daysSince!==null?r.daysSince+'d':'—',r.expectedNext,r.statusLabel]);
  const ws = XLSX.utils.aoa_to_sheet([headers,...data]);
  ws['!cols'] = headers.map((h,i)=>({wch:i===0?30:i===9?22:Math.max(h.length+2,14)}));
  XLSX.utils.book_append_sheet(wb,ws,'Missed Readings');
  mobileWriteFile(wb, `VibeMon_Missed_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// ── Download as CSV (.csv) — ALL_READINGS format ───────────────────────────
