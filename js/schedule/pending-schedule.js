/* VibeMon — pending daily schedule filters */

/* === Pending Daily Schedule — Enhanced === */

// Store all pending rows globally for filter re-apply
let _dpAllRows = [];

function dpPopulateFilters(rows) {
  const units = [...new Set(rows.map(r=>r.it.u).filter(Boolean))].sort();
  const areas = [...new Set(rows.map(r=>r.it.a).filter(Boolean))].sort();
  const freqs = [...new Set(rows.map(r=>r.it.f).filter(Boolean))].sort();
  const depts = [...new Set(rows.map(r=>{const eq=MASTER.find(m=>m.name===r.it.n);return eq?_masterDeptOf(eq):''}).filter(Boolean))].sort();
  ['dp-f-unit','dp-f-area','dp-f-dept','dp-f-freq'].forEach((id,i)=>{
    const el=document.getElementById(id); if(!el) return;
    const cur=el.value; while(el.options.length>1) el.remove(1);
    const vals=[units,areas,depts,freqs][i]||[];
    vals.forEach(v=>el.add(new Option(v,v)));
    if(cur) el.value=cur;
  });
}

function dpGetMonthOffset() {
  const sel = document.getElementById('dp-month-sel');
  return sel ? parseInt(sel.value||'0',10) : 0;
}
