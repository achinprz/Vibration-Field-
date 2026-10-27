/* VibeMon — "Not running / Standby" outcome (entry step 2 button).
   The operator reached the machine but it is stopped / on standby / isolated / not accessible. Saving the mark COMPLETES the visit
   (it no longer shows as pending) and the catch-up engine plans up to 2 re-checks to take a real reading later (dynamic-recovery.js).
   A mark is not a vibration reading — it is stored apart (supabase/not_running.sql) and saved through the same offline queue. */

const NR_REASONS = [
  { code: 'NOT_RUNNING',    label: 'Not running (stopped)',        hint: 'Machine is switched off / tripped' },
  { code: 'STANDBY',        label: 'Standby',                      hint: 'Healthy standby unit, not in service' },
  { code: 'MAINTENANCE',    label: 'Under maintenance / isolated', hint: 'Overhaul, work permit or isolation' },
  { code: 'NOT_ACCESSIBLE', label: 'Not accessible',               hint: 'Cannot be reached safely' }
];

function nrOpenDialog() {
  if (typeof fxLive === 'function' && !fxLive()) return;   // starts on FEATURES_FROM
  if (typeof entryEquip === 'undefined' || !entryEquip) { showToast('Pick an equipment first.', 'blue'); return; }
  if (AUTH.role === 'viewer') { alert('Viewers cannot save entries. Please login as Editor or Admin.'); return; }
  let m = document.getElementById('nr-modal');
  if (!m) {
    m = document.createElement('div'); m.id = 'nr-modal'; m.className = 'nr-modal-bg';
    m.addEventListener('click', e => { if (e.target === m) nrCloseDialog(); });
    document.body.appendChild(m);
  }
  m.innerHTML = `<div class="nr-modal" role="dialog" aria-label="Mark as not running">
    <div class="nr-head"><span>🚫 Not running / Standby</span><button class="nr-x" onclick="nrCloseDialog()" aria-label="Close">&#215;</button></div>
    <div class="nr-body">
      <div class="nr-eq">${escHtml(entryEquip.name)} <small>${escHtml(entryEquip.unit || '')} · ${escHtml(entryEquip.area || '')}</small></div>
      <div class="nr-reasons">${NR_REASONS.map((r, i) => `<label class="nr-reason"><input type="radio" name="nr-reason" value="${r.code}"${i === 0 ? ' checked' : ''}><span><b>${escHtml(r.label)}</b><small>${escHtml(r.hint)}</small></span></label>`).join('')}</div>
      <textarea id="nr-remarks" placeholder="Remarks (optional) — e.g. unit 2B on standby, 2A running"></textarea>
      <div class="nr-note">✅ This visit will show as <b>complete</b>. The app will plan up to <b>2 re-checks</b> to catch the machine while it is running — if it is still not running after that, no more catch-ups are planned.</div>
    </div>
    <div class="nr-foot"><button class="btn" onclick="nrCloseDialog()">Cancel</button><button class="btn btn-primary" id="nr-save-btn" onclick="nrSave()">Save — mark as complete</button></div>
  </div>`;
  m.classList.add('open');
}
function nrCloseDialog() { const m = document.getElementById('nr-modal'); if (m) m.classList.remove('open'); }

async function nrSave() {
  const e = entryEquip; if (!e) return;
  const btn = document.getElementById('nr-save-btn');
  const reason = (document.querySelector('input[name="nr-reason"]:checked') || {}).value || 'NOT_RUNNING';
  const remarks = (document.getElementById('nr-remarks').value || '').trim();
  let date = (document.getElementById('entry-date') || {}).value || _todayFmt();
  if (AUTH.role !== 'admin' && date !== _todayFmt()) date = _todayFmt();   // field engineers: today only, like readings
  // a real reading already exists for today: the mark is probably a mistake
  try {
    const dups = (typeof egDuplicates === 'function') ? await egDuplicates(e.name, date) : [];
    if (dups.length && !confirm(`${e.name} already has a reading for ${date}: ${dups.join('; ')}\n\nMark it as not running anyway?`)) return;
  } catch (err) {}
  const t = new Date(), p2 = n => String(n).padStart(2, '0');
  const reportId = `NR-${date.replace(/-/g, '')}-${p2(t.getHours())}${p2(t.getMinutes())}${p2(t.getSeconds())}-${Math.floor(Math.random() * 9000) + 1000}`;
  const inspector = (document.getElementById('inspector-name') || {}).value || AUTH.displayName || 'Unknown';
  const payload = { kind: 'status', reportId, date, equipment: e.name, unit: e.unit || '', area: e.area || '', username: AUTH.username, inspector, status: reason, remarks };
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Saving…'; }
  const where = await OfflineQ.handleSaveStatus(payload);
  if (btn) { btn.disabled = false; btn.textContent = 'Save — mark as complete'; }
  if (where === 'none') { alert('⚠️ NOT SAVED — this phone could not store the mark. Please try again.'); return; }
  nrAdd({ reportId, equipment: e.name, date, status: reason, remarks, username: AUTH.username, inspector, unit: e.unit, area: e.area, createdOn: payload.createdLocal || _localNowStr(), _local: true });
  nrCloseDialog();
  showToast(where === 'server' ? `🚫 ${e.name}: marked ${nrLabel(reason).toLowerCase()} — visit complete.` : `🚫 ${e.name}: kept on this phone — uploads when the signal is back. Visit shown as complete.`, 'green');
  entryEquip = null; entryReadings = {}; entryRecs = []; window._aiAcceptedForSession = false;
  if (typeof _entrySourceTab !== 'undefined' && _entrySourceTab && typeof returnToSourceTab === 'function') { try { returnToSourceTab(); } catch (err) { goStep(1); } }
  else goStep(1);
}
