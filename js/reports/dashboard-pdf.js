/* VibeMon — dashboard helpers + History PDF export */

// ---- DASHBOARD — RELIABILITY COMMAND CENTER ----

// Fault keyword detection from recommendations
function detectFaultType(rec) {
  if(!rec) return null;
  const r = rec.toLowerCase();
  if(r.includes('unbalanc') || r.includes('balanc') || r.includes('impeller')) return 'Unbalance';
  if(r.includes('misalign') || r.includes('alignment') || r.includes('coupling')) return 'Misalignment';
  if(r.includes('bearing') || r.includes('lubricate') || r.includes('lubrication')) return 'Bearing Defect';
  if(r.includes('loose') || r.includes('looseness') || r.includes('baseplate') || r.includes('bolt') || r.includes('soft-foot')) return 'Looseness';
  if(r.includes('resonan')) return 'Resonance';
  if(r.includes('gear') || r.includes('gearbox')) return 'Gear Mesh';
  if(r.includes('electrical') || r.includes('rotor bar') || r.includes('motor rotor')) return 'Electrical';
  if(r.includes('cavitat')) return 'Cavitation';
  return null;
}

// Build savings estimates based on severity counts
function calcSavings(critCount, alertCount, alarmCount) {
  // Rough estimates per Indian thermal power plant standards
  const breakdownCostPerEvent = 250000; // ₹2.5L average breakdown avoided
  const plannedSavingPerEvent = 80000;  // ₹80K per planned shutdown avoidance
  const breakdownsPrevented = Math.round(critCount * 0.7 + alertCount * 0.2);
  const plannedAvoided = Math.round(alertCount * 0.4 + alarmCount * 0.2);
  const totalSavings = breakdownsPrevented * breakdownCostPerEvent + plannedAvoided * plannedSavingPerEvent;
  const cmCost = Math.round(totalSavings * 0.15); // ~15% of savings as CM cost
  const roi = cmCost > 0 ? Math.round((totalSavings / cmCost) * 100) : 0;
  return { breakdownsPrevented, plannedAvoided, totalSavings, cmCost, roi };
}

function fmtINR(n) {
  if(n >= 10000000) return '₹' + (n/10000000).toFixed(1) + 'Cr';
  if(n >= 100000) return '₹' + (n/100000).toFixed(1) + 'L';
  if(n >= 1000) return '₹' + (n/1000).toFixed(0) + 'K';
  return '₹' + n;
}


// Active fault filter for dashboard cross-filtering
let _dashFaultFilter = null;

// ====================== PDF REPORTS (History + Dashboard) ======================
function _getJsPDF(){
  const j = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
  if(!j){ alert('PDF engine still loading, please try again in a moment.'); return null; }
  return j;
}
const _SEV_COLOR = { NORMAL:[30,132,73], ALARM:[217,119,6], ALERT:[154,52,18], CRITICAL:[153,27,27] };
function _pdfHeader(doc, title, filters){
  doc.setFillColor(29,78,138); doc.rect(0,0,doc.internal.pageSize.getWidth(),22,'F');
  doc.setTextColor(255,255,255); doc.setFontSize(14); doc.setFont('helvetica','bold');
  doc.text('VibeMon — '+title, 10, 14);
  doc.setFontSize(9); doc.setFont('helvetica','normal');
  doc.text('Generated: '+new Date().toLocaleString(), doc.internal.pageSize.getWidth()-10, 14, {align:'right'});
  doc.setTextColor(40,40,40); doc.setFontSize(9);
  doc.text(filters, 10, 28);
}
function _pdfFooter(doc){
  const pages = doc.internal.getNumberOfPages();
  for(let i=1;i<=pages;i++){
    doc.setPage(i);
    doc.setFontSize(8); doc.setTextColor(120,120,120);
    doc.text('VibeMon Vibration Monitoring · Confidential',10,doc.internal.pageSize.getHeight()-6);
    doc.text('Page '+i+' / '+pages, doc.internal.pageSize.getWidth()-10, doc.internal.pageSize.getHeight()-6, {align:'right'});
  }
}

function exportHistoryPDF(){
  const JsPDF = _getJsPDF(); if(!JsPDF) return;
  const from=document.getElementById('h-from').value;
  const to=document.getElementById('h-to').value;
  const unit=document.getElementById('h-unit').value;
  const area=document.getElementById('h-area').value;
  const sev=document.getElementById('h-sev').value;
  const q=(document.getElementById('h-search').value||'').toLowerCase();
  const user=document.getElementById('h-user')?.value||'';

  let rows=READINGS.filter(r=>
    (!from||r.date>=from)&&(!to||r.date<=to)&&
    (!unit||r.unit===unit)&&(!area||r.area===area)&&
    (!user||(r.username===user||r.inspector===user))&&
    (!q||r.equipment.toLowerCase().includes(q))
  ).sort((a,b)=>b.date.localeCompare(a.date)||a.equipment.localeCompare(b.equipment));

  const sessionMap={};const _noidC3={};
  rows.forEach(r=>{
    let key;
    if(r.reportId){key=r.reportId+'||'+r.equipment;}
    else{const b=r.date+'||'+r.equipment+'||'+(r.inspector||r.username||'')+'||'+(r.createdOn||'');if(!_noidC3[b])_noidC3[b]=0;key=b||('_noid_'+(_noidC3[b]++));}
    if(!sessionMap[key]) sessionMap[key]={date:r.date,equipment:r.equipment,unit:r.unit,area:r.area,inspector:r.inspector,rows:[]};
    sessionMap[key].rows.push(r);
  });
  let sessions=Object.values(sessionMap).sort((a,b)=>b.date.localeCompare(a.date));
  if(sev) sessions=sessions.filter(s=>worstSev(s.rows.map(r=>r.severity))===sev);
  if(!sessions.length){ alert('No data in the selected range.'); return; }

  const doc = new JsPDF({orientation:'landscape',unit:'mm',format:'a4'});
  const filters = `Period: ${from||'—'} to ${to||'—'}  |  Unit: ${unit||'All'}  |  Area: ${area||'All'}  |  User: ${user||'All'}  |  Severity: ${sev||'All'}`;
  _pdfHeader(doc,'History Report',filters);

  // Stats
  const totalReadings = sessions.reduce((s,x)=>s+x.rows.length,0);
  const sevCounts = {NORMAL:0,ALARM:0,ALERT:0,CRITICAL:0};
  sessions.forEach(s=>{ const os=worstSev(s.rows.map(r=>r.severity))||'NORMAL'; sevCounts[os]=(sevCounts[os]||0)+1; });
  doc.autoTable({
    startY: 33,
    head:[['Sessions','Normal','Alarm','Alert','Critical']],
    body:[[sessions.length,sevCounts.NORMAL,sevCounts.ALARM,sevCounts.ALERT,sevCounts.CRITICAL]],
    theme:'grid',
    headStyles:{fillColor:[29,78,138],textColor:255,fontSize:9},
    bodyStyles:{fontSize:9,halign:'center'},
    margin:{left:10,right:10}
  });

  // Sessions summary (Points column removed)
  doc.autoTable({
    startY: doc.lastAutoTable.finalY+5,
    head:[['Date','Equipment','Unit','Area','Inspector','Severity','Recommendations','Decoupled']],
    body: sessions.map(s=>{
      const os=worstSev(s.rows.map(r=>r.severity))||'NORMAL';
      const recs=[...new Set(s.rows.map(r=>r.recommendations||'').filter(Boolean).join('|').split('|').map(x=>x.trim()).filter(Boolean))].join(' | ');
      const isDec = s.rows.some(r => r.isDecoupled || (r.remarks && r.remarks.includes('Decoupled Trial')));
      return [s.date,s.equipment,s.unit,s.area,s.inspector||'',os,recs,isDec?'Yes':'No'];
    }),
    theme:'striped',
    headStyles:{fillColor:[29,78,138],textColor:255,fontSize:9},
    bodyStyles:{fontSize:8,valign:'top'},
    columnStyles:{
      0:{cellWidth:20,halign:'center'},
      1:{cellWidth:36,halign:'left',fontStyle:'bold'},
      2:{cellWidth:16,halign:'center'},
      3:{cellWidth:16,halign:'center'},
      4:{cellWidth:20,halign:'center'},
      5:{cellWidth:20,halign:'center',fontStyle:'bold'},
      6:{cellWidth:60},
      7:{cellWidth:16,halign:'center'}
    },
    didParseCell: function(data){
      if(data.section==='body' && data.column.index===5){
        const c=_SEV_COLOR[data.cell.raw]; if(c){ data.cell.styles.fillColor=c; data.cell.styles.textColor=255; }
      }
    },
    margin:{left:10,right:10}
  });

  // Detailed readings — per-point Severity removed; Overall Severity shown once per equipment session
  doc.addPage();
  _pdfHeader(doc,'History — Detailed Readings',filters);
  const detBody=[];
  const sessionSpans=[]; // track overall sev rows for coloring
  sessions.forEach(s=>{
    const os=worstSev(s.rows.map(r=>r.severity))||'NORMAL';
    sortRowsByMasterPoints(s.rows, s.equipment).forEach((r,ri)=>{
      detBody.push([
        ri===0?s.date:'', ri===0?s.equipment:'', ri===0?os:'',
        r.point, r.H_Vel||'-', r.V_Vel||'-', r.A_Vel||'-',
        r.Acc||'-', r.H_Dis||'-', r.V_Dis||'-', r.A_Dis||'-'
      ]);
    });
  });
  doc.autoTable({
    startY:33,
    head:[['Date','Equipment','Overall Severity','Point','H Vel','V Vel','A Vel','Acc','H Dis','V Dis','A Dis']],
    body: detBody,
    theme:'grid',
    headStyles:{fillColor:[29,78,138],textColor:255,fontSize:8},
    bodyStyles:{fontSize:7,halign:'center'},
    columnStyles:{0:{cellWidth:18},1:{cellWidth:36,halign:'left'},2:{cellWidth:24,halign:'center',fontStyle:'bold'},3:{cellWidth:22,halign:'left'}},
    didParseCell:function(data){
      if(data.section==='body' && data.column.index===2 && data.cell.raw){
        const c=_SEV_COLOR[data.cell.raw]; if(c){ data.cell.styles.fillColor=c; data.cell.styles.textColor=255; }
      }
    },
    margin:{left:10,right:10}
  });

  _pdfFooter(doc);
  _downloadPDF(doc, `VibeMon_History_${new Date().toISOString().slice(0,10)}.pdf`);
}
