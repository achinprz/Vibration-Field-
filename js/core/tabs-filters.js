/* VibeMon — filter dropdowns + tab switching */

function populateFilters() {
  const units = [...new Set(MASTER.map(e=>e.unit))].sort();
  const areas = [...new Set(MASTER.map(e=>e.area))].sort();
  const users = [...new Set(READINGS.map(r=>r.username||r.inspector).filter(Boolean))].sort();
  ['e-unit','h-unit','d-unit'].forEach(id => {
    const el = document.getElementById(id); if(!el) return;
    const cur = el.value; while(el.options.length>1) el.remove(1);
    units.forEach(u=>el.add(new Option(u,u))); if(cur) el.value=cur;
  });
  ['e-area','h-area','d-area'].forEach(id => {
    const el = document.getElementById(id); if(!el) return;
    const cur = el.value; while(el.options.length>1) el.remove(1);
    areas.forEach(a=>el.add(new Option(a,a))); if(cur) el.value=cur;
  });
  // Populate user filter for dashboard and history
  ['d-user','h-user'].forEach(id => {
    const el = document.getElementById(id); if(!el) return;
    const cur = el.value; while(el.options.length>1) el.remove(1);
    users.forEach(u=>el.add(new Option(u,u))); if(cur) el.value=cur;
  });
  // Populate exception filters
  typeof populateExcFilters === 'function' && populateExcFilters();
}

function showTab(t) {
  if (!['entry','history','daily','missed'].includes(t)) { showTab('daily'); return; }
  if (t==='entry' && AUTH.role==='viewer') { alert('Viewers cannot access Data Entry. Please login as Engineer or Admin.'); showTab('history'); return; }
  // Offline mode: only Data Entry is accessible
  if (document.body.classList.contains('offline-mode') && t !== 'entry') {
    showToast('📵 Offline — only Data Entry is available. History & schedules will appear when internet is restored.', 'blue');
    t = 'entry';
  }
  const dailyWasOpen = document.getElementById('tab-daily').classList.contains('active');
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(b=>b.classList.remove('active'));
  document.getElementById('tab-'+t).classList.add('active');
  // Coming into Daily Schedule from another tab always starts on the calendar (a refresh inside the tab keeps its section)
  if (t==='daily' && !dailyWasOpen && typeof dsvSelect === 'function') dsvSelect('cal');
  // Find the matching nav-tab by its onclick attribute
  document.querySelectorAll('.nav-tab').forEach(b=>{
    if(b.getAttribute('onclick') && b.getAttribute('onclick').includes("'"+t+"'")) b.classList.add('active');
  });
  if(t==='history') renderHistory();
  if(t==='daily') { dsRender(); }
  if(t==='missed') { mrRender(); }
  // Update mobile bottom nav
  document.querySelectorAll('.mobile-tab').forEach(b=>b.classList.remove('active'));
  const mbTab=document.getElementById('mb-'+t);
  if(mbTab) mbTab.classList.add('active');
}
