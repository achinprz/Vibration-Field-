/* VibeMon — toggle decoupled flag, delete session readings */

// ======= TOGGLE DECOUPLED FLAG FROM HISTORY CARD =======
async function toggleHistoryDecoupled(date, equipment, reportId, setDecoupled) {
  const rows = reportId
    ? READINGS.filter(r => r.reportId === reportId)
    : READINGS.filter(r => r.date === date && r.equipment === equipment);
  if (!rows.length) { showToast('Session not found.', 'red'); return; }
  // Permission check: editor can only toggle their own
  if (AUTH.role === 'editor') {
    const isOwner = (rows[0].inspector||'') === AUTH.displayName || (rows[0].username||'') === AUTH.username;
    if (!isOwner) { showToast('You can only change your own reports.', 'red'); return; }
  }
  const decRemark = 'Decoupled Trial';
  rows.forEach(r => {
    r.isDecoupled = setDecoupled;
    // Manage remark
    if (setDecoupled && !(r.remarks||'').includes(decRemark)) {
      r.remarks = r.remarks ? (r.remarks + ' | ' + decRemark) : decRemark;
    } else if (!setDecoupled && (r.remarks||'').includes(decRemark)) {
      r.remarks = (r.remarks||'').replace(/\s*\|\s*Decoupled Trial/g,'').replace(/Decoupled Trial\s*\|\s*/g,'').replace(/^Decoupled Trial$/,'').trim();
    }
    // Recalculate severity with new limits
    const vals = { H_Vel: r.H_Vel||'', V_Vel: r.V_Vel||'', A_Vel: r.A_Vel||'', Acc: r.Acc||'', H_Dis: r.H_Dis||'', V_Dis: r.V_Dis||'', A_Dis: r.A_Dis||'' };
    const sevs = ['H_Vel','V_Vel','A_Vel'].map(k => getSev(vals[k],'vel',equipment,setDecoupled))
      .concat(['Acc'].map(k => getSev(vals[k],'acc',equipment,setDecoupled)))
      .concat(['H_Dis','V_Dis','A_Dis'].map(k => getSev(vals[k],'dis',equipment,setDecoupled)));
    r.severity = worstSev(sevs.filter(Boolean)) || 'NORMAL';
  });
  saveReadings();
  // Update Supabase
  try {
    const rid = rows[0].reportId;
    if (rid) {
      const now = _localNowStr();
      const newRemarks = rows[0].remarks || '';
      await _supabase.from('readings').update({ is_decoupled: setDecoupled, remarks: newRemarks, updated_on: now }).eq('report_id', rid);
      // Update severity per point
      for (const r of rows) {
        await _supabase.from('readings').update({ severity: r.severity }).eq('report_id', rid).eq('point', r.point);
      }
    }
  } catch(e) { console.warn('Supabase decoupled toggle failed:', e.message); }
  renderHistory();
  showToast(setDecoupled ? '🔗 Marked as Decoupled Trial — severity recalculated' : '✅ Decoupled flag removed — severity restored', 'green');
}

// ======= DELETE SESSION READINGS (ADMIN) =======
async function deleteSessionReadings(date, equipment, reportId) {
  if (AUTH.role !== 'admin') { alert('Admin only.'); return; }
  const cnt = reportId
    ? READINGS.filter(r => r.reportId === reportId).length
    : READINGS.filter(r => r.date === date && r.equipment === equipment).length;
  if (!confirm(`Delete ALL ${cnt} point readings for:\n\n${equipment}\nDate: ${date}\n\nThis will permanently delete from Supabase too. Cannot be undone.`)) return;

  // 1. Capture reportId BEFORE removing from memory
  const firstRow = reportId
    ? READINGS.find(r => r.reportId === reportId)
    : READINGS.find(r => r.date === date && r.equipment === equipment);
  const resolvedReportId = (firstRow && firstRow.reportId) ? firstRow.reportId : reportId || null;

  // 2. Remove from in-memory READINGS
  READINGS = reportId
    ? READINGS.filter(r => r.reportId !== reportId)
    : READINGS.filter(r => !(r.date === date && r.equipment === equipment));
  saveReadings();
  renderHistory();

  // 3. Delete from Supabase
  try {
    if (resolvedReportId) {
      await _supabase.from('readings').delete().eq('report_id', resolvedReportId);
    } else {
      await _supabase.from('readings').delete()
        .eq('date', date).eq('equipment', equipment);
    }
  } catch(e) { console.warn('Supabase delete failed:', e.message); }

  showToast(`🗑️ Deleted: ${equipment} (${date}) — ${cnt} readings removed from App & Supabase.`, 'green');
}
