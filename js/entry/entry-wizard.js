/* VibeMon — Data Entry wizard (steps 1-4, severity override) */

// ---- ENTRY: STEP 1 ----
function filterEntryList() {
  const unit=document.getElementById('e-unit').value;
  const area=document.getElementById('e-area').value;
  const q=document.getElementById('e-search').value.toLowerCase();
  const filtered=MASTER.filter(e=>(!unit||e.unit===unit)&&(!area||e.area===area)&&(!q||e.name.toLowerCase().includes(q)));
  document.getElementById('e-list-count').textContent = filtered.length+' equipment';
  const tbody=document.getElementById('equip-select-body'); tbody.innerHTML='';
  const lastReadingMap = buildLastReadingMap(); // PERF: one pass over READINGS, not per-equipment
  filtered.slice(0,300).forEach(e=>{
    const last=lastReadingMap[e.name]||null, si=schedInfo(e,last);
    let badge='';
    if(si.status==='OVERDUE') badge=`<span class="badge badge-ov">Overdue ${si.over}d</span>`;
    else if(si.status==='DUE') badge='<span class="badge badge-due">Due today</span>';
    else if(si.status==='NEW') badge='<span class="badge badge-p">No reading yet</span>';
    else badge='<span class="badge badge-n">OK</span>';
    const tr=document.createElement('tr');
    tr.style.cursor='pointer';
    tr.onclick=()=>selectEquip(e);
    tr.innerHTML=`<td data-label="Unit">${e.unit}</td><td data-label="Area">${e.area}</td><td data-label="Equipment" style="font-weight:600">${e.name}</td>
      <td data-label="Schedule">${badge}</td><td data-label="Last Reading" style="color:var(--muted);font-size:11px">${last?fmtDateDisplay(last.date):'—'}</td>`;
    tbody.appendChild(tr);
  });
}

function selectEquip(e) {
  entryEquip=e; entryReadings={}; entryRecs=[];
  document.getElementById('s2-eq-name').textContent=e.name;
  // Show per-equipment vibration limits
  const limEl = document.getElementById('s2-vib-limits');
  if (limEl) {
    const el = getEquipLimits(e.name, 'vel');
    if (el) {
      const unit = el.u === 'mic' ? 'µm (Displacement)' : 'mm/s (Velocity)';
      limEl.innerHTML = `<div class="alert-box alert-info" style="margin-bottom:8px;font-size:11px">
        📐 <strong>Vibration Limits (${unit}):</strong>&nbsp;
        <span style="color:var(--green)">✅ Normal: ≤${el.a}</span> &nbsp;|&nbsp;
        <span style="color:#D97706">⚠️ Alarm: ${el.a}–${el.at}</span> &nbsp;|&nbsp;
        <span style="color:var(--orange)">🔶 Alert: ${el.at}–${el.c}</span> &nbsp;|&nbsp;
        <span style="color:#DC2626">🔴 Critical: >${el.c}</span>
      </div>`;
    } else {
      limEl.innerHTML = '';
    }
  }
  document.getElementById('s2-eq-meta').textContent=`${e.unit} · ${e.area} · Every ${e.frequency} days · ${e.points.length} measurement points`;
  const _entryDateEl = document.getElementById('entry-date');
  const _todayIso = _todayFmt();
  _entryDateEl.value = _todayIso;
  if (AUTH.role !== 'admin') {
    // Field engineers can enter today or any future date — past dates are blocked
    _entryDateEl.min = _todayIso;
    _entryDateEl.removeAttribute('max');
    _entryDateEl.style.background = '';
    _entryDateEl.style.cursor = '';
    _entryDateEl.title = '📅 You can select today or a future date. Past dates are not allowed.';
  } else {
    // Admin — no restriction, clear any previously set limits
    _entryDateEl.removeAttribute('min');
    _entryDateEl.removeAttribute('max');
    _entryDateEl.style.background = '';
    _entryDateEl.style.cursor = '';
    _entryDateEl.title = 'Admin can enter readings for any date';
  }
  // Populate Responsible Dept dropdown — auto-fetch from Equipment Master first, then fallback to reading history
  const rdSel = document.getElementById('entry-resp-dept');
  if (rdSel) {
    while (rdSel.options.length > 1) rdSel.remove(1);
    DEPTS_LIST.forEach(d => rdSel.add(new Option(d, d)));
    // Priority 1: dept from Equipment Master EQUIP_MAP (Column K in master sheet)
    const masterDept = deptFromMaster(e.name);
    // Priority 2: check the raw MASTER object in case EQUIP_MAP build missed it
    const rawMasterObj = (MASTER||[]).find(m => _eqKey(m.name||'')===_eqKey(e.name));
    const rawMasterDept = rawMasterObj ? _masterDeptOf(rawMasterObj) : '';
    // Priority 3: dept from most recent reading history for this equipment
    const historyDept = excDeptFor(e.name, '');
    // Priority 4: dept from the equipment object itself (if set during buildEquipmentMap)
    const eqInfoDept = (equipInfo(e.name)||{}).dept || '';
    const resolvedDept = masterDept || rawMasterDept || eqInfoDept || historyDept;
    if (resolvedDept) {
      if (![...rdSel.options].some(o => o.value === resolvedDept)) rdSel.add(new Option(resolvedDept, resolvedDept));
      rdSel.value = resolvedDept;
    } else {
      rdSel.value = '';
    }
  }
  const si=schedInfo(e);
  const alertEl=document.getElementById('s2-alert'), badgeEl=document.getElementById('s2-sched-badge');
  if(si.status==='OVERDUE') {
    alertEl.style.display='block';
    alertEl.innerHTML=`<div class="alert-box alert-warn">⚠️ Overdue by ${si.over} day(s). Last reading: ${fmtDateDisplay(getLastReading(e.name).date)}. Frequency: every ${e.frequency} days.</div>`;
    badgeEl.innerHTML=`<span class="badge badge-ov">Overdue ${si.over}d</span>`;
  } else {
    alertEl.style.display='none';
    badgeEl.innerHTML=si.status==='NEW'?'<span class="badge badge-p">First reading</span>':'<span class="badge badge-n">Schedule OK</span>';
  }
  buildPointCards();
  goStep(2);
}

// ---- ENTRY: STEP 2 ----
function safeId(s) { return s.replace(/[^a-zA-Z0-9]/g,'_'); }

// Decoupled Trial: which points are shown in decoupled mode
const DECOUPLED_POINTS = ['MDE', 'MNDE'];

function onDecoupledToggle(checked) {
  buildPointCards();
}

function isDecoupledMode() {
  const chk = document.getElementById('decoupled-trial-chk');
  return chk && chk.checked;
}

function buildPointCards() {
  const con=document.getElementById('pt-cards-container'); con.innerHTML='';
  const decoupled = isDecoupledMode();

  // In decoupled mode, only show MDE & MNDE cards
  let pointsToShow = entryEquip.points;
  if (decoupled) {
    pointsToShow = entryEquip.points.filter(pt =>
      DECOUPLED_POINTS.some(dp => pt.trim().toUpperCase().includes(dp))
    );
    // If equipment doesn't have MDE/MNDE named points, fall back to first 2 points
    if (pointsToShow.length === 0) pointsToShow = entryEquip.points.slice(0, 2);
  }

  // Show decoupled banner
  const existBanner = document.getElementById('decoupled-banner');
  if (existBanner) existBanner.remove();
  if (decoupled) {
    const banner = document.createElement('div');
    banner.id = 'decoupled-banner';
    banner.style = 'background:#FFF3CD;border:1px solid #D97706;border-radius:var(--radius);padding:8px 14px;margin-bottom:10px;font-size:12px;color:#92400E;display:flex;align-items:center;gap:8px';
    banner.innerHTML = `<span style="font-size:16px">🔗</span><span><strong>Decoupled Trial Mode</strong> — Only <strong>${DECOUPLED_POINTS.join(' & ')}</strong> measurement points shown. A remark "Decoupled Trial" will be auto-added on save.</span>`;
    con.before(banner);
  }

  pointsToShow.forEach(pt=>{
    if(!entryReadings[pt]) entryReadings[pt]={};
    const prev=entryReadings[pt];
    const card=document.createElement('div'); card.className='pt-card'; card.id='ptcard-'+safeId(pt);
    const fields=entryEquip.params.map(param=>{
      const key=param.replace(/\s/g,'_');
      const type=param.toLowerCase().includes('acc')?'acc':param.toLowerCase().includes('dis')?'dis':'vel';
      const unit=type==='acc'?'g':type==='dis'?'µm':'mm/s';
      return `<div class="param-row">
        <span class="param-label">${param}</span>
        <input type="number" step="0.01" min="0" value="${prev[key]||''}" placeholder="—"
          id="inp_${safeId(pt)}_${key}" oninput="onParamInput('${pt}','${key}','${type}')">
        <span class="param-unit">${unit}</span>
      </div>`;
    }).join('');
    card.innerHTML=`<div class="pt-card-head"><span class="pt-card-title">📍 ${pt}</span><span id="ptov-${safeId(pt)}"></span></div>
      <div class="pt-card-body">${fields}</div>`;
    con.appendChild(card);
  });
  updateProgress();
}

function onParamInput(pt, key, type) {
  const el=document.getElementById(`inp_${safeId(pt)}_${key}`); if(!el) return;
  const val=el.value;
  const decMode = isDecoupledMode();
  const sev=getSev(val,type,entryEquip?entryEquip.name:null,decMode);
  el.className=sev==='CRITICAL'?'crit':sev==='ALERT'?'danger':sev==='ALARM'?'warn':'';

  if(!entryReadings[pt]) entryReadings[pt]={};
  entryReadings[pt][key]=val;
  updatePtOverall(pt);
  updateProgress();
}

function updatePtOverall(pt) {
  const r=entryReadings[pt]||{};
  const decMode = isDecoupledMode();
  const sevs=entryEquip.params.map(p=>{
    const key=p.replace(/\s/g,'_');
    const type=p.toLowerCase().includes('acc')?'acc':p.toLowerCase().includes('dis')?'dis':'vel';
    return getSev(r[key],type,entryEquip?entryEquip.name:null,decMode);
  });
  const os=worstSev(sevs);
  const el=document.getElementById(`ptov-${safeId(pt)}`);
  if(el) el.innerHTML=badgeHtml(os);
}

function updateProgress() {
  const decoupled = isDecoupledMode();
  let visiblePts = entryEquip.points;
  if (decoupled) {
    visiblePts = entryEquip.points.filter(pt =>
      DECOUPLED_POINTS.some(dp => pt.trim().toUpperCase().includes(dp))
    );
    if (visiblePts.length === 0) visiblePts = entryEquip.points.slice(0, 2);
  }
  const filled=visiblePts.filter(pt=>{
    const r=entryReadings[pt]||{};
    return entryEquip.params.some(p=>r[p.replace(/\s/g,'_')]!==undefined&&r[p.replace(/\s/g,'_')]!=='');
  });
  document.getElementById('s2-progress-text').textContent=`${filled.length}/${visiblePts.length} points entered${decoupled?' (Decoupled Trial)':''}`;
}

// ---- ENTRY: STEP 3 — RECOMMENDATIONS ----
function goStep(n) {
  [1,2,3,4].forEach(i=>{
    document.getElementById('entry-s'+i).style.display=i===n?'block':'none';
    const b=document.getElementById('estep'+i);
    b.classList.remove('active','done');
    if(i<n) b.classList.add('done');
    else if(i===n) b.classList.add('active');
  });
  if(n===1) {
    // Reset decoupled checkbox and banner when going back to equipment list
    const chk = document.getElementById('decoupled-trial-chk');
    if (chk) chk.checked = false;
    const banner = document.getElementById('decoupled-banner');
    if (banner) banner.remove();
    filterEntryList();
  }
  if(n===3) buildRecsStep();
  if(n===4) buildReview();
}

function buildRecsStep() {
  document.getElementById('s3-eq-name').textContent=entryEquip.name+' — '+entryEquip.unit+' / '+entryEquip.area;
  // Show current severity preview
  const allSevs=[];
  entryEquip.points.forEach(pt=>{
    const r=entryReadings[pt]||{};
    entryEquip.params.forEach(p=>{
      const key=p.replace(/\s/g,'_');
      const type=p.toLowerCase().includes('acc')?'acc':p.toLowerCase().includes('dis')?'dis':'vel';
      const s=getSev(r[key],type); if(s) allSevs.push(s);
    });
  });
  const os=worstSev(allSevs);
  document.getElementById('s3-sev-preview').innerHTML=`Overall vibration status: ${badgeHtml(os)}`;
  renderRecItems();
}

function addRecFromPicker() {
  const picker=document.getElementById('std-rec-picker');
  if(!picker||!picker.value) return;
  entryRecs.push({type:'dropdown',value:picker.value});
  picker.value='';
  renderRecItems();
}

function renderRecItems() {
  const con=document.getElementById('rec-items-container'); con.innerHTML='';
  // Populate the std-rec-picker if STD_RECS available and not yet populated
  const picker=document.getElementById('std-rec-picker');
  if(picker && STD_RECS.length && picker.options.length<=1){
    STD_RECS.forEach(r=>{const o=document.createElement('option');o.value=r;o.textContent=r;picker.add(o);});
  }
  entryRecs.forEach((rec,i)=>{
    const div=document.createElement('div'); div.className='rec-item';
    if(rec.type==='dropdown') {
      div.innerHTML=`<span style="flex:1;padding:6px 10px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:var(--radius);font-size:12px;color:#1D4E8A;font-weight:500">📋 ${rec.value}</span>
      <button class="btn btn-sm" style="color:var(--red);border-color:var(--red)" onclick="removeRec(${i})">✕ Remove</button>`;
    } else {
      div.innerHTML=`<input type="text" value="${rec.value}" placeholder="Enter manual recommendation..." oninput="updateRec(${i},this.value)"
        style="flex:1;padding:6px 10px;border:1px solid var(--border2);border-radius:var(--radius);font-size:12px">
      <button class="btn btn-sm" style="color:var(--red);border-color:var(--red)" onclick="removeRec(${i})">✕ Remove</button>`;
    }
    con.appendChild(div);
  });
}

function addRecDropdown() {
  entryRecs.push({type:'dropdown', value:STD_RECS[0]});
  renderRecItems();
}
function addManualRec() {
  entryRecs.push({type:'manual', value:''});
  renderRecItems();
}
function updateRec(i, val) { entryRecs[i].value=val; }
function removeRec(i) { entryRecs.splice(i,1); renderRecItems(); }

// ---- ENTRY: STEP 4 — REVIEW ----
function buildReview() {
  const e=entryEquip;
  document.getElementById('s4-eq-name').textContent=e.name+' — '+e.unit+'/'+e.area;
  // Reset severity override dropdown
  const ovEl=document.getElementById('s4-sev-override');
  if(ovEl) ovEl.value='';
  const tbody=document.getElementById('s4-review-body'); tbody.innerHTML='';
  const allSevs=[];
  e.points.forEach(pt=>{
    const r=entryReadings[pt]||{};
    const paramCols=['H_Vel','V_Vel','A_Vel','Acc','H_Dis','V_Dis','A_Dis'].map(k=>{
      const val=r[k];
      const type=k.toLowerCase().includes('acc')?'acc':k.toLowerCase().includes('dis')?'dis':'vel';
      const sev=getSev(val,type,entryEquip?entryEquip.name:null); if(sev) allSevs.push(sev);
      const style=sev==='CRITICAL'?'color:#DC2626;font-weight:700':sev==='ALERT'?'color:#EA580C;font-weight:700':sev==='ALARM'?'color:#D97706;font-weight:600':'';
      return `<td style="${style}">${val!==undefined&&val!==''?parseFloat(val).toFixed(2):'—'}</td>`;
    }).join('');
    const ptSevs=e.params.map(p=>{
      const key=p.replace(/\s/g,'_');
      const type=p.toLowerCase().includes('acc')?'acc':p.toLowerCase().includes('dis')?'dis':'vel';
      return getSev(r[key],type,entryEquip?entryEquip.name:null);
    });
    const os=worstSev(ptSevs.filter(Boolean));
    const tr=document.createElement('tr');
    tr.innerHTML=`<td style="font-weight:600">📍 ${pt}</td>${paramCols}<td>${badgeHtml(os)}</td>`;
    tbody.appendChild(tr);
  });
  const os=worstSev(allSevs);
  const badgeEl=document.getElementById('s4-overall-badge');
  badgeEl.setAttribute('data-auto',os);
  badgeEl.innerHTML=badgeHtml(os);
  const cnt={NORMAL:0,ALARM:0,ALERT:0,CRITICAL:0};
  allSevs.forEach(s=>{ if(cnt[s]!==undefined) cnt[s]++; });
  document.getElementById('s4-kpis').innerHTML=`
    <div class="kpi kpi-g"><div class="kpi-val">${cnt.NORMAL}</div><div class="kpi-lbl">Normal readings</div></div>
    <div class="kpi kpi-a"><div class="kpi-val">${cnt.ALARM}</div><div class="kpi-lbl">Alarm</div></div>
    <div class="kpi kpi-at"><div class="kpi-val">${cnt.ALERT}</div><div class="kpi-lbl">Alert</div></div>
    <div class="kpi kpi-r"><div class="kpi-val">${cnt.CRITICAL}</div><div class="kpi-lbl">Critical</div></div>`;
  // Show recs
  const allRecs=[...entryRecs.map(r=>r.value).filter(Boolean)];
  const extra=document.getElementById('extra-remarks').value.trim();
  if(extra) allRecs.push(extra);
  const recDiv=document.getElementById('s4-recs');
  if(allRecs.length) {
    recDiv.innerHTML='<div style="font-size:12px;font-weight:600;margin-bottom:6px;color:var(--muted)">RECOMMENDATIONS</div>'+
      allRecs.map((r,i)=>`<div style="font-size:12px;padding:4px 0;border-bottom:1px solid var(--border)">${i+1}. ${r}</div>`).join('');
  } else {
    recDiv.innerHTML='<div style="font-size:12px;color:var(--muted)">No recommendations added.</div>';
  }
}

// ---- SEVERITY OVERRIDE ----
function applyOverrideSeverity(val) {
  const badge=document.getElementById('s4-overall-badge');
  if(!badge) return;
  const auto=badge.getAttribute('data-auto')||'NORMAL';
  const effective=val||auto;
  badge.innerHTML=badgeHtml(effective);
  // Color-code the select to match severity
  const sel=document.getElementById('s4-sev-override');
  if(!sel) return;
  const colors={ALERT:'#9A3412',ALARM:'#92400E',NORMAL:'#1E8449',CRITICAL:'#991B1B'};
  sel.style.color=val ? (colors[val]||'var(--text)') : 'var(--text)';
  sel.style.fontWeight=val?'700':'400';
}
