/* VibeMon — "Not running / Standby" marks (supabase/not_running.sql).
   A mark says: the operator reached the machine on this date and it was not running — so the visit is COMPLETE, and the catch-up
   engine may plan up to 2 re-checks. A mark is never a vibration reading (it is not in READINGS). */

let STATUS_LOG = [];
const NR_LABELS = { NOT_RUNNING: 'Not running', STANDBY: 'Standby', MAINTENANCE: 'Under maintenance / isolated', NOT_ACCESSIBLE: 'Not accessible' };
function nrLabel(status) { return NR_LABELS[status] || 'Not running'; }

function nrMapRow(r) {
  return { reportId: r.report_id || '', equipment: r.equipment || '', date: String(r.date || '').slice(0, 10), status: r.status || 'NOT_RUNNING',
    remarks: r.remarks || '', username: r.username || '', inspector: r.inspector || '', unit: r.unit || '', area: r.area || '', createdOn: r.created_on || '' };
}

async function fetchStatusLog() {
  try {
    const rows = []; const PAGE = 1000; let from = 0;
    while (true) {
      const { data, error } = await _supabase.from('equipment_status_log').select('*').order('date', { ascending: false }).range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || !data.length) break;
      rows.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }
    // keep marks saved on this phone this session that the server has not echoed back yet
    const have = new Set(rows.map(r => r.report_id));
    const local = STATUS_LOG.filter(x => x._local && !have.has(x.reportId));
    STATUS_LOG = rows.map(nrMapRow).concat(local);
    _nrMemo = null;
    return true;
  } catch (e) {
    console.warn('fetchStatusLog failed (has supabase/not_running.sql been run?):', e.message);   // keep whatever we already have
    return false;
  }
}

// normalized equipment name -> marks, oldest first: [{date, team, insp, status, remarks, createdOn}]
let _nrMemo = null;
function nrIndex() {
  const key = STATUS_LOG.length + '|' + (STATUS_LOG.length ? STATUS_LOG[0].createdOn + STATUS_LOG[STATUS_LOG.length - 1].createdOn : '');
  if (_nrMemo && _nrMemo.key === key) return _nrMemo.map;
  const map = {};
  STATUS_LOG.forEach(x => {
    if (!x.equipment || !x.date) return;
    const k = normalizeEquipName(x.equipment);
    (map[k] = map[k] || []).push({ date: x.date, team: (typeof dsReaderTeam === 'function' ? dsReaderTeam(x) : ''), insp: x.inspector || x.username || '', status: x.status, remarks: x.remarks, createdOn: x.createdOn, reportId: x.reportId });
  });
  Object.keys(map).forEach(k => map[k].sort((a, b) => (a.date + a.createdOn).localeCompare(b.date + b.createdOn)));
  _nrMemo = { key, map };
  return map;
}
function nrMarksByKey(k) { return nrIndex()[k] || []; }
function nrMarks(equip) { return nrMarksByKey(normalizeEquipName(equip)); }

// add a mark saved on this phone right away (the server copy replaces it on the next load)
function nrAdd(x) { STATUS_LOG.push(x); _nrMemo = null; }
