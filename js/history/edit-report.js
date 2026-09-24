/* VibeMon — edit report modal */

// ======= EDIT REPORT =======
let editSession = null;
let editReadings = {};
let editRecs = '';

function openEditReport(date, equipment, reportId) {
  // Find session rows — prefer reportId match, fall back to date+equipment
  const rows = reportId
    ? READINGS.filter(r => r.reportId === reportId)
    : READINGS.filter(r => r.date === date && r.equipment === equipment);
  if (!rows.length) { alert('Session not found in memory. Please sync from Supabase first.'); return; }
  // Check permission — editor can only edit their own TODAY's readings
  if (AUTH.role === 'editor') {
    const sessionInspector = rows[0].inspector || '';
    const sessionUsername   = rows[0].username  || '';
    const isOwner = sessionInspector === AUTH.displayName || sessionUsername === AUTH.username;
    if (!isOwner) {
      showToast('You can only edit your own reports.', 'red'); return;
    }
    const sessionDate = (rows[0].date || '').slice(0, 10);
    if (sessionDate !== _todayFmt()) {
      showToast('Field Engineers can only edit today\'s readings. Contact Admin to edit older records.', 'red'); return;
    }
  }
  editSession = { date, equipment, rows };
  editReadings = {};
  rows.forEach(r => {
    editReadings[r.point] = { H_Vel: r.H_Vel||'', V_Vel: r.V_Vel||'', A_Vel: r.A_Vel||'', Acc: r.Acc||'', H_Dis: r.H_Dis||'', V_Dis: r.V_Dis||'', A_Dis: r.A_Dis||'' };
  });
  editRecs = rows[0]?.recommendations || '';
  editSession.isDecoupled = rows.some(r => r.isDecoupled || (r.remarks && r.remarks.includes('Decoupled Trial')));
  renderEditModal();
  document.getElementById('edit-report-modal').classList.add('open');
}

function renderEditModal() {
  if (!editSession) return;
  const { date, equipment, rows } = editSession;
  document.getElementById('edit-report-title').textContent = `✏️ Edit — ${equipment} (${fmtDateDisplay(date)})`;
  const paramKeys = ['H_Vel','V_Vel','A_Vel','Acc','H_Dis','V_Dis','A_Dis'];
  const paramLabels = { H_Vel:'H Vel (mm/s)', V_Vel:'V Vel (mm/s)', A_Vel:'A Vel (mm/s)', Acc:'Acc (g)', H_Dis:'H Dis (µm)', V_Dis:'V Dis (µm)', A_Dis:'A Dis (µm)' };
  const currentSev = worstSev(rows.map(r => r.severity)) || 'NORMAL';
  const currentDept = rows[0]?.responsibleDept || '';
  // Date + Status header row (editable for editor/admin only)
  let html = `<div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:12px;padding:10px 12px;background:#f8fafc;border:1px solid var(--border);border-radius:8px">
    <div class="fg">
      <label>EQUIPMENT</label>
      <div style="font-size:13px;font-weight:700;color:var(--text);padding:6px 0">${equipment}</div>
    </div>
    <div class="fg">
      <label>READING DATE</label>
      <input type="date" id="edit-date-field" value="${date}"
        ${AUTH.role !== 'admin' ? 'readonly title="Only Admin can change the reading date"' : ''}
        style="padding:6px 10px;border:1px solid var(--border2);border-radius:6px;font-size:13px;background:${AUTH.role !== 'admin' ? '#f3f4f6' : '#fff'};${AUTH.role !== 'admin' ? 'cursor:not-allowed;color:var(--muted)' : ''}">
      ${AUTH.role !== 'admin' ? '<span style="font-size:10px;color:var(--muted)">🔒 Only Admin can change date</span>' : ''}
    </div>
    <div class="fg">
      <label>OVERALL STATUS OVERRIDE</label>
      <select id="edit-sev-override" style="padding:7px 10px;border:1px solid var(--border2);border-radius:6px;font-size:12px;background:#fff">
        <option value="">— Auto (calculated from readings) —</option>
        <option value="NORMAL"   ${currentSev==='NORMAL'  ?'selected':''} style="color:#1E8449">✅ NORMAL</option>
        <option value="ALARM"    ${currentSev==='ALARM'   ?'selected':''} style="color:#D97706">⚠️ ALARM</option>
        <option value="ALERT"    ${currentSev==='ALERT'   ?'selected':''} style="color:#EA580C">🔶 ALERT</option>
        <option value="CRITICAL" ${currentSev==='CRITICAL'?'selected':''} style="color:#DC2626">🚨 CRITICAL</option>
      </select>
    </div>
    <div class="fg">
      <label>RESPONSIBLE DEPT</label>
      <select id="edit-resp-dept" style="padding:7px 10px;border:1px solid var(--border2);border-radius:6px;font-size:12px;background:#fff">
        <option value="">— Select Dept —</option>
        ${DEPTS_LIST.map(d => `<option value="${d}" ${currentDept===d?'selected':''}>${d}</option>`).join('')}
      </select>
    </div>
    <div class="fg">
      <label>DECOUPLED TRIAL</label>
      <div style="display:flex;align-items:center;gap:8px;padding:6px 0">
        <input type="checkbox" id="edit-decoupled-chk" ${editSession.isDecoupled?'checked':''} onchange="onEditDecoupledToggle(this.checked)"
          style="width:18px;height:18px;cursor:pointer;accent-color:#D97706">
        <span style="font-size:12px;font-weight:600;color:${editSession.isDecoupled?'#92400E':'var(--muted)'}">${editSession.isDecoupled?'🔗 Decoupled':'Normal'}</span>
      </div>
    </div>
  </div>`;
  html += `<div class="tbl-wrap"><table><thead><tr><th>Point</th>${paramKeys.map(k=>`<th>${paramLabels[k]}</th>`).join('')}</tr></thead><tbody>`;
  sortRowsByMasterPoints(rows, equipment).forEach(r => {
    const pt = r.point;
    const sid = pt.replace(/[^a-zA-Z0-9]/g,'_');
    html += `<tr><td style="font-weight:600">${pt}</td>`;
    paramKeys.forEach(k => {
      html += `<td><input type="number" step="0.01" min="0" value="${editReadings[pt]?.[k]||''}" style="width:80px;padding:4px 6px;border:1px solid var(--border2);border-radius:5px;font-size:12px" id="edit_${sid}_${k}" oninput="editReadings['${pt}']['${k}']=this.value"></td>`;
    });
    html += `</tr>`;
  });
  html += `</tbody></table></div>`;
  // Build the recommendations section with dropdown + manual textarea
  const editRemarks = rows[0]?.remarks || '';
  const recOptions = STD_RECS.map(r=>`<option value="${r}">${r}</option>`).join('');
  html += `<div style="margin-top:14px;padding:12px;background:#f8fafc;border:1px solid var(--border);border-radius:8px">
    <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:8px;text-transform:uppercase;letter-spacing:.04em">📋 Recommendations</label>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
      <select id="edit-rec-dropdown" style="flex:1;min-width:220px;padding:7px 10px;border:1px solid var(--border2);border-radius:6px;font-size:12px;background:#fff">
        <option value="">— Select a standard recommendation —</option>
        ${recOptions}
      </select>
      <button class="btn btn-sm btn-primary" onclick="(function(){const sel=document.getElementById('edit-rec-dropdown');if(!sel.value)return;const ta=document.getElementById('edit-recs-field');const cur=ta.value.trim();ta.value=cur?(cur+'|'+sel.value):sel.value;editRecs=ta.value;sel.value='';ta.dispatchEvent(new Event('input'));})()">➕ Add to Recommendations</button>
    </div>
    <label style="font-size:10px;font-weight:600;color:var(--muted);display:block;margin-bottom:3px">RECOMMENDATIONS / NOTES</label>
    <textarea id="edit-recs-field" oninput="editRecs=this.value" style="width:100%;padding:8px;border:1px solid var(--border2);border-radius:6px;font-size:12px;min-height:70px;resize:vertical">${editRecs}</textarea>
    <label style="font-size:10px;font-weight:600;color:var(--muted);display:block;margin-bottom:3px;margin-top:8px">REMARKS</label>
    <textarea id="edit-remarks-field" style="width:100%;padding:8px;border:1px solid var(--border2);border-radius:6px;font-size:12px;min-height:45px;resize:vertical">${editRemarks}</textarea>
  </div>`;
  html += `<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;flex-wrap:wrap">
    <button class="btn" onclick="closeEditReport()">Cancel</button>
    <button class="btn btn-green" onclick="saveEditReport()">💾 Save Changes</button>
  </div>`;
  document.getElementById('edit-report-body').innerHTML = html;
}

function closeEditReport() {
  document.getElementById('edit-report-modal').classList.remove('open');
  editSession = null; editReadings = {}; editRecs = '';
}

function onEditDecoupledToggle(checked) {
  if (editSession) editSession.isDecoupled = checked;
  // Re-render to update label
  const lbl = document.querySelector('#edit-decoupled-chk + span');
  if (lbl) { lbl.textContent = checked ? '🔗 Decoupled' : 'Normal'; lbl.style.color = checked ? '#92400E' : 'var(--muted)'; }
}

async function saveEditReport() {
  if (!editSession) return;
  const { date: origDate, equipment, rows } = editSession;
  const recsField = document.getElementById('edit-recs-field');
  const remarksField = document.getElementById('edit-remarks-field');
  const sevField = document.getElementById('edit-sev-override');
  const dateField = document.getElementById('edit-date-field');
  const deptField = document.getElementById('edit-resp-dept');
  const decoupledChk = document.getElementById('edit-decoupled-chk');
  const newRecs     = recsField    ? recsField.value.trim()    : '';
  let   newRemarks  = remarksField ? remarksField.value.trim() : '';
  const sevOverride = sevField     ? sevField.value            : '';
  const newDate     = AUTH.role === 'admin'
    ? (dateField ? (dateField.value || origDate) : origDate)
    : origDate;
  const newDept     = deptField    ? deptField.value           : '';
  const newDecoupled = decoupledChk ? decoupledChk.checked : false;

  // Manage "Decoupled Trial" in remarks
  const decRemark = 'Decoupled Trial';
  if (newDecoupled && !newRemarks.includes(decRemark)) {
    newRemarks = newRemarks ? (newRemarks + ' | ' + decRemark) : decRemark;
  } else if (!newDecoupled && newRemarks.includes(decRemark)) {
    newRemarks = newRemarks.replace(/\s*\|\s*Decoupled Trial/g, '').replace(/Decoupled Trial\s*\|\s*/g, '').replace(/^Decoupled Trial$/,'').trim();
  }

  // Recalculate severity for each point (using decoupled limits if toggled)
  const updatedRows = rows.map(r => {
    const pt = r.point;
    const vals = editReadings[pt] || {};
    const sevs = ['H_Vel','V_Vel','A_Vel'].map(k => getSev(vals[k],'vel',equipment,newDecoupled))
      .concat(['Acc'].map(k => getSev(vals[k],'acc',equipment,newDecoupled)))
      .concat(['H_Dis','V_Dis','A_Dis'].map(k => getSev(vals[k],'dis',equipment,newDecoupled)));
    const autoSev = worstSev(sevs.filter(Boolean)) || 'NORMAL';
    const sev = sevOverride || autoSev;
    return { ...r, ...vals, date: newDate, severity: sev, recommendations: newRecs, remarks: newRemarks, responsibleDept: newDept, isDecoupled: newDecoupled };
  });

  // Update READINGS in memory — use reportId if available, else fall back to date+equipment
  if (editSession.rows[0] && editSession.rows[0].reportId) {
    const rid = editSession.rows[0].reportId;
    READINGS = READINGS.filter(r => r.reportId !== rid);
  } else {
    READINGS = READINGS.filter(r => !(r.date === origDate && r.equipment === equipment));
  }
  READINGS.push(...updatedRows);
  saveReadings();

  // Update Supabase readings table
  const reportId = (rows[0] && rows[0].reportId) ? rows[0].reportId : null;
  showSavingOverlay('💾 Saving changes…');
  try {
    const now = _localNowStr(); // Store as local IST — displayed as-is, no timezone conversion needed
    if (reportId) {
      // Update all point rows for this report_id
      const { error } = await _supabase
        .from('readings')
        .update({
          date:             newDate,
          recommendations:  newRecs,
          remarks:          newRemarks,
          responsible_dept: newDept,
          is_decoupled:     newDecoupled,
          updated_on:       now
        })
        .eq('report_id', reportId);
      if (error) console.warn('Supabase edit failed:', error.message);
      // Update individual point values
      for (const r of updatedRows) {
        await _supabase.from('readings')
          .update({ h_vel: r.H_Vel, v_vel: r.V_Vel, a_vel: r.A_Vel, acc: r.Acc,
                    h_dis: r.H_Dis, v_dis: r.V_Dis, a_dis: r.A_Dis, severity: r.severity, updated_on: now })
          .eq('report_id', reportId)
          .eq('point', r.point);
      }
    }
  } finally {
    hideSavingOverlay();
  }

  closeEditReport();
  renderHistory();
  showToast('✅ Report updated — saved to Supabase.', 'green');
}
