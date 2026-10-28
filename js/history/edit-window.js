/* VibeMon — who may edit / delete a session in History.
   Admin: always. Field engineer (each login, incl. CB): only the readings entered through their OWN login, until 08:00 the next morning
   (after that the readings are uploaded to the office SQL server, where changes are not allowed).
   Viewer: never. This only guides the screens — the database itself does not check it (see private/SECURITY_REVIEW.md). */

const EDIT_CUTOFF_HOUR = 8;   // readings of day D can be changed until D+1, 08:00 (device clock)

function editWindowEnd(dateStr) {
  const p = String(dateStr || '').slice(0, 10).split('-').map(Number);
  if (p.length !== 3 || p.some(isNaN)) return null;
  return new Date(p[0], p[1] - 1, p[2] + 1, EDIT_CUTOFF_HOUR, 0, 0);
}

function isSessionOwner(rows) {
  const r = (rows && rows[0]) || {};
  const me = String(AUTH.username || '').toLowerCase();
  return (!!r.username && String(r.username).toLowerCase() === me) || (!!r.inspector && r.inspector === AUTH.displayName);
}

function editWindowOpen(rows) {
  const end = editWindowEnd(rows && rows[0] && rows[0].date);
  return !!end && Date.now() < end.getTime();
}

// rows = the point rows of one session
function canEditSession(rows) {
  if (!rows || !rows.length || typeof AUTH === 'undefined') return false;
  if (AUTH.role === 'admin') return true;
  return AUTH.role === 'editor' && isSessionOwner(rows) && editWindowOpen(rows);
}

// "open until 29-10 08:00" for the owner's own sessions (blank for admin / other people's sessions)
function editWindowNote(rows) {
  if (typeof AUTH === 'undefined' || AUTH.role !== 'editor' || !isSessionOwner(rows) || !editWindowOpen(rows)) return '';
  const e = editWindowEnd(rows[0].date), p = n => String(n).padStart(2, '0');
  return p(e.getDate()) + '-' + p(e.getMonth() + 1) + ' ' + p(e.getHours()) + ':00';
}

// why a session cannot be changed — for the toast
function editDeniedText(rows) {
  if (AUTH.role === 'editor' && rows && rows.length && isSessionOwner(rows) && !editWindowOpen(rows))
    return 'These readings were locked at ' + EDIT_CUTOFF_HOUR + ':00 AM the next morning (they go to the office SQL server). Ask the Admin if a change is really needed.';
  return 'You can only change your own readings.';
}

function rowsOfSessionKey(key) {
  return READINGS.filter(r => (r.reportId ? r.reportId : (r.date + '||' + r.equipment)) === key);
}
