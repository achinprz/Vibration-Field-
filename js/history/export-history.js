/* VibeMon — History Excel export (ExcelJS) */

// ── EXPORT HISTORY: grouped Excel with merged cells ──────────────────────
async function exportHistoryExcel() {
  const from=document.getElementById('h-from').value;
  const to=document.getElementById('h-to').value;
  const unit=document.getElementById('h-unit').value;
  const area=document.getElementById('h-area').value;
  const sev=document.getElementById('h-sev').value;
  const q=document.getElementById('h-search').value.toLowerCase();
  const user=document.getElementById('h-user')?.value||'';

  let rows=READINGS.filter(r=>
    (!from||r.date>=from)&&(!to||r.date<=to)&&
    (!unit||r.unit===unit)&&(!area||r.area===area)&&
    (!user||(r.username===user||r.inspector===user))&&
    (!q||r.equipment.toLowerCase().includes(q))
  ).sort((a,b)=>b.date.localeCompare(a.date)||a.equipment.localeCompare(b.equipment));

  const sessionMap={};const _noidC1={};
  rows.forEach(r=>{
    let key;
    if(r.reportId){key=r.reportId+'||'+r.equipment;}
    else{const b=r.date+'||'+r.equipment+'||'+(r.inspector||r.username||'')+'||'+(r.createdOn||'');if(!_noidC1[b])_noidC1[b]=0;key=b||('_noid_'+(_noidC1[b]++));}
    if(!sessionMap[key]) sessionMap[key]={date:r.date,equipment:r.equipment,unit:r.unit,area:r.area,inspector:r.inspector,rows:[],recs:r.recommendations||''};
    sessionMap[key].rows.push(r);
  });
  const sessions=Object.values(sessionMap).sort((a,b)=>b.date.localeCompare(a.date));
  const filtered=sev?sessions.filter(s=>worstSev(s.rows.map(r=>r.severity))===sev):sessions;

  if(!filtered.length){ alert('No data in the selected range.'); return; }

  // PERF: O(1) equipment lookups instead of MASTER.find() per session (export is uncapped,
  // unlike the on-screen History view, so this can run over thousands of sessions).
  const masterByName = {};
  MASTER.forEach(m => { masterByName[m.name] = m; });

  // ============= ExcelJS formatted workbook =============
  const wb = new ExcelJS.Workbook();
  wb.creator='VibeMon'; wb.created=new Date();

  const SEV_FILL={
    NORMAL:'FF1E8449', ALARM:'FFD97706', ALERT:'FF9A3412', CRITICAL:'FFDC2626'
  };
  const BRAND='FF1D4E8A';
  const BRAND_SOFT='FFE6F1FB';
  const thin={style:'thin',color:{argb:'FFCDD0D6'}};
  const allBorder={top:thin,left:thin,bottom:thin,right:thin};

  const totalReadings=filtered.reduce((s,x)=>s+x.rows.length,0);
  const sevCounts={NORMAL:0,ALARM:0,ALERT:0,CRITICAL:0};
  filtered.forEach(s=>{const os=worstSev(s.rows.map(r=>r.severity))||'NORMAL';sevCounts[os]=(sevCounts[os]||0)+1;});

  // ── Sheet 1: Summary ──
  const ws = wb.addWorksheet('Summary',{views:[{state:'frozen',ySplit:6}]});
  ws.columns=[
    {key:'date',width:12},{key:'equipment',width:32},{key:'unit',width:14},
    {key:'area',width:14},{key:'sev',width:18},{key:'inspector',width:16},
    {key:'pts',width:9},{key:'recs',width:60},{key:'decoupled',width:12}
  ];

  // Title band
  ws.mergeCells('A1:I1');
  const t=ws.getCell('A1');
  t.value='VibeMon — History Report';
  t.font={name:'Calibri',size:18,bold:true,color:{argb:'FFFFFFFF'}};
  t.fill={type:'pattern',pattern:'solid',fgColor:{argb:BRAND}};
  t.alignment={vertical:'middle',horizontal:'left',indent:1};
  ws.getRow(1).height=30;

  // Subtitle / filters
  ws.mergeCells('A2:I2');
  const sub=ws.getCell('A2');
  sub.value=`Period: ${from||'—'} to ${to||'—'}    Unit: ${unit||'All'}    Area: ${area||'All'}    Severity: ${sev||'All'}    Generated: ${new Date().toLocaleString()}`;
  sub.font={name:'Calibri',size:10,italic:true,color:{argb:'FF374151'}};
  sub.fill={type:'pattern',pattern:'solid',fgColor:{argb:BRAND_SOFT}};
  sub.alignment={vertical:'middle',horizontal:'left',indent:1};
  ws.getRow(2).height=20;

  // KPI strip (row 4)
  const kpiLabels=['Sessions','Normal','Alarm','Alert','Critical'];
  const kpiValues=[filtered.length,sevCounts.NORMAL,sevCounts.ALARM,sevCounts.ALERT,sevCounts.CRITICAL];
  const kpiColors=[BRAND,SEV_FILL.NORMAL,SEV_FILL.ALARM,SEV_FILL.ALERT,SEV_FILL.CRITICAL];
  kpiLabels.forEach((lbl,i)=>{
    const c1=ws.getCell(4,i+1); c1.value=lbl;
    c1.font={bold:true,size:9,color:{argb:'FFFFFFFF'}};
    c1.fill={type:'pattern',pattern:'solid',fgColor:{argb:kpiColors[i]}};
    c1.alignment={horizontal:'center',vertical:'middle'};
    c1.border=allBorder;
    const c2=ws.getCell(5,i+1); c2.value=kpiValues[i];
    c2.font={bold:true,size:13,color:{argb:'FF1A1D23'}};
    c2.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF4F5F7'}};
    c2.alignment={horizontal:'center',vertical:'middle'};
    c2.border=allBorder;
  });
  ws.getRow(5).height=22;

  // Table header (row 6)
  const headers=['Date','Equipment','Unit','Area','Overall Severity','Inspector','Recommendations','Decoupled'];
  const hdrRow=ws.getRow(6);
  headers.forEach((h,i)=>{
    const c=hdrRow.getCell(i+1); c.value=h;
    c.font={bold:true,size:10,color:{argb:'FFFFFFFF'}};
    c.fill={type:'pattern',pattern:'solid',fgColor:{argb:BRAND}};
    c.alignment={horizontal:'center',vertical:'middle',wrapText:true};
    c.border=allBorder;
  });
  hdrRow.height=24;

  // Body
  filtered.forEach((s,idx)=>{
    const os=worstSev(s.rows.map(r=>r.severity))||'NORMAL';
    const allRecs=[...new Set(s.rows.map(r=>r.recommendations||'').filter(Boolean).join('|').split('|').map(x=>x.trim()).filter(Boolean))].join(' | ');
    const isDecSession = s.rows.some(r => r.isDecoupled || (r.remarks && r.remarks.includes('Decoupled Trial')));
    const r=ws.addRow([s.date,s.equipment,s.unit,s.area,os,s.inspector||'',allRecs,isDecSession?'Yes':'No']);
    const zebra = idx%2===0 ? 'FFFFFFFF' : 'FFF9FAFB';
    r.eachCell({includeEmpty:true},(cell,col)=>{
      cell.border=allBorder;
      cell.alignment={vertical:'middle',wrapText:true,horizontal:(col===2||col===7)?'left':'center'};
      cell.font={size:10};
      cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:zebra}};
    });
    const sevCell=r.getCell(5);
    sevCell.fill={type:'pattern',pattern:'solid',fgColor:{argb:SEV_FILL[os]||SEV_FILL.NORMAL}};
    sevCell.font={bold:true,size:10,color:{argb:'FFFFFFFF'}};
    r.getCell(2).font={size:10,bold:true};
  });

  ws.autoFilter={from:{row:6,column:1},to:{row:6,column:8}};

  // ── Sheet 2: Detailed Readings ──
  const ws2 = wb.addWorksheet('Detailed Readings',{views:[{state:'frozen',ySplit:2}]});
  const detHdrs=['Date','Equipment','Unit','Area','Inspector','Overall Severity','Point','H Vel (mm/s)','V Vel (mm/s)','A Vel (mm/s)','Acc (g)','H Dis (µm)','V Dis (µm)','A Dis (µm)','Recommendations','Decoupled'];
  ws2.columns=detHdrs.map((h,i)=>({width:i===1?30:i===14?50:Math.max(h.length+2,12)}));

  ws2.mergeCells(1,1,1,detHdrs.length);
  const dt=ws2.getCell(1,1);
  dt.value='VibeMon — Detailed Readings';
  dt.font={name:'Calibri',size:14,bold:true,color:{argb:'FFFFFFFF'}};
  dt.fill={type:'pattern',pattern:'solid',fgColor:{argb:BRAND}};
  dt.alignment={vertical:'middle',horizontal:'left',indent:1};
  ws2.getRow(1).height=24;

  const dHdr=ws2.getRow(2);
  detHdrs.forEach((h,i)=>{
    const c=dHdr.getCell(i+1); c.value=h;
    c.font={bold:true,size:10,color:{argb:'FFFFFFFF'}};
    c.fill={type:'pattern',pattern:'solid',fgColor:{argb:BRAND}};
    c.alignment={horizontal:'center',vertical:'middle',wrapText:true};
    c.border=allBorder;
  });
  dHdr.height=24;

  let curRow=3;
  filtered.forEach((s,sidx)=>{
    const os=worstSev(s.rows.map(r=>r.severity))||'NORMAL';
    const allRecs=[...new Set(s.rows.map(r=>r.recommendations||'').filter(Boolean).join('|').split('|').map(x=>x.trim()).filter(Boolean))].join(' | ');
    const startRow=curRow;
    const zebra = sidx%2===0 ? 'FFFFFFFF' : 'FFF9FAFB';
    const isDecSession2 = s.rows.some(r => r.isDecoupled || (r.remarks && r.remarks.includes('Decoupled Trial')));
    sortRowsByMasterPoints(s.rows, s.equipment).forEach((r,ri)=>{
      const row=ws2.addRow([
        ri===0?s.date:'', ri===0?s.equipment:'', ri===0?s.unit:'', ri===0?s.area:'', ri===0?(s.inspector||''):'',
        ri===0?os:'',
        r.point, r.H_Vel||'', r.V_Vel||'', r.A_Vel||'', r.Acc||'', r.H_Dis||'', r.V_Dis||'', r.A_Dis||'',
        ri===0?allRecs:'', ri===0?(isDecSession2?'Yes':'No'):''
      ]);
      row.eachCell({includeEmpty:true},(cell,col)=>{
        cell.border=allBorder;
        cell.alignment={vertical:'middle',wrapText:true,horizontal:(col===2||col===15)?'left':'center'};
        cell.font={size:9};
        cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:zebra}};
      });
      curRow++;
    });
    // Merge shared columns + Overall Severity (col 6)
    if(s.rows.length>1){
      [1,2,3,4,5,6,15,16].forEach(col=>{
        ws2.mergeCells(startRow,col,startRow+s.rows.length-1,col);
      });
    }
    const sevCell=ws2.getCell(startRow,6);
    sevCell.value=os;
    sevCell.fill={type:'pattern',pattern:'solid',fgColor:{argb:SEV_FILL[os]||SEV_FILL.NORMAL}};
    sevCell.font={bold:true,size:11,color:{argb:'FFFFFFFF'}};
    sevCell.alignment={horizontal:'center',vertical:'middle'};
    ws2.getCell(startRow,2).font={size:10,bold:true};
  });

  ws2.autoFilter={from:{row:2,column:1},to:{row:2,column:detHdrs.length}};

  // ── Sheet 3: Template-Format (matches VibeMon_Template exactly) ──
  const ws3 = wb.addWorksheet('Reading_Entry');
  const HEADER_FILL = 'FF1D4E8A';
  const COL_WIDTHS = [30,14,10,18,30,14,16,13,13,13,11,12,12,14,14,45];
  const COL_HEADERS = ['Equipment','Unit','Area','Point','Parameters','Date','Inspector',
    'H Vel (mm/s)','V Vel (mm/s)','A Vel (mm/s)','Acc (g)','H Dis (µm)','V Dis (µm)','A Dis (µm)','Severity','Recommendations'];
  ws3.columns = COL_WIDTHS.map((w,i) => ({key:`c${i}`, width:w}));
  ws3.getRow(1).height = 30;

  COL_HEADERS.forEach((h,i) => {
    const c = ws3.getRow(1).getCell(i+1);
    c.value = h;
    c.font = {name:'Calibri', size:11, bold:true, color:{argb:'FFFFFFFF'}};
    c.fill = {type:'pattern', pattern:'solid', fgColor:{argb:HEADER_FILL}};
    c.alignment = {horizontal:'center', vertical:'middle', wrapText:true};
    c.border = {top:{style:'thin'},left:{style:'thin'},bottom:{style:'thin'},right:{style:'thin'}};
  });

  let tRow = 2;
  filtered.forEach(s => {
    const nPts = s.rows.length;
    const allRecs = [...new Set(s.rows.map(r=>r.recommendations||'').filter(Boolean).join('|').split('|').map(x=>x.trim()).filter(Boolean))].join(' | ');
    const os = worstSev(s.rows.map(r=>r.severity))||'NORMAL';
    const paramStr = (masterByName[s.equipment]||{params:['H Vel','V Vel','A Vel','Acc']}).params.join(', ');

    sortRowsByMasterPoints(s.rows, s.equipment).forEach((r,ri) => {
      const row = ws3.getRow(tRow + ri);
      row.getCell(1).value  = ri===0 ? s.equipment   : null;
      row.getCell(2).value  = ri===0 ? s.unit         : null;
      row.getCell(3).value  = ri===0 ? s.area         : null;
      row.getCell(4).value  = r.point;
      row.getCell(5).value  = paramStr;
      row.getCell(6).value  = ri===0 ? s.date         : null;
      row.getCell(7).value  = ri===0 ? (s.inspector||'') : null;
      row.getCell(8).value  = r.H_Vel !== '' ? (parseFloat(r.H_Vel)||'N/A') : 'N/A';
      row.getCell(9).value  = r.V_Vel !== '' ? (parseFloat(r.V_Vel)||'N/A') : 'N/A';
      row.getCell(10).value = r.A_Vel !== '' ? (parseFloat(r.A_Vel)||'N/A') : 'N/A';
      row.getCell(11).value = r.Acc   !== '' ? (parseFloat(r.Acc)  ||'N/A') : 'N/A';
      row.getCell(12).value = r.H_Dis !== '' ? (parseFloat(r.H_Dis)||'N/A') : 'N/A';
      row.getCell(13).value = r.V_Dis !== '' ? (parseFloat(r.V_Dis)||'N/A') : 'N/A';
      row.getCell(14).value = r.A_Dis !== '' ? (parseFloat(r.A_Dis)||'N/A') : 'N/A';
      row.getCell(15).value = ri===0 ? os             : null;
      row.getCell(16).value = ri===0 ? allRecs        : null;
      // Apply thin borders to all data cells
      for (let ci=1; ci<=16; ci++) {
        const cell = row.getCell(ci);
        cell.border = {top:{style:'thin'},left:{style:'thin'},bottom:{style:'thin'},right:{style:'thin'}};
        cell.font = {name:'Calibri', size:11};
        cell.alignment = {vertical:'middle', wrapText:true, horizontal:(ci===1||ci===5||ci===16)?'left':'center'};
      }
    });

    // Merge shared cells (Equipment, Unit, Area, Date, Inspector, Severity, Recommendation)
    if (nPts > 1) {
      [1,2,3,6,7,15,16].forEach(col => {
        try { ws3.mergeCells(tRow, col, tRow+nPts-1, col); } catch(e2){}
      });
    }
    // Apply merged cell alignment fix
    [1,2,3,6,7].forEach(col => {
      const cell = ws3.getRow(tRow).getCell(col);
      cell.alignment = {vertical:'middle', horizontal:'center', wrapText:true};
    });
    // Severity color
    const sevCell = ws3.getRow(tRow).getCell(15);
    const sevColors = {NORMAL:'FF1E8449', ALARM:'FFD97706', ALERT:'FF9A3412', CRITICAL:'FFDC2626'};
    if (sevColors[os]) {
      sevCell.fill = {type:'pattern', pattern:'solid', fgColor:{argb:sevColors[os]}};
      sevCell.font = {name:'Calibri', size:11, bold:true, color:{argb:'FFFFFFFF'}};
    }
    tRow += nPts;
  });

  // Write & download (mobile-safe)
  const buf = await wb.xlsx.writeBuffer();
  const fname = `VibeMon_History_${new Date().toISOString().slice(0,10)}.xlsx`;
  _downloadExcelBuffer(buf, fname);
}
