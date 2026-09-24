/* VibeMon — data retention auto-cleanup */

// ======= DATA RETENTION (Auto-cleanup) =======
// Keeps max 6 months of readings. Exception: if equipment has < 5 readings
// in the 6-month window, ALL its old readings are preserved for trend analysis.
async function runDataRetention() {
  if (!_supabase) { showToast('Supabase not connected', 'red'); return; }
  if (AUTH.role !== 'admin') { showToast('Admin only', 'red'); return; }

  const RETENTION_MONTHS = 6;
  const MIN_READINGS_THRESHOLD = 5;

  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - RETENTION_MONTHS);
  const cutoffStr = cutoffDate.toISOString().slice(0, 10);

  showToast('🔄 Analyzing data retention...', 'blue');

  try {
    // 1. Get all readings older than cutoff
    const { data: oldReadings, error: e1 } = await _supabase
      .from('readings')
      .select('id, equipment, date')
      .lt('date', cutoffStr)
      .order('date');
    if (e1) throw e1;
    if (!oldReadings || oldReadings.length === 0) {
      showToast('✅ No readings older than ' + RETENTION_MONTHS + ' months. Nothing to clean.', 'green');
      return;
    }

    // 2. Count readings per equipment in the retention window (last 6 months)
    const { data: recentCounts, error: e2 } = await _supabase
      .from('readings')
      .select('equipment')
      .gte('date', cutoffStr);
    if (e2) throw e2;

    const recentCountMap = {};
    (recentCounts || []).forEach(r => {
      const eq = (r.equipment || '').trim();
      recentCountMap[eq] = (recentCountMap[eq] || 0) + 1;
    });

    // 3. Filter: only delete old readings for equipment that has >= MIN_READINGS in the window
    const idsToDelete = [];
    const protectedEquip = new Set();
    const deletableEquip = new Set();

    oldReadings.forEach(r => {
      const eq = (r.equipment || '').trim();
      const recentCount = recentCountMap[eq] || 0;
      if (recentCount >= MIN_READINGS_THRESHOLD) {
        idsToDelete.push(r.id);
        deletableEquip.add(eq);
      } else {
        protectedEquip.add(eq);
      }
    });

    if (idsToDelete.length === 0) {
      showToast(`✅ All ${oldReadings.length} old readings are protected (equipment has < ${MIN_READINGS_THRESHOLD} recent readings). No deletion needed.`, 'green');
      return;
    }

    // 4. Confirm with admin
    const msg = `Data Retention Cleanup\n\n` +
      `Cutoff date: ${cutoffStr} (${RETENTION_MONTHS} months ago)\n` +
      `Old readings found: ${oldReadings.length}\n` +
      `Readings to DELETE: ${idsToDelete.length} (across ${deletableEquip.size} equipment)\n` +
      `Readings PROTECTED: ${oldReadings.length - idsToDelete.length} (across ${protectedEquip.size} equipment with < ${MIN_READINGS_THRESHOLD} recent readings)\n\n` +
      `Proceed with deletion?`;

    if (!confirm(msg)) {
      showToast('Cancelled.', 'orange');
      return;
    }

    // 5. Delete in batches of 500
    showToast('🗑 Deleting ' + idsToDelete.length + ' old readings...', 'blue');
    let deleted = 0;
    for (let i = 0; i < idsToDelete.length; i += 500) {
      const batch = idsToDelete.slice(i, i + 500);
      const { error: delErr } = await _supabase
        .from('readings')
        .delete()
        .in('id', batch);
      if (delErr) throw delErr;
      deleted += batch.length;
    }

    showToast(`✅ Deleted ${deleted} old readings. ${protectedEquip.size} equipment preserved for trend data.`, 'green');

    // 6. Refresh local data
    await syncFromSupabase();
    renderHistory();

  } catch (err) {
    showToast('❌ Retention cleanup failed: ' + err.message, 'red');
    console.error('Data retention error:', err);
  }
}
