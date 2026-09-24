/* VibeMon — pending equipment + exception exports */

// ======= PENDING EQUIPMENT =======
function populatePendingFilters() {
  const units = [...new Set(MASTER.map(e=>e.unit))].sort();
  const areas = [...new Set(MASTER.map(e=>e.area))].sort();
  ['pend-unit'].forEach(id=>{
    const el=document.getElementById(id); if(!el) return;
    const cur=el.value; while(el.options.length>1) el.remove(1);
    units.forEach(u=>el.add(new Option(u,u))); if(cur) el.value=cur;
  });
  ['pend-area'].forEach(id=>{
    const el=document.getElementById(id); if(!el) return;
    const cur=el.value; while(el.options.length>1) el.remove(1);
    areas.forEach(a=>el.add(new Option(a,a))); if(cur) el.value=cur;
  });
}

function getPendingRows() {
  const window_ = parseInt(document.getElementById('pend-window')?.value||'1');
  const unit = document.getElementById('pend-unit')?.value||'';
  const area = document.getElementById('pend-area')?.value||'';
  const today = new Date(); today.setHours(0,0,0,0);

  // Determine cutoff date based on window
  let cutoff;
  if(window_===99){
    cutoff=null; // never or >3 months
  } else {
    cutoff=new Date(today);
    cutoff.setMonth(cutoff.getMonth()-window_);
    cutoff.setHours(0,0,0,0);
  }
  const threeMonthsAgo=new Date(today); threeMonthsAgo.setMonth(threeMonthsAgo.getMonth()-3);

  // Latest reading date per equipment
  const latestByEquip={};
  READINGS.forEach(r=>{if(!latestByEquip[r.equipment]||r.date>latestByEquip[r.equipment])latestByEquip[r.equipment]=r.date;});

  return MASTER.filter(e=>{
    if(unit && e.unit!==unit) return false;
    if(area && e.area!==area) return false;
    const lastDateStr=latestByEquip[e.name]||null;
    const lastDate=lastDateStr?new Date(lastDateStr):null;
    if(lastDate) lastDate.setHours(0,0,0,0);
    if(window_===99){
      // Never read OR last reading >3 months ago
      return !lastDate || lastDate<=threeMonthsAgo;
    } else {
      // No reading within the selected window
      return !lastDate || lastDate<cutoff;
    }
  }).map(e=>{
    const lastDateStr=latestByEquip[e.name]||null;
    const lastDate=lastDateStr?new Date(lastDateStr):null;
    if(lastDate) lastDate.setHours(0,0,0,0);
    const daysSince=lastDate?Math.floor((today-lastDate)/86400000):null;
    return {name:e.name,unit:e.unit,area:e.area,frequency:e.frequency,lastDate:lastDateStr,daysSince};
  }).sort((a,b)=>{
    // Sort: never first, then by days since desc
    const da=a.daysSince===null?99999:a.daysSince;
    const db=b.daysSince===null?99999:b.daysSince;
    return db-da;
  });
}

function renderPending() {
  populatePendingFilters();
  const rows=getPendingRows();
  const tbody=document.getElementById('pend-body');
  const emptyEl=document.getElementById('pend-empty');
  const kpiEl=document.getElementById('pend-kpis');
  if(!tbody) return;

  // KPI strip
  const neverCount=rows.filter(r=>r.lastDate===null).length;
  const overdueCount=rows.filter(r=>r.daysSince!==null&&r.daysSince>90).length;
  const recentCount=rows.length-neverCount-overdueCount;
  if(kpiEl) kpiEl.innerHTML=`
    <div class="kpi" style="border-left-color:var(--blue);flex:1;min-width:100px"><div class="kpi-val">${rows.length}</div><div class="kpi-lbl">Pending total</div></div>
    <div class="kpi" style="border-left-color:#DC2626;flex:1;min-width:100px"><div class="kpi-val" style="color:#DC2626">${neverCount}</div><div class="kpi-lbl">Never read</div></div>
    <div class="kpi" style="border-left-color:var(--orange);flex:1;min-width:100px"><div class="kpi-val" style="color:var(--orange)">${overdueCount}</div><div class="kpi-lbl">&gt;90 days overdue</div></div>
    <div class="kpi" style="border-left-color:#D97706;flex:1;min-width:100px"><div class="kpi-val" style="color:#D97706">${recentCount}</div><div class="kpi-lbl">Within window</div></div>`;

  tbody.innerHTML='';
  if(!rows.length){
    emptyEl.style.display='block';
    return;
  }
  emptyEl.style.display='none';
  rows.forEach(r=>{
    const tr=document.createElement('tr');
    const statusBadge=r.lastDate===null
      ? '<span class="badge badge-cr" style="background:#FEE2E2;color:#991B1B">Never read</span>'
      : r.daysSince>90
        ? `<span class="badge badge-ov">Overdue ${r.daysSince}d</span>`
        : `<span class="badge badge-al">Pending ${r.daysSince}d</span>`;
    tr.innerHTML=`
      <td style="font-weight:600">${r.name}</td>
      <td>${r.unit}</td>
      <td>${r.area}</td>
      <td style="text-align:center">${r.frequency}</td>
      <td style="text-align:center;color:var(--muted)">${r.lastDate?fmtDateDisplay(r.lastDate):'—'}</td>
      <td style="text-align:center;font-weight:600;color:${r.daysSince===null?'#991B1B':r.daysSince>90?'#EA580C':'#D97706'}">${r.daysSince===null?'—':r.daysSince+'d'}</td>
      <td>${statusBadge}</td>`;
    tbody.appendChild(tr);
  });
}

async function exportPendingExcel() {
  if(typeof ExcelJS==='undefined'){alert('Excel engine loading, please try in a moment.');return;}
  const rows=getPendingRows();
  if(!rows.length){alert('No pending equipment to export.');return;}
  const window_=document.getElementById('pend-window')?.value||'1';
  const windowLabel={'1':'This month','2':'Last 2 months','3':'Last 3 months','99':'More than 3 months / Never'}[window_]||'';
  const unit=document.getElementById('pend-unit')?.value||'All';
  const area=document.getElementById('pend-area')?.value||'All';
  const wb=new ExcelJS.Workbook();
  const ws=wb.addWorksheet('Pending Equipment');
  const BRAND='FF1D4E8A';
  const thin={style:'thin',color:{argb:'FFE2E4E8'}};
  const allBorder={top:thin,left:thin,bottom:thin,right:thin};
  ws.columns=[{width:32},{width:14},{width:14},{width:16},{width:16},{width:14},{width:20}];
  ws.mergeCells('A1:G1');
  const t=ws.getCell('A1');
  t.value=`VibeMon — Pending Equipment Report | Window: ${windowLabel} | Unit: ${unit} | Area: ${area}`;
  t.font={name:'Calibri',size:12,bold:true,color:{argb:'FFFFFFFF'}};
  t.fill={type:'pattern',pattern:'solid',fgColor:{argb:BRAND}};
  t.alignment={vertical:'middle',horizontal:'left',indent:1};
  ws.getRow(1).height=24;
  const hdr=ws.addRow(['Equipment','Unit','Area','Frequency (days)','Last Reading','Days Since','Status']);
  hdr.font={bold:true,size:10,color:{argb:'FFFFFFFF'}};
  hdr.fill={type:'pattern',pattern:'solid',fgColor:{argb:BRAND}};
  hdr.height=18;
  hdr.eachCell(c=>{c.alignment={horizontal:'center',vertical:'middle'};c.border=allBorder;});
  rows.forEach((r,idx)=>{
    const status=r.lastDate===null?'Never read':r.daysSince>90?`Overdue ${r.daysSince}d`:`Pending ${r.daysSince}d`;
    const row=ws.addRow([r.name,r.unit,r.area,r.frequency,r.lastDate||'—',r.daysSince===null?'—':r.daysSince,status]);
    const bg=idx%2===0?'FFFFFFFF':'FFF4F5F7';
    row.eachCell({includeEmpty:true},c=>{c.font={size:10};c.border=allBorder;c.fill={type:'pattern',pattern:'solid',fgColor:{argb:bg}};c.alignment={vertical:'middle',horizontal:'center'};});
    row.getCell(1).alignment={horizontal:'left',vertical:'middle'};
    row.getCell(1).font={size:10,bold:true};
    if(r.lastDate===null){row.getCell(7).font={bold:true,size:10,color:{argb:'FF991B1B'}};}
    else if(r.daysSince>90){row.getCell(7).font={bold:true,size:10,color:{argb:'FF9A3412'}};}
  });
  ws.autoFilter={from:'A2',to:`G${ws.rowCount}`};
  try{
    const buf=await wb.xlsx.writeBuffer();
    _downloadExcelBuffer(buf,`VibeMon_Pending_${new Date().toISOString().slice(0,10)}.xlsx`);
  }catch(e){alert('Export failed: '+e.message);}
}

// Export exceptions to Excel
async function exportExceptionsExcel() {
  if(typeof ExcelJS==='undefined'){alert('Excel engine loading, please try in a moment.');return;}
  const rows=excFilteredRows();
  if(!rows.length){alert('No exception data to export.');return;}
  const wb=new ExcelJS.Workbook();
  wb.creator='VibeMon';
  const SEV_FILL={ALARM:'FFFFF3CD',ALERT:'FFFFE0CC',CRITICAL:'FFFFDCDC'};
  const SEV_FONT={ALARM:'FF92400E',ALERT:'FF9A3412',CRITICAL:'FF991B1B'};
  const BRAND='FF1D4E8A';
  const thin={style:'thin',color:{argb:'FFE2E4E8'}};
  const allBorder={top:thin,left:thin,bottom:thin,right:thin};

  const ws=wb.addWorksheet('Exceptions',{views:[{state:'frozen',ySplit:2}]});
  ws.columns=[
    {key:'date',width:13},{key:'equipment',width:32},{key:'unit',width:14},{key:'area',width:14},
    {key:'inspector',width:18},
    {key:'H_Vel',width:12},{key:'V_Vel',width:12},{key:'A_Vel',width:12},{key:'Acc',width:10},
    {key:'H_Dis',width:12},{key:'V_Dis',width:12},{key:'A_Dis',width:12},
    {key:'severity',width:18},{key:'recommendations',width:50},{key:'resp_dept',width:14}
  ];
  const headers=['Date','Equipment','Unit','Area','Inspector','H Vel (mm/s)','V Vel (mm/s)','A Vel (mm/s)','Acc (g)','H Dis (µm)','V Dis (µm)','A Dis (µm)','Severity','Recommendations','Resp. Dept'];
  const hdr=ws.addRow(headers);
  hdr.eachCell(c=>{
    c.font={bold:true,color:{argb:'FFFFFFFF'},size:10};
    c.fill={type:'pattern',pattern:'solid',fgColor:{argb:BRAND}};
    c.alignment={horizontal:'center',vertical:'middle',wrapText:true};
    c.border=allBorder;
  });
  hdr.height=26;

    rows.sort((a,b)=>b.date.localeCompare(a.date)||a.equipment.localeCompare(b.equipment)).forEach(r=>{
    const row=ws.addRow([r.date,r.equipment,r.unit,r.area,r.inspector||r.username||'',
      r.H_Vel||'',r.V_Vel||'',r.A_Vel||'',r.Acc||'',r.H_Dis||'',r.V_Dis||'',r.A_Dis||'',
      r.severity,r.recommendations||'',excDeptFor(r.equipment, r.responsibleDept)]);
    const bg=SEV_FILL[r.severity]||'FFFFFFFF';
    const fc=SEV_FONT[r.severity]||'FF1A1D23';
    row.eachCell({includeEmpty:true},c=>{
      c.fill={type:'pattern',pattern:'solid',fgColor:{argb:bg}};
      c.border=allBorder;c.alignment={vertical:'middle',wrapText:true};c.font={size:10};
    });
    // Severity cell bold (now col 13 instead of 14)
    const sevCell=row.getCell(13);
    sevCell.font={bold:true,size:10,color:{argb:fc}};
  });
  ws.autoFilter={from:'A1',to:`O${ws.rowCount}`};

  try{
    const buf=await wb.xlsx.writeBuffer();
    _downloadExcelBuffer(buf,`VibeMon_Exceptions_${new Date().toISOString().slice(0,10)}.xlsx`);
  }catch(e){alert('Export failed: '+e.message);}
}

// Export exceptions to PDF
function exportExceptionsPDF() {
  const JsPDF=_getJsPDF();if(!JsPDF)return;
  const rows=excFilteredRows();
  if(!rows.length){alert('No exception data to export.');return;}
  const f=getExcFilters();
  const doc=new JsPDF({orientation:'landscape',unit:'mm',format:'a4'});
  const filters=`Period: ${f.from||'—'} to ${f.to||'—'}  |  Unit: ${f.unit||'All'}  |  Area: ${f.area||'All'}  |  Severity: ${f.sev||'Alert+Critical'}`;
  _pdfHeader(doc,'Exceptions Report — Alert / Critical',filters);
  const cnt={ALARM:0,ALERT:0,CRITICAL:0};
  const equips=new Set();
  rows.forEach(r=>{if(cnt[r.severity]!==undefined)cnt[r.severity]++;equips.add(r.equipment);});
  doc.autoTable({
    startY:33,
    head:[['Total readings','Alert','Critical','Equipment affected']],
    body:[[rows.length,cnt.ALERT,cnt.CRITICAL,equips.size]],
    theme:'grid',headStyles:{fillColor:[29,78,138],textColor:255,fontSize:9},
    bodyStyles:{fontSize:9,halign:'center'},margin:{left:10,right:10}
  });
  const _SEV_COLOR2={ALARM:[215,119,6],ALERT:[154,52,18],CRITICAL:[153,27,27]};
  doc.autoTable({
    startY:doc.lastAutoTable.finalY+5,
    head:[['Date','Equipment','Unit','Area','Inspector','H Vel','V Vel','A Vel','Acc','Severity','Recommendations']],
    body:rows.sort((a,b)=>b.date.localeCompare(a.date)).map(r=>[
      r.date,r.equipment,r.unit||'',r.area||'',r.inspector||'',
      r.H_Vel||'—',r.V_Vel||'—',r.A_Vel||'—',r.Acc||'—',
      r.severity,r.recommendations||'']),
    theme:'striped',
    headStyles:{fillColor:[29,78,138],textColor:255,fontSize:8},
    bodyStyles:{fontSize:7,halign:'center'},
    columnStyles:{0:{cellWidth:18},1:{cellWidth:36,halign:'left'},2:{cellWidth:14},3:{cellWidth:14},
      4:{cellWidth:20},5:{cellWidth:12},6:{cellWidth:12},
      7:{cellWidth:12},8:{cellWidth:10},9:{cellWidth:18,fontStyle:'bold'},10:{halign:'left'}},
    didParseCell:function(data){
      if(data.section==='body'&&data.column.index===9){
        const c=_SEV_COLOR2[data.cell.raw];if(c){data.cell.styles.fillColor=c;data.cell.styles.textColor=255;}
      }
    },
    margin:{left:10,right:10}
  });
  _pdfFooter(doc);
  _downloadPDF(doc,`VibeMon_Exceptions_${new Date().toISOString().slice(0,10)}.pdf`);
}

function openExcWA(){
  const rows=excFilteredRows();
  if(!rows.length){alert('No exception data for current filters.');return;}
  const cnt={ALARM:0,ALERT:0,CRITICAL:0};const equips={};
  rows.forEach(r=>{
    if(cnt[r.severity]!==undefined)cnt[r.severity]++;
    const rank={NORMAL:1,ALARM:2,ALERT:3,CRITICAL:4};
    if(!equips[r.equipment]||(rank[r.severity]||0)>(rank[equips[r.equipment]]||0)) equips[r.equipment]=r.severity;
  });
  const f=getExcFilters();
  const fmtDate=d=>d?new Date(d).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}):'';
  const period=f.from&&f.to?`${fmtDate(f.from)} to ${fmtDate(f.to)}`:f.from?`From ${fmtDate(f.from)}`:f.to?`Up to ${fmtDate(f.to)}`:'All Dates';
  const div='--------------------------------';
  let msg=`*⚠️ VIBRATION EXCEPTIONS REPORT*\n${div}\nPeriod: ${period}\n`;
  if(f.unit)msg+=`Unit  : ${f.unit}\n`;if(f.area)msg+=`Area  : ${f.area}\n`;
  msg+=`${div}\nCritical : ${cnt.CRITICAL}\nAlert    : ${cnt.ALERT}\nAlarm    : ${cnt.ALARM}\n${div}\n`;
  const ordered=Object.entries(equips).sort((a,b)=>{const r={CRITICAL:3,ALERT:2,ALARM:1};return(r[b[1]]||0)-(r[a[1]]||0);});
  ordered.slice(0,15).forEach(([eq,sev])=>{
    const eqObj=MASTER.find(e=>e.name===eq)||{unit:'',area:''};
    const loc=[eqObj.unit,eqObj.area].filter(Boolean).join(' / ');
    const emoji={CRITICAL:'🚨',ALERT:'🔶',ALARM:'⚠️'}[sev]||'';
    msg+=`${emoji} ${eq}${loc?' ('+loc+')':''} — ${sev}\n`;
  });
  if(ordered.length>15)msg+=`... and ${ordered.length-15} more\n`;
  msg+=div;
  _waPendingMsg=msg;
  document.getElementById('wa-msg-preview').textContent=msg;
  document.getElementById('wa-phone').value=(window._waLastPhone||'');
  document.getElementById('wa-modal').classList.add('open');
}
