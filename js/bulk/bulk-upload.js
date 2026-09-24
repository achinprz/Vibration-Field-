/* VibeMon — bulk Excel upload */

// ======= EXCEL BULK UPLOAD =======

function uploadBulkExcel(input) {
  const file = input.files[0]; if (!file) return;
  const statusEl = document.getElementById('bulk-upload-status');
  statusEl.innerHTML = '<div class="alert-box alert-info">⏳ Processing Excel...</div>';
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      // Try "Reading_Entry" sheet first (smart template), else first sheet
      const sheetName = wb.SheetNames.includes('Reading_Entry') ? 'Reading_Entry' : wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rawRows.length) { statusEl.innerHTML = '<div class="alert-box alert-warn">⚠️ No data found in Excel.</div>'; return; }

      const newRows = [];
      const errors = [];
      const skipped = [];
      // Carry-forward logic for merged cells (Equipment, Date, Inspector, Recommendations, Dept)
      let lastEquip='', lastDate='', lastInspector='', lastRecs='', lastUnit='', lastArea='', lastDeptCF='';
      // PERF: O(1) equipment lookups — use _eqKey() for case-insensitive matching
      // so dept lookup aligns with deptFromMaster() / EQUIP_MAP behaviour
      const masterByNameUL = {};
      MASTER.forEach(m => { masterByNameUL[_eqKey(m.name)] = m; });

      rawRows.forEach((row, idx) => {
        // Resolve carry-forward for merged cells
        const equip = String(row['Equipment']||'').trim() || lastEquip;
        const date  = String(row['Date']||row['Date (YYYY-MM-DD)']||'').trim() || lastDate;
        const insp  = String(row['Inspector']||'').trim() || lastInspector || AUTH.displayName || '';
        const recs  = String(row['Recommendations']||'').trim() || (equip !== lastEquip ? '' : lastRecs);
        const unit  = String(row['Unit']||'').trim() || lastUnit;
        const area  = String(row['Area']||'').trim() || lastArea;
        // Dept carry-forward: reset when new equipment block starts
        const deptCell = String(row['Dept']||row['dept']||row['Department']||row['DEPT']||'').trim();
        const dept = deptCell || (equip !== lastEquip ? '' : lastDeptCF);
        const pt    = String(row['Point']||row['point']||'').trim();

        if (equip) lastEquip = equip;
        if (date)  lastDate  = date;
        if (insp)  lastInspector = insp;
        if (unit)  lastUnit  = unit;
        if (area)  lastArea  = area;
        if (recs || equip !== lastEquip) lastRecs = recs;
        if (dept)  lastDeptCF = dept;

        if (!equip || !pt) return; // empty row
        if (!date) { errors.push(`Row ${idx+2}: No date for ${equip} - ${pt}`); return; }

        const eqObj = masterByNameUL[_eqKey(equip)];
        const resolvedUnit = unit || eqObj?.unit || '';
        const resolvedArea = area || eqObj?.area || '';

        // Parse values — treat 'N/A' / empty as ''
        const parseVal = v => { const s = String(v||'').trim(); return (s===''||s.toUpperCase()==='N/A') ? '' : s; };
        const H_Vel = parseVal(row['H Vel (mm/s)']||row['H_Vel']);
        const V_Vel = parseVal(row['V Vel (mm/s)']||row['V_Vel']);
        const A_Vel = parseVal(row['A Vel (mm/s)']||row['A_Vel']);
        const Acc   = parseVal(row['Acc (g)']     ||row['Acc']);
        const H_Dis = parseVal(row['H Dis (µm)']  ||row['H_Dis']);
        const V_Dis = parseVal(row['V Dis (µm)']  ||row['V_Dis']);
        const A_Dis = parseVal(row['A Dis (µm)']  ||row['A_Dis']);

        // Decoupled Trial from template column
        const decRaw = String(row['Decoupled Trial']||row['Decoupled']||row['Is_Decoupled']||'').trim().toLowerCase();
        const isBulkDecoupled = decRaw === 'yes' || decRaw === 'true' || decRaw === '1';

        // Skip rows with no readings at all
        if (!H_Vel && !V_Vel && !A_Vel && !Acc && !H_Dis && !V_Dis && !A_Dis) {
          skipped.push(`${equip} / ${pt} — no values`);
          return;
        }

        const sevList = [getSev(H_Vel,'vel',equip,isBulkDecoupled), getSev(V_Vel,'vel',equip,isBulkDecoupled), getSev(A_Vel,'vel',equip,isBulkDecoupled),
          getSev(Acc,'acc',equip,isBulkDecoupled), getSev(H_Dis,'dis',equip,isBulkDecoupled), getSev(V_Dis,'dis',equip,isBulkDecoupled), getSev(A_Dis,'dis',equip,isBulkDecoupled)].filter(Boolean);
        const autoSev = worstSev(sevList) || 'NORMAL';
        // Honor user-supplied Severity override (NORMAL/ALARM/ALERT/CRITICAL); otherwise auto-compute
        const sevRaw = String(row['Severity']||row['severity']||'').trim().toUpperCase();
        const severity = ['NORMAL','ALARM','ALERT','CRITICAL'].includes(sevRaw) ? sevRaw : autoSev;

        // Resolve RPM and Frequency from MASTER
        const rpm = String(row['RPM']||row['Rpm']||row['rpm']||'').trim() || String(eqObj?.rpm||'');
        const freq = String(row['Frequency']||row['frequency']||'').trim() || String(eqObj?.frequency||'');

        // Resolve Dept — priority: Excel cell (carry-forwarded) → EQUIP_MAP (deptFromMaster) → eqObj.dept fallback
        // deptFromMaster uses the normalised EQUIP_MAP built from Equipment Master sheet (Column K)
        const masterDeptResolved = deptFromMaster(equip) || ((eqObj && eqObj.dept) ? String(eqObj.dept).trim() : '') || ((eqObj && eqObj.department) ? String(eqObj.department).trim() : '');
        const resolvedDept = dept || masterDeptResolved;

        const _bulkNow = _localNowStr(); // local time for bulk upload timestamps
        const bulkRemarks = isBulkDecoupled ? 'Decoupled Trial' : '';
        newRows.push({ date, equipment: equip, unit: resolvedUnit, area: resolvedArea, point: pt,
          rpm, frequency: freq,
          H_Vel, V_Vel, A_Vel, Acc, H_Dis, V_Dis, A_Dis, severity,
          responsibleDept: resolvedDept,
          username: AUTH.username || AUTH.displayName || insp,
          inspector: insp, recommendations: recs, remarks: bulkRemarks,
          isDecoupled: isBulkDecoupled,
          createdOn: _bulkNow, updatedOn: _bulkNow });
      });

      if (!newRows.length) {
        statusEl.innerHTML = `<div class="alert-box alert-warn">⚠️ No valid readings found.<br>${errors.slice(0,5).join('<br>')}</div>`;
        return;
      }

      // Assign Report IDs per session (date+equipment group), matching normal entry format
      // PERF: precompute existing reportIds per date ONCE instead of re-scanning READINGS
      // for every new session being imported (uploads can contain many sessions/dates).
      const existingIdsByDate = {};
      READINGS.forEach(x => {
        if (!x.date || !x.reportId) return;
        (existingIdsByDate[x.date] = existingIdsByDate[x.date] || new Set()).add(x.reportId);
      });
      const sessionIdMap = {};
      newRows.forEach(r => {
        const key = r.date + '||' + r.equipment;
        if (!sessionIdMap[key]) {
          const dateNum = r.date.replace(/-/g,'');
          const existingIds = existingIdsByDate[r.date] || new Set();
          // Count how many new sessions we've already assigned for this date
          const newSessionsForDate = Object.keys(sessionIdMap).filter(k=>k.startsWith(r.date+'||')).length;
          const seqNum = existingIds.size + newSessionsForDate + 1;
          sessionIdMap[key] = `VBM-${dateNum}-${String(seqNum).padStart(4,'0')}`;
        }
        r.reportId = sessionIdMap[key];
      });

      // Upsert into READINGS
      let added=0, updated=0;
      newRows.forEach(r => {
        const idx2 = READINGS.findIndex(x=>x.date===r.date&&x.equipment===r.equipment&&x.point===r.point);
        if (idx2 >= 0) { READINGS[idx2] = r; updated++; }
        else { READINGS.push(r); added++; }
      });
      saveReadings();

      // ── Create SCHEDULE_LOG entries for each session (date+equipment group) ──
      // Always runs — online AND offline — so bulk uploads always appear in
      // Daily Schedule / Pending Schedule, exactly like a normal entry would.
      const bulkSessions = {};
      newRows.forEach(r => {
        const key = r.date + '||' + r.equipment;
        if (!bulkSessions[key]) {
          bulkSessions[key] = {
            equipment: r.equipment, date: r.date,
            unit: r.unit||'', area: r.area||'',
            inspector: r.inspector||AUTH.displayName||'',
            username: r.username||AUTH.username||'',
            reportId: r.reportId||'',
            createdOn: r.createdOn||_localNowStr()
          };
        }
      });
      // Build compliance log entries and push to local COMPLIANCE_LOG (always)
      Object.values(bulkSessions).forEach(sess => {
        const logId = `${sess.equipment}@${sess.date}@${sess.reportId||Date.now()}`;
        const logEntry = { logId, equipment: sess.equipment, date: sess.date,
          unit: sess.unit, area: sess.area,
          department: deptFromMaster(sess.equipment),
          downloadType: 'Bulk Upload', status: 'Uploaded',
          inspector: sess.inspector, username: sess.username,
          createdOn: sess.createdOn };
        // Push to local COMPLIANCE_LOG immediately so schedule tabs update without reload
        if (!COMPLIANCE_LOG.some(l => l.equipment === sess.equipment && l.date === sess.date)) {
          COMPLIANCE_LOG.push(logEntry);
        } else {
          // Update existing entry (re-upload case)
          const idx3 = COMPLIANCE_LOG.findIndex(l => l.equipment === sess.equipment && l.date === sess.date);
          if (idx3 >= 0) COMPLIANCE_LOG[idx3] = { ...COMPLIANCE_LOG[idx3], ...logEntry };
        }
      });
      // Always persist schedule log to localStorage cache

      // Save to Supabase (online only)
      if (navigator.onLine) {
        const _now = _localNowStr(); // local time for bulk upload log
        const scheduleLogEntries = Object.values(bulkSessions).map(sess => {
          const eqM = equipInfo(sess.equipment) || {};
          const dept = deptFromMaster(sess.equipment) || eqM.dept || eqM.department || '';
          const logId = sess.equipment+'@'+sess.date+'@'+(sess.reportId||Date.now());
          const loggedOn = sess.createdOn || _now;
          return {
            logId, equipment: sess.equipment, date: sess.date, unit: sess.unit||'',
            area: sess.area||'', department: dept, reportId: sess.reportId||'',
            inspector: sess.inspector||AUTH.displayName||'',
            username: sess.username||AUTH.username||'',
            downloadType: 'Bulk Upload', status: 'Uploaded', createdOn: loggedOn,
            Team: AUTH.displayName || AUTH.username || sess.inspector || '',
            Inspector: sess.inspector || AUTH.displayName || ''
          };
        });

        // Bulk insert new rows into Supabase readings table
        const now2 = _localNowStr(); // Store as local IST — displayed as-is, no timezone conversion needed
        const supaNewRows = newRows.map(r => ({
          report_id:        r.reportId       || '',
          date:             r.date,
          username:         r.username       || AUTH.username || '',
          inspector:        r.inspector      || AUTH.displayName || '',
          unit:             r.unit           || '',
          area:             r.area           || '',
          equipment:        r.equipment      || '',
          rpm:              r.rpm            || '',
          frequency:        r.frequency      || '',
          point:            r.point          || '',
          h_vel:            r.H_Vel          || '',
          v_vel:            r.V_Vel          || '',
          a_vel:            r.A_Vel          || '',
          acc:              r.Acc            || '',
          h_dis:            r.H_Dis          || '',
          v_dis:            r.V_Dis          || '',
          a_dis:            r.A_Dis          || '',
          severity:         r.severity       || 'NORMAL',
          recommendations:  r.recommendations|| '',
          remarks:          r.remarks        || '',
          responsible_dept: r.responsibleDept|| '',
          created_on:       now2,
          updated_on:       now2
        }));
        if (supaNewRows.length > 0) {
          const { error: bulkErr } = await _supabase.from('readings').upsert(supaNewRows, { onConflict: 'report_id,point' });
          if (bulkErr) console.warn('Supabase bulk insert error:', bulkErr.message);
        }
        }

      const bulkSessionCount = new Set(newRows.map(r=>r.date+'||'+r.equipment)).size;
      let msg = `<div class="alert-box alert-suc">✅ Upload complete from <strong>${file.name}</strong><br>
        📥 ${added} new readings added · ✏️ ${updated} readings updated · ⏭ ${skipped.length} rows skipped (blank values)<br>
        📅 Schedule log updated for ${bulkSessionCount} session(s)</div>`;
      if (errors.length) msg += `<div class="alert-box alert-warn" style="margin-top:6px">⚠️ ${errors.length} error(s):<br>${errors.slice(0,5).join('<br>')}${errors.length>5?`<br>...and ${errors.length-5} more`:''}</div>`;
      statusEl.innerHTML = msg;
      renderHistory && renderHistory();
    } catch(err) {
      statusEl.innerHTML = `<div class="alert-box alert-warn">⚠️ Error: ${err.message}</div>`;
    }
    input.value = '';
  };
  reader.readAsArrayBuffer(file);
}
