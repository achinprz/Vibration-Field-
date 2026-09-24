/* VibeMon — save a reading session + session Excel export */

// ---- SAVE ----
async function saveSession() {
  if (AUTH.role === 'viewer') { alert('Viewers cannot save entries. Please login as Editor or Admin.'); return; }
  const date=document.getElementById('entry-date').value||_todayFmt();
  // Editors can ONLY submit today's date — block any DevTools manipulation
  if (AUTH.role !== 'admin' && date !== _todayFmt()) {
    showToast('⛔ Field Engineers can only submit today\'s readings. Contact Admin to enter readings for other dates.', 'red');
    document.getElementById('entry-date').value = _todayFmt();
    return;
  }
  const inspector=document.getElementById('inspector-name').value||AUTH.displayName||'Unknown';
  const e=entryEquip;
  const allRecs=[...entryRecs.map(r=>r.value).filter(Boolean)];
  let extra=document.getElementById('extra-remarks').value.trim();
  const recsStr=allRecs.join(' | ');
  const responsibleDept=(document.getElementById('entry-resp-dept')?.value||'').trim();

  // Build readings from all points that have values
  const readings=[];
  e.points.forEach(pt=>{
    const r=entryReadings[pt]||{};
    const values={H_Vel:'',V_Vel:'',A_Vel:'',Acc:'',H_Dis:'',V_Dis:'',A_Dis:''};
    e.params.forEach(p=>{ const k=p.replace(/\s/g,'_'); if(values.hasOwnProperty(k)) values[k]=r[k]||''; });
    // Only include points that have at least one value entered — skip fully blank points
    const hasValue = Object.values(values).some(v => v !== '' && v !== null && v !== undefined);
    if (!hasValue) return;
    const sevList=e.params.map(p=>{
      const key=p.replace(/\s/g,'_');
      const type=p.toLowerCase().includes('acc')?'acc':p.toLowerCase().includes('dis')?'dis':'vel';
      return getSev(values[key],type,e?e.name:null,isDecoupledMode());
    }).filter(Boolean);
    const autoOs=worstSev(sevList)||'NORMAL';
    const overrideEl=document.getElementById('s4-sev-override');
    const os=(overrideEl&&overrideEl.value)?overrideEl.value:autoOs;
    readings.push({point:pt,...values,severity:os});
  });
  if (!readings.length) { alert('⚠️ No values entered. Please fill in at least one measurement point before saving.'); return; }

  // ── DECOUPLED TRIAL DETECTION ──────────────────────────────────────────────
  let isDecoupled = isDecoupledMode();

  // Auto-detect: if NOT checked but only MDE+MNDE (or exactly 2 decoupled-named points) have values
  if (!isDecoupled && readings.length > 0) {
    const filledPoints = readings.map(r => r.point.trim().toUpperCase());
    const allAreDecoupledPts = filledPoints.every(pt => DECOUPLED_POINTS.some(dp => pt.includes(dp)));
    const totalEquipPoints = e.points.length;
    if (allAreDecoupledPts && filledPoints.length < totalEquipPoints && filledPoints.length >= 1) {
      // Only MDE/MNDE filled but decoupled not checked — ask for confirmation
      const confirmed = confirm('Is the equipment in decoupled condition?');
      if (confirmed) {
        isDecoupled = true;
        const chk = document.getElementById('decoupled-trial-chk');
        if (chk) chk.checked = true;
      }
    }
  }

  // Auto-append "Decoupled Trial" remark if decoupled mode active
  if (isDecoupled) {
    const decoupledRemark = 'Decoupled Trial';
    if (!extra) {
      extra = decoupledRemark;
    } else if (!extra.includes(decoupledRemark)) {
      extra = decoupledRemark + (extra ? '\n' + extra : '');
    }
  }
  // ── END DECOUPLED TRIAL DETECTION ─────────────────────────────────────────

  // Generate Report ID: VBM-YYYYMMDD-HHMMSS-XXXX (timestamp+random = guaranteed unique, no collision between same-day entries)
  const dateNum = date.replace(/-/g,'');
  const _tsNow = new Date();
  const _hms = String(_tsNow.getHours()).padStart(2,'0')+String(_tsNow.getMinutes()).padStart(2,'0')+String(_tsNow.getSeconds()).padStart(2,'0');
  const _rnd = String(Math.floor(Math.random()*9000)+1000);
  const reportId = `VBM-${dateNum}-${_hms}-${_rnd}`;

  // Build legacy rows for local READINGS array (backward compat)
  const _nowStr = _localNowStr(); // local time string for in-memory READINGS
  const legacyRows = readings.map(pt => ({
    reportId, date, username: AUTH.username, inspector, unit:e.unit, area:e.area,
    equipment:e.name, rpm:e.rpm||'', frequency:e.frequency||'',
    point:pt.point, H_Vel:pt.H_Vel, V_Vel:pt.V_Vel, A_Vel:pt.A_Vel, Acc:pt.Acc,
    H_Dis:pt.H_Dis, V_Dis:pt.V_Dis, A_Dis:pt.A_Dis, severity:pt.severity,
    recommendations:recsStr, remarks:extra, responsibleDept,
    isDecoupled: isDecoupled,
    createdOn:_nowStr, updatedOn:_nowStr
  }));
  READINGS.push(...legacyRows);
  saveReadings();

  const saveBtn = document.querySelector('#entry-s4 .btn-green');
  if(saveBtn) { saveBtn.disabled=true; saveBtn.textContent='⏳ Saving...'; }
  showSavingOverlay('💾 Saving reading for ' + (e && e.name ? e.name : 'equipment') + '…');

  const labelSource = window._aiAcceptedForSession ? 'AI_ACCEPTED' : 'HUMAN';

  const payload = {
    action: 'saveReport',
    reportId, date, username: AUTH.username, inspector, unit:e.unit, area:e.area,
    equipment:e.name, rpm:e.rpm||'', frequency:e.frequency||'',
    recommendation: recsStr, remarks: extra, responsibleDept,
    isDecoupled: isDecoupled,
    labelSource,
    readings
  };

  try {
    await OfflineQ.handleSave(payload, null, saveBtn, reportId, readings, e);
  } finally {
    hideSavingOverlay();
  }

  entryEquip=null; entryReadings={}; entryRecs=[]; window._aiAcceptedForSession = false;
  goStep(1);
}

// ---- EXCEL EXPORT (session) ----
function exportSessionExcel(rows, date, equipName) {
  const wb=XLSX.utils.book_new();
  // Summary sheet
  const allSevs=rows.map(r=>r.severity);
  const os=worstSev(allSevs);
  const sumRows=[
    ['VibeMon — Vibration Report'],
    ['Equipment',equipName],
    ['Date',date],
    ['Unit',rows[0]?.unit||''],['Area',rows[0]?.area||''],
    ['Inspector',rows[0]?.inspector||''],
    ['Overall Severity',os],
    [],
    ['Point Summary'],
    ['Point','H Vel (mm/s)','V Vel (mm/s)','A Vel (mm/s)','Acc (g)','H Dis (µm)','V Dis (µm)','A Dis (µm)','Severity']
  ];
  rows.forEach(r=>sumRows.push([r.point,r.H_Vel,r.V_Vel,r.A_Vel,r.Acc,r.H_Dis,r.V_Dis,r.A_Dis,r.severity]));
  const recs=rows[0]?.recommendations||'';
  if(recs){sumRows.push([]);sumRows.push(['Recommendations']);recs.split('|').forEach((r,i)=>sumRows.push([`${i+1}.`,r.trim()]));}
  const ws1=XLSX.utils.aoa_to_sheet(sumRows);
  ws1['!cols']=[{wch:30},{wch:14},{wch:14},{wch:14},{wch:14},{wch:14},{wch:14},{wch:14},{wch:22}];
  XLSX.utils.book_append_sheet(wb,ws1,'Summary');

  // Detail sheet
  const hdrs=['Date','Equipment','Unit','Area','Point','H Vel (mm/s)','V Vel (mm/s)','A Vel (mm/s)','Acc (g)','H Dis (µm)','V Dis (µm)','A Dis (µm)','Severity','Inspector','Recommendations'];
  const keys=['date','equipment','unit','area','point','H_Vel','V_Vel','A_Vel','Acc','H_Dis','V_Dis','A_Dis','severity','inspector','recommendations'];
  const data=rows.map(r=>keys.map(k=>r[k]??''));
  const ws2=XLSX.utils.aoa_to_sheet([hdrs,...data]);
  ws2['!cols']=hdrs.map(h=>({wch:Math.max(h.length+2,14)}));
  XLSX.utils.book_append_sheet(wb,ws2,'Detailed Readings');

  mobileWriteFile(wb,`VibeMon_${equipName.replace(/\s+/g,'_')}_${date}.xlsx`);
}
