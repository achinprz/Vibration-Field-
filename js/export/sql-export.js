/* VibeMon — SQL/ALL_READINGS export helpers (date range, headers, row builder) */

function initSQLAutoDownload() { /* removed */ }


// ── SQL Import dropdown toggle ──────────────────────────────────────────────
function toggleSqlImportMenu() { /* removed */ }

// Close menu when clicking anywhere else
document.addEventListener('click', function() {
  if (menu) menu.style.display = 'none';
});

// ── Utility: today's date as YYYY-MM-DD ────────────────────────────────────
function _todayFmt() {
  const d = new Date();
  const p = n => String(n).padStart(2,'0');
  return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate());
}

// ── SQL custom range state ──────────────────────────────────────────────────
window._sqlCustomFrom = null; // 'YYYY-MM-DD' or null
window._sqlCustomTo   = null; // 'YYYY-MM-DD' or null

// ── Auto date-range logic ───────────────────────────────────────────────────
// Monday → Saturday + Sunday + Monday (all three days, no skipping)
// Any other day → yesterday + today
// ALL days included — no day is ever skipped (Sunday is a working day at NTPC)
function _getSQLAutoDateRange() {
  const fmtDate = d => {
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate());
  };
  const today = new Date();
  today.setHours(0,0,0,0);
  const dow = today.getDay(); // 0=Sun,1=Mon,...,6=Sat

  let datesToInclude = [];

  if (dow === 1) {
    // Monday: include Saturday + Sunday + Monday
    const sat = new Date(today); sat.setDate(today.getDate() - 2);
    const sun = new Date(today); sun.setDate(today.getDate() - 1);
    datesToInclude = [fmtDate(sat), fmtDate(sun), fmtDate(today)];
  } else {
    // Any other day: yesterday + today
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    datesToInclude = [fmtDate(yesterday), fmtDate(today)];
  }

  const rangeLabel = datesToInclude[0] + ' to ' + datesToInclude[datesToInclude.length - 1];
  return { datesToInclude, rangeLabel, isAuto: true };
}

// ── Main date-range resolver (auto or custom) ───────────────────────────────
function _getSQLDateRange() {
  // If custom range is set, use it
  if (window._sqlCustomFrom && window._sqlCustomTo) {
    const fmtDate = d => {
      const p = n => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate());
    };
    // Build list of every date from _sqlCustomFrom to _sqlCustomTo inclusive
    const datesToInclude = [];
    const cursor = new Date(window._sqlCustomFrom + 'T00:00:00');
    const end    = new Date(window._sqlCustomTo   + 'T00:00:00');
    while (cursor <= end) {
      datesToInclude.push(fmtDate(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    const rangeLabel = window._sqlCustomFrom + ' to ' + window._sqlCustomTo;
    return { datesToInclude, rangeLabel, isAuto: false };
  }
  return _getSQLAutoDateRange();
}

// ── Shared helper: get filtered readings using date range ───────────────────
function _getSQLFilteredReadings() {
  const { datesToInclude } = _getSQLDateRange();
  return READINGS.filter(r => r && r.date && datesToInclude.includes(r.date.slice(0,10)));
}

// ── Custom range UI helpers ─────────────────────────────────────────────────






// Initialise range label when menu opens
function toggleSqlImportMenu_init() {
  const { rangeLabel, isAuto } = _getSQLDateRange();
  const lbl   = document.getElementById('sql-range-label-display');
  const badge = document.getElementById('sql-custom-badge');
  if (isAuto) {
    lbl.textContent = 'Auto: ' + rangeLabel;
    badge.style.display = 'none';
  } else {
    lbl.textContent = rangeLabel;
    badge.style.display = 'inline-block';
  }
}

// ── ALL_READINGS column headers (matches Google Sheet) ─────────────────────
const SQL_EXPORT_HEADERS = [
  'Report_ID','Date','Username','Inspector','Unit','Area','Equipment',
  'RPM','Frequency','Point','H Vel','V Vel','A Vel','Acc',
  'H Dis','V Dis','A Dis','Severity','Recommendation','Remarks',
  'Created_On','Updated_On','Responsible_Dept','Decoupled'
];

function _buildSQLRow(r) {
  return [
    r.reportId || '',
    r.date || '',
    r.username || '',
    r.inspector || '',
    r.unit || '',
    r.area || '',
    r.equipment || '',
    r.rpm || '',
    r.frequency || '',
    r.point || '',
    r.H_Vel !== undefined ? r.H_Vel : '',
    r.V_Vel !== undefined ? r.V_Vel : '',
    r.A_Vel !== undefined ? r.A_Vel : '',
    r.Acc   !== undefined ? r.Acc   : '',
    r.H_Dis !== undefined ? r.H_Dis : '',
    r.V_Dis !== undefined ? r.V_Dis : '',
    r.A_Dis !== undefined ? r.A_Dis : '',
    r.severity || '',
    r.recommendations || r.recommendation || '',
    r.remarks || '',
    r.createdOn || r.created_on || r.date || '',
    r.updatedOn || r.updated_on || r.date || '',
    r.responsibleDept || '',
    r.isDecoupled ? 'Yes' : 'No'
  ];
}
