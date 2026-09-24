/* VibeMon — date formatters + user-wise report download */

// ======= USER-WISE DOWNLOAD =======
// ── GLOBAL DATE FORMATTER: DDMMYYYY display ───────────────────────────────
function fmtDateDDMMYYYY(dateStr) {
  if (!dateStr) return '—';
  // Expected internal format: YYYY-MM-DD
  const parts = String(dateStr).split('-');
  if (parts.length === 3 && parts[0].length === 4) {
    return parts[2] + parts[1] + parts[0]; // DDMMYYYY
  }
  return dateStr;
}
function fmtDateDisplay(dateStr) {
  // Returns DD-MM-YYYY for readable display
  if (!dateStr) return '—';
  const parts = String(dateStr).split('-');
  if (parts.length === 3 && parts[0].length === 4) {
    return parts[2] + '-' + parts[1] + '-' + parts[0];
  }
  return dateStr;
}




function populateUserFilter() {
  const sel = document.getElementById('uw-user'); if (!sel) return;
  const users = [...new Set(READINGS.map(r => r.username || r.inspector).filter(Boolean))].sort();
  while (sel.options.length > 1) sel.remove(1);
  users.forEach(u => sel.add(new Option(u, u)));
}

async function downloadUserReport(format) {
  const user   = document.getElementById('uw-user').value;
  const from   = document.getElementById('uw-from').value;
  const to     = document.getElementById('uw-to').value;
  const equip  = (document.getElementById('uw-equip').value||'').trim().toLowerCase();
  const status = document.getElementById('uw-status');

  let rows = READINGS.filter(r =>
    (!user  || r.username === user || r.inspector === user) &&
    (!from  || r.date >= from) &&
    (!to    || r.date <= to) &&
    (!equip || r.equipment.toLowerCase().includes(equip))
  );

  if (!rows.length) {
    status.innerHTML = '<div class="alert-box alert-warn">⚠️ No readings found for the selected filters.</div>';
    return;
  }

  const label = user||'All Users';

  if (format === 'excel') {
    // ─── ExcelJS formatted workbook (same style as exportHistoryExcel) ───
    const wb = new ExcelJS.Workbook();
    wb.creator='VibeMon'; wb.created=new Date();

    const SEV_FILL={NORMAL:'FF1E8449', ALARM:'FFD97706', ALERT:'FF9A3412', CRITICAL:'FFDC2626'};
    const BRAND='FF1D4E8A';
    const BRAND_SOFT='FFE6F1FB';
    const thin={style:'thin',color:{argb:'FFCDD0D6'}};
    const allBorder={top:thin,left:thin,bottom:thin,right:thin};

    // Group rows into sessions (same as history export)
    const sessionMap={};const _noidC5={};
    rows.forEach(r=>{
      let key;
      if(r.reportId){key=r.reportId+'||'+r.equipment;}
      else{const b=r.date+'||'+r.equipment+'||'+(r.inspector||r.username||'')+'||'+(r.createdOn||'');if(!_noidC5[b])_noidC5[b]=0;key=b||('_noid_'+(_noidC5[b]++));}
      if(!sessionMap[key]) sessionMap[key]={date:r.date,equipment:r.equipment,unit:r.unit,area:r.area,inspector:r.inspector,username:r.username||r.inspector,rows:[],recs:r.recommendations||''};
      sessionMap[key].rows.push(r);
    });
    const sessions=Object.values(sessionMap).sort((a,b)=>b.date.localeCompare(a.date));

    const totalReadings=sessions.reduce((s,x)=>s+x.rows.length,0);
    const sevCounts={NORMAL:0,ALARM:0,ALERT:0,CRITICAL:0};
    sessions.forEach(s=>{const os=worstSev(s.rows.map(r=>r.severity))||'NORMAL';sevCounts[os]=(sevCounts[os]||0)+1;});

    // ── Sheet 1: Summary ──
    const ws = wb.addWorksheet('Summary',{views:[{state:'frozen',ySplit:6}]});
    ws.columns=[
      {key:'date',width:12},{key:'equipment',width:32},{key:'unit',width:14},
      {key:'area',width:14},{key:'sev',width:18},{key:'inspector',width:18},
      {key:'pts',width:9},{key:'recs',width:60}
    ];

    ws.mergeCells('A1:H1');
    const t1=ws.getCell('A1');
    t1.value=`VibeMon — User Report: ${label}`;
    t1.font={name:'Calibri',size:18,bold:true,color:{argb:'FFFFFFFF'}};
    t1.fill={type:'pattern',pattern:'solid',fgColor:{argb:BRAND}};
    t1.alignment={vertical:'middle',horizontal:'left',indent:1};
    ws.getRow(1).height=30;

    ws.mergeCells('A2:H2');
    const sub=ws.getCell('A2');
    sub.value=`User: ${label}  |  Period: ${from||'—'} to ${to||'—'}  |  Equipment: ${equip||'All'}  |  Generated: ${new Date().toLocaleString()}`;
    sub.font={name:'Calibri',size:10,italic:true,color:{argb:'FF374151'}};
    sub.fill={type:'pattern',pattern:'solid',fgColor:{argb:BRAND_SOFT}};
    sub.alignment={vertical:'middle',horizontal:'left',indent:1};
    ws.getRow(2).height=20;

    const kpiLabels=['Sessions','Normal','Alarm','Alert','Critical'];
    const kpiValues=[sessions.length,sevCounts.NORMAL,sevCounts.ALARM,sevCounts.ALERT,sevCounts.CRITICAL];
    const kpiColors=[BRAND,SEV_FILL.NORMAL,SEV_FILL.ALARM,SEV_FILL.ALERT,SEV_FILL.CRITICAL];
    kpiLabels.forEach((lbl,i)=>{
      const c1=ws.getCell(4,i+1); c1.value=lbl;
      c1.font={bold:true,size:9,color:{argb:'FFFFFFFF'}};
      c1.fill={type:'pattern',pattern:'solid',fgColor:{argb:kpiColors[i]}};
      c1.alignment={horizontal:'center',vertical:'middle'}; c1.border=allBorder;
      const c2=ws.getCell(5,i+1); c2.value=kpiValues[i];
      c2.font={bold:true,size:13,color:{argb:'FF1A1D23'}};
      c2.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF4F5F7'}};
      c2.alignment={horizontal:'center',vertical:'middle'}; c2.border=allBorder;
    });
    ws.getRow(5).height=22;

    const headers=['Date','Equipment','Unit','Area','Overall Severity','Inspector','Recommendations'];
    const hdrRow=ws.getRow(6);
    headers.forEach((h,i)=>{
      const c=hdrRow.getCell(i+1); c.value=h;
      c.font={bold:true,size:10,color:{argb:'FFFFFFFF'}};
      c.fill={type:'pattern',pattern:'solid',fgColor:{argb:BRAND}};
      c.alignment={horizontal:'center',vertical:'middle',wrapText:true}; c.border=allBorder;
    });
    hdrRow.height=24;

    sessions.forEach((s,idx)=>{
      const os=worstSev(s.rows.map(r=>r.severity))||'NORMAL';
      const allRecs=[...new Set(s.rows.map(r=>r.recommendations||'').filter(Boolean).join('|').split('|').map(x=>x.trim()).filter(Boolean))].join(' | ');
      const r=ws.addRow([s.date,s.equipment,s.unit,s.area,os,s.inspector||s.username||'',allRecs]);
      const zebra=idx%2===0?'FFFFFFFF':'FFF9FAFB';
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
    ws.autoFilter={from:{row:6,column:1},to:{row:6,column:7}};

    // ── Sheet 2: Detailed Readings ──
    const ws2=wb.addWorksheet('Detailed Readings',{views:[{state:'frozen',ySplit:2}]});
    const detHdrs=['Date','Equipment','Unit','Area','Inspector','Overall Severity','Point','H Vel (mm/s)','V Vel (mm/s)','A Vel (mm/s)','Acc (g)','H Dis (µm)','V Dis (µm)','A Dis (µm)','Recommendations'];
    ws2.columns=detHdrs.map((h,i)=>({width:i===1?30:i===14?50:Math.max(h.length+2,12)}));

    ws2.mergeCells(1,1,1,detHdrs.length);
    const dt=ws2.getCell(1,1);
    dt.value=`VibeMon — User Report: ${label}`;
    dt.font={name:'Calibri',size:14,bold:true,color:{argb:'FFFFFFFF'}};
    dt.fill={type:'pattern',pattern:'solid',fgColor:{argb:BRAND}};
    dt.alignment={vertical:'middle',horizontal:'left',indent:1};
    ws2.getRow(1).height=24;

    const dHdr=ws2.getRow(2);
    detHdrs.forEach((h,i)=>{
      const c=dHdr.getCell(i+1); c.value=h;
      c.font={bold:true,size:10,color:{argb:'FFFFFFFF'}};
      c.fill={type:'pattern',pattern:'solid',fgColor:{argb:BRAND}};
      c.alignment={horizontal:'center',vertical:'middle',wrapText:true}; c.border=allBorder;
    });
    dHdr.height=24;

    let curRow=3;
    sessions.forEach((s,sidx)=>{
      const os=worstSev(s.rows.map(r=>r.severity))||'NORMAL';
      const allRecs=[...new Set(s.rows.map(r=>r.recommendations||'').filter(Boolean).join('|').split('|').map(x=>x.trim()).filter(Boolean))].join(' | ');
      const startRow=curRow;
      const zebra=sidx%2===0?'FFFFFFFF':'FFF9FAFB';
      sortRowsByMasterPoints(s.rows, s.equipment).forEach((r,ri)=>{
        const row=ws2.addRow([
          ri===0?s.date:'', ri===0?s.equipment:'', ri===0?s.unit:'', ri===0?s.area:'', ri===0?(s.inspector||s.username||''):'',
          ri===0?os:'',
          r.point, r.H_Vel||'', r.V_Vel||'', r.A_Vel||'', r.Acc||'', r.H_Dis||'', r.V_Dis||'', r.A_Dis||'',
          ri===0?allRecs:''
        ]);
        row.eachCell({includeEmpty:true},(cell,col)=>{
          cell.border=allBorder;
          cell.alignment={vertical:'middle',wrapText:true,horizontal:(col===2||col===15)?'left':'center'};
          cell.font={size:9};
          cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:zebra}};
        });
        curRow++;
      });
      if(s.rows.length>1){
        [1,2,3,4,5,6,15].forEach(col=>{
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

    status.innerHTML=`<div class="alert-box alert-info">⏳ Generating formatted Excel...</div>`;
    try {
      const buf=await wb.xlsx.writeBuffer();
      _downloadExcelBuffer(buf,`VibeMon_UserReport_${label.replace(/\s+/g,'_')}_${new Date().toISOString().slice(0,10)}.xlsx`);
      status.innerHTML=`<div class="alert-box alert-suc">✅ Excel downloaded — ${rows.length} readings for ${label}</div>`;
    } catch(err) {
      status.innerHTML=`<div class="alert-box alert-warn">⚠️ Excel generation failed: ${err.message}</div>`;
    }

  } else {
    // ─── PDF — improved format matching history export ───
    const JsPDF = _getJsPDF(); if (!JsPDF) return;
    const doc = new JsPDF({orientation:'landscape', unit:'mm', format:'a4'});
    const filters = `User: ${label}  |  Period: ${from||'—'} to ${to||'—'}  |  Equipment: ${equip||'All'}`;

    // ── Page 1: Summary by equipment session ──
    _pdfHeader(doc, `User Report — ${label}`, filters);

    // KPI strip
    const sevCounts2={NORMAL:0,ALARM:0,ALERT:0,CRITICAL:0};
    const sessionMap2={};const _noidC6={};
    rows.forEach(r=>{
      let key;
      if(r.reportId){key=r.reportId+'||'+r.equipment;}
      else{const b=r.date+'||'+r.equipment+'||'+(r.inspector||r.username||'')+'||'+(r.createdOn||'');if(!_noidC6[b])_noidC6[b]=0;key=b||('_noid_'+(_noidC6[b]++));}
      if(!sessionMap2[key]) sessionMap2[key]={date:r.date,equipment:r.equipment,unit:r.unit,area:r.area,inspector:r.inspector,rows:[]};
      sessionMap2[key].rows.push(r);
    });
    const sessions2=Object.values(sessionMap2).sort((a,b)=>b.date.localeCompare(a.date));
    sessions2.forEach(s=>{const os=worstSev(s.rows.map(r=>r.severity))||'NORMAL';sevCounts2[os]=(sevCounts2[os]||0)+1;});

    // Summary table
    doc.autoTable({
      startY:33,
      head:[['Date','Equipment','Unit','Area','Overall Severity','Inspector','Recommendations']],
      body:sessions2.map(s=>{
        const os=worstSev(s.rows.map(r=>r.severity))||'NORMAL';
        const allRecs=[...new Set(s.rows.map(r=>r.recommendations||'').filter(Boolean).join('|').split('|').map(x=>x.trim()).filter(Boolean))].join(' | ');
        return [s.date,s.equipment,s.unit||'',s.area||'',os,s.inspector||'',allRecs];
      }),
      theme:'grid',
      headStyles:{fillColor:[29,78,138],textColor:255,fontSize:8,halign:'center'},
      bodyStyles:{fontSize:7},
      columnStyles:{
        0:{cellWidth:20,halign:'center'},
        1:{cellWidth:38,halign:'left',fontStyle:'bold'},
        2:{cellWidth:20,halign:'center'},
        3:{cellWidth:20,halign:'center'},
        4:{cellWidth:20,halign:'center',fontStyle:'bold'},
        5:{cellWidth:22,halign:'center'},
        6:{halign:'left'}
      },
      didParseCell:function(data){
        if(data.section==='body' && data.column.index===4){
          const c=_SEV_COLOR[data.cell.raw]; if(c){data.cell.styles.fillColor=c;data.cell.styles.textColor=255;}
        }
      },
      margin:{left:10,right:10}
    });

    // ── Page 2: Detailed point readings ──
    doc.addPage();
    _pdfHeader(doc, `User Report — ${label} (Detailed)`, filters);
    doc.autoTable({
      startY:33,
      head:[['Date','Equipment','Unit','Area','Point','H Vel\n(mm/s)','V Vel\n(mm/s)','A Vel\n(mm/s)','Acc\n(g)','H Dis\n(µm)','Severity','Inspector','Recommendations']],
      body:rows.sort((a,b)=>b.date.localeCompare(a.date)||a.equipment.localeCompare(b.equipment)).map(r=>[
        r.date,r.equipment,r.unit||'',r.area||'',r.point,
        r.H_Vel||'—',r.V_Vel||'—',r.A_Vel||'—',r.Acc||'—',r.H_Dis||'—',
        r.severity||'NORMAL',r.inspector||'',r.recommendations||''
      ]),
      theme:'striped',
      headStyles:{fillColor:[29,78,138],textColor:255,fontSize:8,halign:'center',cellPadding:2},
      bodyStyles:{fontSize:7,halign:'center'},
      columnStyles:{
        0:{cellWidth:20},
        1:{halign:'left',cellWidth:36,fontStyle:'bold'},
        2:{cellWidth:16},
        3:{cellWidth:16},
        4:{halign:'left',cellWidth:20},
        5:{cellWidth:13},6:{cellWidth:13},7:{cellWidth:13},8:{cellWidth:11},9:{cellWidth:13},
        10:{fontStyle:'bold',cellWidth:18},
        11:{cellWidth:18},
        12:{halign:'left'}
      },
      didParseCell:function(data){
        if(data.section==='body' && data.column.index===10){
          const c=_SEV_COLOR[data.cell.raw]; if(c){data.cell.styles.fillColor=c;data.cell.styles.textColor=255;}
        }
      },
      margin:{left:10,right:10}
    });

    _pdfFooter(doc);
    _downloadPDF(doc, `VibeMon_UserReport_${label.replace(/\s+/g,'_')}_${new Date().toISOString().slice(0,10)}.pdf`);
    status.innerHTML=`<div class="alert-box alert-suc">✅ PDF downloaded — ${rows.length} readings for ${label}</div>`;
  }
}
