/* VibeMon — bulk template builder (Excel template download) */

// ======= TEMPLATE BUILDER =======
let tbSelected = new Set(); // set of equipment names

function openTemplateBuilder() {
  tbSelected = new Set();
  // Populate unit/area selects
  const units = [...new Set(MASTER.map(e=>e.unit))].sort();
  const areas = [...new Set(MASTER.map(e=>e.area))].sort();
  const tbUnit = document.getElementById('tb-unit');
  const tbArea = document.getElementById('tb-area');
  while(tbUnit.options.length>1) tbUnit.remove(1);
  while(tbArea.options.length>1) tbArea.remove(1);
  units.forEach(u=>tbUnit.add(new Option(u,u)));
  areas.forEach(a=>tbArea.add(new Option(a,a)));
  // Set today as default date (local device time, not UTC)
  document.getElementById('tb-date').value = _todayFmt();
  document.getElementById('tb-search').value = '';
  renderTemplateEquipList();
  updateTbCount();
  document.getElementById('template-builder-modal').classList.add('open');
}

function closeTemplateBuilder() {
  document.getElementById('template-builder-modal').classList.remove('open');
}

function renderTemplateEquipList() {
  const unit = document.getElementById('tb-unit').value;
  const area = document.getElementById('tb-area').value;
  const q = document.getElementById('tb-search').value.toLowerCase();
  const filtered = MASTER.filter(e =>
    (!unit || e.unit === unit) &&
    (!area || e.area === area) &&
    (!q || e.name.toLowerCase().includes(q))
  );
  const tbody = document.getElementById('tb-equip-body');
  tbody.innerHTML = '';
  const lastReadingMap = buildLastReadingMap(); // PERF: one pass over READINGS, not per-equipment
  filtered.slice(0, 400).forEach(e => {
    const last = lastReadingMap[e.name]||null;
    const isChecked = tbSelected.has(e.name);
    const tr = document.createElement('tr');
    if (isChecked) tr.classList.add('tb-row-selected');
    tr.onclick = (ev) => { if(ev.target.type==='checkbox') return; toggleEquipTemplate(e.name, tr); };
    tr.innerHTML = `
      <td onclick="event.stopPropagation()"><input type="checkbox" class="tb-cb" data-name="${escHtml(e.name)}" ${isChecked?'checked':''} onchange="toggleEquipTemplate(${jsArg(e.name)}, this.closest('tr'))" style="width:15px;height:15px"></td>
      <td style="font-size:11px">${e.unit}</td>
      <td style="font-size:11px">${e.area}</td>
      <td style="font-weight:600;font-size:12px">${escHtml(e.name)}</td>
      <td style="font-size:11px;color:var(--muted)">${e.points.length} pts</td>
      <td style="font-size:11px;color:var(--muted)">${e.params.join(', ')}</td>
      <td style="font-size:11px;color:var(--muted)">${last?fmtDateDisplay(last.date):'—'}</td>`;
    tbody.appendChild(tr);
  });
  // Sync check-all state
  const allVisible = filtered.slice(0,400).every(e => tbSelected.has(e.name));
  const anyVisible = filtered.slice(0,400).some(e => tbSelected.has(e.name));
  const chkAll = document.getElementById('tb-check-all');
  chkAll.checked = allVisible && filtered.length > 0;
  chkAll.indeterminate = !allVisible && anyVisible;
}

function toggleEquipTemplate(name, trEl) {
  if (tbSelected.has(name)) { tbSelected.delete(name); trEl.classList.remove('tb-row-selected'); }
  else { tbSelected.add(name); trEl.classList.add('tb-row-selected'); }
  // Sync checkbox inside row
  const cb = trEl.querySelector('.tb-cb');
  if (cb) cb.checked = tbSelected.has(name);
  updateTbCount();
  // Update check-all state
  const allCbs = document.querySelectorAll('#tb-equip-body .tb-cb');
  const checkedCbs = [...allCbs].filter(c=>c.checked).length;
  const chkAll = document.getElementById('tb-check-all');
  chkAll.checked = checkedCbs === allCbs.length && allCbs.length > 0;
  chkAll.indeterminate = checkedCbs > 0 && checkedCbs < allCbs.length;
}

function toggleAllTemplate(checked) {
  const unit = document.getElementById('tb-unit').value;
  const area = document.getElementById('tb-area').value;
  const q = document.getElementById('tb-search').value.toLowerCase();
  const filtered = MASTER.filter(e =>
    (!unit || e.unit === unit) &&
    (!area || e.area === area) &&
    (!q || e.name.toLowerCase().includes(q))
  ).slice(0, 400);
  filtered.forEach(e => { if(checked) tbSelected.add(e.name); else tbSelected.delete(e.name); });
  renderTemplateEquipList();
  updateTbCount();
}

function selectAllTemplate() {
  document.getElementById('tb-check-all').checked = true;
  toggleAllTemplate(true);
}
function clearAllTemplate() {
  tbSelected.clear();
  renderTemplateEquipList();
  updateTbCount();
}

function updateTbCount() {
  const cnt = tbSelected.size;
  document.getElementById('tb-selected-count').textContent = `${cnt} equipment selected`;
  const btn = document.getElementById('tb-download-btn');
  btn.disabled = cnt === 0;
  btn.style.opacity = cnt === 0 ? '.5' : '1';
}

async function downloadSmartTemplate() {
  if (tbSelected.size === 0) { alert('Please select at least one equipment.'); return; }
  if (typeof ExcelJS === 'undefined') { alert('Excel engine still loading, please try again in a moment.'); return; }
  const date = document.getElementById('tb-date').value || _todayFmt();
  const inspector = AUTH.displayName || 'Inspector';
  const selectedEquips = MASTER.filter(e => tbSelected.has(e.name));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'VibeMon';

  // ---- Hidden list sheet powering the dropdown ----
  const listWs = wb.addWorksheet('Rec_List');
  listWs.getCell('A1').value = 'Recommendations';
  STD_RECS.forEach((r,i)=>{ listWs.getCell('A'+(i+2)).value = r; });
  listWs.getColumn(1).width = 60;
  listWs.state = 'veryHidden';

  // ---- Hidden list sheet for Severity dropdown ----
  const sevWs = wb.addWorksheet('Sev_List');
  sevWs.getCell('A1').value = 'Severity';
  ['NORMAL','ALARM','ALERT','CRITICAL'].forEach((s,i)=>{ sevWs.getCell('A'+(i+2)).value = s; });
  sevWs.getColumn(1).width = 18;
  sevWs.state = 'veryHidden';

  // ---- Hidden list sheet for Dept dropdown ----
  const deptWs = wb.addWorksheet('Dept_List');
  deptWs.getCell('A1').value = 'Dept';
  DEPTS_LIST.forEach((d,i)=>{ deptWs.getCell('A'+(i+2)).value = d; });
  deptWs.getColumn(1).width = 14;
  deptWs.state = 'veryHidden';

  // ---- Hidden list sheet for Decoupled dropdown ----
  const decWs = wb.addWorksheet('Dec_List');
  decWs.getCell('A1').value = 'Decoupled';
  decWs.getCell('A2').value = 'No';
  decWs.getCell('A3').value = 'Yes';
  decWs.getColumn(1).width = 10;
  decWs.state = 'veryHidden';

  // ---- Main entry sheet ----
  // Col layout: Equipment(1) Unit(2) Area(3) Point(4) Parameters(5) Date(6) Inspector(7)
  //             H Vel(8) V Vel(9) A Vel(10) Acc(11) H Dis(12) V Dis(13) A Dis(14)
  //             Severity(15) Dept(16) Recommendations(17) Decoupled(18)
  const headers = ['Equipment','Unit','Area','Point','Parameters','Date','Inspector',
    'H Vel (mm/s)','V Vel (mm/s)','A Vel (mm/s)','Acc (g)','H Dis (\u00b5m)','V Dis (\u00b5m)','A Dis (\u00b5m)',
    'Severity','Dept','Recommendations','Decoupled Trial'];
  const ws = wb.addWorksheet('Reading_Entry', { views:[{ state:'frozen', ySplit:1 }] });
  ws.addRow(headers);
  const headRow = ws.getRow(1);
  headRow.font = { bold:true, color:{argb:'FFFFFFFF'} };
  headRow.alignment = { vertical:'middle', horizontal:'center', wrapText:true };
  headRow.height = 30;
  headRow.eachCell(c=>{ c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1D4E8A'}}; });

  const groups = [];
  selectedEquips.forEach(e=>{
    const start = ws.rowCount + 1;
    const hasVel = e.params.some(p=>p.toLowerCase().includes('vel'));
    const hasAcc = e.params.some(p=>p.toLowerCase().includes('acc'));
    const hasDis = e.params.some(p=>p.toLowerCase().includes('dis'));
    // Auto-fill dept from Equipment Master
    const masterDeptVal = deptFromMaster(e.name) || (e.dept||'').trim();
    e.points.forEach((pt,pi)=>{
      ws.addRow([
        pi===0?e.name:'', pi===0?e.unit:'', pi===0?e.area:'', pt, e.params.join(', '),
        pi===0?date:'', pi===0?inspector:'',
        hasVel?'':'N/A', hasVel?'':'N/A', hasVel?'':'N/A',
        hasAcc?'':'N/A', hasDis?'':'N/A', hasDis?'':'N/A', hasDis?'':'N/A',
        '', pi===0?masterDeptVal:'', '', pi===0?'No':''
      ]);
    });
    groups.push({ start, end: ws.rowCount });
  });

  ws.columns.forEach((col,i)=>{
    col.width = [30,14,10,18,30,14,16,13,13,13,11,12,12,12,14,12,45,14][i] || 14;
  });

  // Merge shared columns per equipment block (1-based cols). Dept=16, Recommendations=17.
  const MERGE_COLS = [1,2,3,6,7,15,16,17,18];
  groups.forEach(g=>{
    if(g.end>g.start){
      MERGE_COLS.forEach(c=>{
        try{ ws.mergeCells(g.start,c,g.end,c); }catch(e){}
        const cell=ws.getCell(g.start,c);
        cell.alignment={vertical:'top',wrapText:true};
      });
    }
  });

  // Dropdown validation: Severity (col 15), Dept (col 16), Recommendations (col 17)
  const lastRow = ws.rowCount;
  for(let r=2;r<=lastRow;r++){
    ws.getCell(r,15).dataValidation = {
      type:'list', allowBlank:true,
      formulae:['Sev_List!$A$2:$A$5'],
      showErrorMessage:true, errorTitle:'Invalid Severity',
      error:'Pick NORMAL, ALARM, ALERT or CRITICAL (leave blank to auto-compute).'
    };
    ws.getCell(r,16).dataValidation = {
      type:'list', allowBlank:true,
      formulae:['Dept_List!$A$2:$A$'+(DEPTS_LIST.length+1)],
      showErrorMessage:true, errorTitle:'Invalid Dept',
      error:'Pick a department from the list: '+DEPTS_LIST.join(', ')
    };
    ws.getCell(r,17).dataValidation = {
      type:'list', allowBlank:true,
      formulae:['Rec_List!$A$2:$A$'+(Math.max(STD_RECS.length,1)+1)],
      showErrorMessage:false
    };
    ws.getCell(r,18).dataValidation = {
      type:'list', allowBlank:true,
      formulae:['Dec_List!$A$2:$A$3'],
      showErrorMessage:true, errorTitle:'Invalid Value',
      error:'Pick Yes or No.'
    };
  }
  // Highlight Dept column header in green to draw attention
  ws.getCell(1,16).fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FF1E8449'}};
  // Highlight Decoupled column header in amber
  ws.getCell(1,18).fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FFD97706'}};

  // Light borders for the whole table (18 columns)
  for(let r=1;r<=lastRow;r++){
    for(let c=1;c<=18;c++){
      ws.getCell(r,c).border={
        top:{style:'thin',color:{argb:'FFE2E4E8'}},bottom:{style:'thin',color:{argb:'FFE2E4E8'}},
        left:{style:'thin',color:{argb:'FFE2E4E8'}},right:{style:'thin',color:{argb:'FFE2E4E8'}}
      };
    }
  }

  // ---- Instructions sheet ----
  const instr = wb.addWorksheet('Instructions');
  const instrData = [
    ['VibeMon \u2014 Bulk Entry Template Instructions'],[''],
    ['HOW TO FILL:'],
    ['1. Go to the "Reading_Entry" sheet'],
    ['2. Fill vibration values in the H/V/A Vel, Acc and H/V/A Dis columns'],
    ['3. Leave cells blank if no reading was taken'],
    ['4. Cells marked "N/A" \u2014 that equipment does not use that parameter, leave as-is'],
    ['5. Dept (column P): auto-filled from Equipment Master. Change if needed using the dropdown ('+DEPTS_LIST.join(', ')+')'],
    ['6. Recommendations (column Q): click the cell, then use the dropdown arrow to pick from the list, or type your own note'],
    ['7. Severity (column O): leave BLANK to auto-compute from values, OR pick NORMAL / ALARM / ALERT / CRITICAL to override'],
    ['8. Do NOT change Equipment, Unit, Area, Point, Parameters columns'],
    ['9. You may change the Date and Inspector if needed'],
    ['10. Save the Excel file and upload it back in VibeMon \u2192 Data Entry \u2192 Upload Filled Excel'],
    [''],
    ['SEVERITY THRESHOLDS (ISO 10816):'],
    ['Parameter','Alarm','Alert','Critical'],
    ['Velocity (mm/s)','2.8','7.1','11.2'],
    ['Acceleration (g)','1.0','3.5','5.0'],
    ['Displacement (\u00b5m)','50','100','150'],
    [''],
    ['DEPT LIST: '+DEPTS_LIST.join(', ')],[''],
    ['Selected Equipment in this Template:'],
    ['S.No','Equipment','Unit','Area','Dept','Points','Parameters'],
    ...selectedEquips.map((e,i)=>[i+1,e.name,e.unit,e.area,deptFromMaster(e.name)||e.dept||'',e.points.join(', '),e.params.join(', ')])
  ];
  instrData.forEach(r=>instr.addRow(r));
  instr.getRow(1).font={bold:true,size:13};
  instr.columns=[{width:6},{width:35},{width:14},{width:10},{width:10},{width:40},{width:30}];

  // ---- Download (works on desktop + mobile webview) ----
  const totalPoints = selectedEquips.reduce((sum,e)=>sum+e.points.length,0);
  const filename = `VibeMon_Template_${date}_${tbSelected.size}equip.xlsx`;
  try {
    const buf = await wb.xlsx.writeBuffer();
    _downloadExcelBuffer(buf, filename);
    const logged = logBulkTemplateDownload(selectedEquips, date);
    document.getElementById('tb-selected-count').innerHTML =
      `<span style="color:var(--green)">\u2705 Downloaded! ${tbSelected.size} equipment, ${totalPoints} measurement points (Dept auto-filled · Recommendations & Severity dropdowns included) · 📅 ${logged} schedule log entr${logged===1?'y':'ies'} created</span>`;
  } catch(err) {
    alert('Could not generate template: '+err.message);
  }
}

// Create one SCHEDULE_LOG record per downloaded equipment on Bulk Template Download.
function logBulkTemplateDownload(equips, date){
  const stamp = new Date().toISOString();
  let count = 0;
  (equips||[]).forEach(e => {
    const info = equipInfo(e.name) || {};
    const logEntry = {
      logId: `${e.name}@${date}@BULKTPL@${Date.now()}_${count}`,
      equipment: e.name,
      date: date,
      department: info.department || e.dept || '',
      responsibleDept: info.department || e.dept || '',
      unit: e.unit || info.unit || '',
      area: e.area || info.area || '',
      inspector: AUTH.displayName || '',
      username: AUTH.username || '',
      user: AUTH.username || AUTH.displayName || '',
      downloadTimestamp: stamp,
      downloadType: 'Bulk Template',
      status: 'Downloaded'
    };
    try {
      if (typeof COMPLIANCE_LOG !== 'undefined' &&
          !COMPLIANCE_LOG.some(l => l.equipment === e.name && l.date === date)) {
        COMPLIANCE_LOG.push(logEntry);
      }
    } catch(err) {}
    count++;
  });
  try {
  } catch(err) {}
  try { renderSchedule && renderSchedule(); } catch(err) {}
  return count;
}
