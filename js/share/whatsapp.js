/* VibeMon — WhatsApp open helpers + session/summary messages + modal */

// ======= WHATSAPP (webview_flutter compatible) =======
// webview_flutter blocks window.open() for ALL external URLs.
// Fix: use whatsapp:// scheme via hidden <a> click — Android's shouldOverrideUrlLoading
// handles non-http schemes by firing a system Intent, opening WhatsApp natively.

function _waCopy(text){
  return new Promise(function(resolve){
    try{
      if(navigator.clipboard && window.isSecureContext){
        navigator.clipboard.writeText(text).then(function(){resolve(true);}).catch(function(){resolve(_waCopyFallback(text));});
        return;
      }
    }catch(e){}
    resolve(_waCopyFallback(text));
  });
}
function _waCopyFallback(text){
  try{
    var t=document.createElement('textarea');
    t.value=text;
    t.setAttribute('readonly','');
    t.style.cssText='position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(t);
    t.focus(); t.select();
    try{ t.setSelectionRange(0,text.length); }catch(e){}
    var ok=false; try{ ok=document.execCommand('copy'); }catch(e){ ok=false; }
    document.body.removeChild(t);
    return ok;
  }catch(e){ return false; }
}
function _waToast(text){
  var ex=document.getElementById('_wa_toast'); if(ex)ex.remove();
  var d=document.createElement('div'); d.id='_wa_toast';
  d.textContent=text;
  d.style.cssText='position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:#075E54;color:#fff;padding:12px 18px;border-radius:10px;font-size:13px;font-weight:600;z-index:100001;box-shadow:0 6px 20px rgba(0,0,0,.3);max-width:90%;text-align:center;line-height:1.5';
  document.body.appendChild(d);
  setTimeout(function(){ try{d.remove();}catch(e){} },4500);
}
// Open WhatsApp — works on desktop, mobile browser, and html2app Flutter WebView.
function _waOpen(waUrl){
  // html2app WebView: InAppBrowser opens link in system browser so WA deep-links work
  if (window._h2a_InAppBrowser) { window._h2a_InAppBrowser.openUrl(waUrl); return; }
  // Normal browser
  try { var w = window.open(waUrl, '_blank'); if (w) return; } catch(e){}
  _waShowFallbackLink(waUrl);
}

function _waShowFallbackLink(url){
  var ex=document.getElementById('_wa_fallback_dlg'); if(ex)ex.remove();
  var d=document.createElement('div'); d.id='_wa_fallback_dlg';
  d.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100002;display:flex;align-items:center;justify-content:center;padding:16px';
  d.innerHTML='<div style="background:#fff;border-radius:14px;padding:22px 20px;max-width:340px;width:100%;text-align:center;font-family:-apple-system,sans-serif">'
    +'<div style="font-size:28px;margin-bottom:8px">📲</div>'
    +'<div style="font-size:14px;font-weight:700;margin-bottom:8px;color:#075E54">Open WhatsApp</div>'
    +'<div style="font-size:12px;color:#555;margin-bottom:16px;line-height:1.5">Tap the button below to open WhatsApp with the message pre-filled.</div>'
    +'<a href="'+url+'" target="_blank" rel="noopener" style="display:block;background:#25D366;color:#fff;padding:12px;border-radius:10px;font-size:14px;font-weight:700;text-decoration:none;margin-bottom:10px">Open WhatsApp</a>'
    +'<button onclick="document.getElementById(\'_wa_fallback_dlg\').remove()" style="background:none;border:1px solid #e2e4e8;border-radius:10px;padding:10px 20px;font-size:13px;cursor:pointer;color:#666">Close</button>'
    +'</div>';
  document.body.appendChild(d);
}
// Backwards-compatible wrapper
function mobileOpenWhatsApp(url){ _waOpen(url); }

// ======= WHATSAPP INTEGRATION =======

let _waPendingMsg = '';

function buildSessionWAMessage(date, equipment, reportId) {
  // Filter by reportId if available, else fall back to date+equipment
  let rows = reportId
    ? READINGS.filter(r => r.reportId === reportId)
    : READINGS.filter(r => r.date === date && r.equipment === equipment);
  if (!rows.length) return null;
  const eqObj = MASTER.find(e => e.name === equipment) || { unit: '', area: '' };
  const os = worstSev(rows.map(r => r.severity));
  const allRecs = [...new Set(rows.map(r => r.recommendations || '').filter(Boolean).join('|').split('|').map(s => s.trim()).filter(Boolean))];
  const inspector = rows[0].inspector || '—';

  function fmtV(v) {
    if (v === '' || v === undefined || v === null) return '—';
    const n = parseFloat(v);
    return isNaN(n) ? '—' : n.toFixed(1);
  }
  function fmtA(v) {
    if (v === '' || v === undefined || v === null) return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : n.toFixed(2);
  }

  const hasHVel = rows.some(r => r.H_Vel !== '' && r.H_Vel !== undefined);
  const hasVVel = rows.some(r => r.V_Vel !== '' && r.V_Vel !== undefined);
  const hasAVel = rows.some(r => r.A_Vel !== '' && r.A_Vel !== undefined);
  const hasAcc  = rows.some(r => r.Acc   !== '' && r.Acc   !== undefined);
  const hasHDis = rows.some(r => r.H_Dis !== '' && r.H_Dis !== undefined);
  const hasVDis = rows.some(r => r.V_Dis !== '' && r.V_Dis !== undefined);
  const hasADis = rows.some(r => r.A_Dis !== '' && r.A_Dis !== undefined);

  const osLabel = { NORMAL: 'NORMAL', ALARM: 'ALARM', ALERT: 'ALERT', CRITICAL: 'CRITICAL' };
  const divider = '--------------------------------';

  // Format date & time
  const dateObj = rows[0].createdOn ? new Date(rows[0].createdOn) : (date ? new Date(date) : new Date());
  const dateStr = dateObj.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
  const timeStr = dateObj.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', hour12:true }).toUpperCase();

  // Pad helper for column alignment
  function pad(str, len) { str = String(str); return str + ' '.repeat(Math.max(0, len - str.length)); }

  // Build param columns list
  const paramCols = [];
  if (hasHVel) paramCols.push('H.Vel');
  if (hasVVel) paramCols.push('V.Vel');
  if (hasAVel) paramCols.push('A.Vel');
  if (hasAcc)  paramCols.push('Acc');
  if (hasHDis) paramCols.push('H.Dis');
  if (hasVDis) paramCols.push('V.Dis');
  if (hasADis) paramCols.push('A.Dis');

  // Find longest point name for alignment
  const maxPtLen = Math.max(10, ...rows.map(r => (r.point || '').length)) + 2;
  const colW = 7;

  // Build header
  let msg = `*VIBRATION MONITORING REPORT*\n`;
  msg += `${divider}\n`;
  msg += `Equipment  : ${equipment}\n`;
  if (eqObj.unit || eqObj.area) msg += `Unit/Area  : ${[eqObj.unit, eqObj.area].filter(Boolean).join(' / ')}\n`;
  msg += `Date & Time: ${dateStr} | ${timeStr}\n`;
  msg += `Inspector  : ${inspector}\n`;
  msg += `Status     : ${osLabel[os] || os}\n`;
  msg += `${divider}\n`;

  // Table header
  if (paramCols.length) {
    msg += `${pad('Point', maxPtLen)}${paramCols.map(c => pad(c, colW)).join('')}\n`;

    // Each measurement point row — sorted by Equipment Master route sequence
    sortRowsByMasterPoints(rows, equipment).forEach(r => {
      const vals = [];
      if (hasHVel) vals.push(pad(fmtV(r.H_Vel), colW));
      if (hasVVel) vals.push(pad(fmtV(r.V_Vel), colW));
      if (hasAVel) vals.push(pad(fmtV(r.A_Vel), colW));
      if (hasAcc)  { const a = fmtA(r.Acc); vals.push(pad(a !== null ? a : '—', colW)); }
      if (hasHDis) vals.push(pad(fmtV(r.H_Dis), colW));
      if (hasVDis) vals.push(pad(fmtV(r.V_Dis), colW));
      if (hasADis) vals.push(pad(fmtV(r.A_Dis), colW));
      msg += `${pad(r.point || '—', maxPtLen)}${vals.join('')}\n`;
    });
  }

  msg += `${divider}\n`;

  if (allRecs.length) {
    msg += `Recommendations:\n`;
    allRecs.forEach((rec, i) => { msg += `${i + 1}. ${rec}\n`; });
  }

  if (rows[0] && rows[0].remarks) {
    msg += `Remarks: ${rows[0].remarks}\n`;
  }

  msg += `${divider}`;
  return msg;
}

function buildSummaryWAMessage(source) {
  let rows = READINGS;
  let unit = '', area = '', from = '', to = '';

  if (source === 'dashboard') {
    unit = document.getElementById('d-unit').value;
    area = document.getElementById('d-area').value;
    from = document.getElementById('d-from').value;
    to   = document.getElementById('d-to').value;
    const sev = document.getElementById('d-sev').value;
    rows = rows.filter(r =>
      (!unit || r.unit === unit) &&
      (!area || r.area === area) &&
      (!from || r.date >= from) &&
      (!to   || r.date <= to)   &&
      (!sev  || r.severity === sev)
    );
  } else {
    unit = document.getElementById('h-unit').value;
    area = document.getElementById('h-area').value;
    from = document.getElementById('h-from').value;
    to   = document.getElementById('h-to').value;
    const hSev = document.getElementById('h-sev').value;
    const hUser = document.getElementById('h-user')?.value||'';
    rows = rows.filter(r =>
      (!unit || r.unit === unit) &&
      (!area || r.area === area) &&
      (!from || r.date >= from) &&
      (!to   || r.date <= to)   &&
      (!hSev || r.severity === hSev) &&
      (!hUser || r.username === hUser || r.inspector === hUser)
    );
  }

  if (!rows.length) return 'VIBRATION SUMMARY REPORT\n\nNo readings found for selected filters.';

  const sevByEquip = {};
  rows.forEach(r => {
    const rank = { NORMAL: 1, ALARM: 2, ALERT: 3, CRITICAL: 4 };
    if (!sevByEquip[r.equipment] || (rank[r.severity] || 0) > (rank[sevByEquip[r.equipment]] || 0))
      sevByEquip[r.equipment] = r.severity;
  });

  const total   = Object.keys(sevByEquip).length;
  const normals = Object.values(sevByEquip).filter(s => s === 'NORMAL').length;
  const alarms  = Object.values(sevByEquip).filter(s => s === 'ALARM').length;
  const alerts  = Object.values(sevByEquip).filter(s => s === 'ALERT').length;
  const crits   = Object.values(sevByEquip).filter(s => s === 'CRITICAL').length;

  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '';
  const dateLabel = from && to ? `${fmtDate(from)} to ${fmtDate(to)}` : from ? `From ${fmtDate(from)}` : to ? `Up to ${fmtDate(to)}` : 'All Dates';
  const divider = '--------------------------------';
  const nowStr = new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) + ' | ' +
                 new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',hour12:true}).toUpperCase();

  let msg = `*VIBRATION SUMMARY REPORT*\n`;
  msg += `${divider}\n`;
  msg += `Period     : ${dateLabel}\n`;
  if (unit) msg += `Unit       : ${unit}\n`;
  if (area) msg += `Area       : ${area}\n`;
  msg += `${divider}\n`;
  msg += `Total Equipment : ${total}\n`;
  msg += `Normal          : ${normals}\n`;
  msg += `Alarm           : ${alarms}\n`;
  msg += `Alert           : ${alerts}\n`;
  msg += `Critical        : ${crits}\n`;
  msg += `${divider}\n`;

  // List critical and alert first
  const critAlerts = Object.entries(sevByEquip)
    .filter(([, s]) => s === 'CRITICAL' || s === 'ALERT' || s === 'ALARM')
    .sort((a, b) => { const r = { CRITICAL: 3, ALERT: 2, ALARM: 1 }; return (r[b[1]] || 0) - (r[a[1]] || 0); })
    .slice(0, 10);

  if (critAlerts.length) {
    msg += `Attention Required:\n`;
    critAlerts.forEach(([eq, sev]) => {
      const eqObj = MASTER.find(e => e.name === eq) || { unit: '', area: '' };
      const loc = [eqObj.unit, eqObj.area].filter(Boolean).join(' / ');
      msg += `${eq}${loc ? ' (' + loc + ')' : ''} — ${sev}\n`;
    });
    msg += `${divider}\n`;
  }

  msg += `${divider}`;
  return msg;
}

function openWASessionModal(date, equipment, reportId) {
  const msg = buildSessionWAMessage(date, equipment, reportId || '');
  if (!msg) { alert('No readings found for this session.'); return; }
  _waPendingMsg = msg;
  document.getElementById('wa-msg-preview').textContent = msg;
  document.getElementById('wa-phone').value = (window._waLastPhone||'') || '';
  document.getElementById('wa-modal').classList.add('open');
}

function openWASummaryModal(source) {
  const msg = buildSummaryWAMessage(source);
  _waPendingMsg = msg;
  document.getElementById('wa-msg-preview').textContent = msg;
  document.getElementById('wa-phone').value = (window._waLastPhone||'') || '';
  document.getElementById('wa-modal').classList.add('open');
}

function closeWAModal() {
  document.getElementById('wa-modal').classList.remove('open');
}

function sendWANow() {
  const phone = document.getElementById('wa-phone').value.trim().replace(/[^0-9]/g, '');
  if (!phone || phone.length < 7) { alert('Please enter a valid WhatsApp number with country code (e.g. 919876543210)'); return; }
  window._waLastPhone = phone;
  const msg = _waPendingMsg || '';
  const url = 'https://wa.me/' + phone + '?text=' + encodeURIComponent(msg);
  _waCopy(msg).then(function(copied){
    closeWAModal();
    _waOpen(url);
    _waToast(copied ? '\u2705 Message copied & WhatsApp opening\u2026' : 'Opening WhatsApp\u2026');
  });
}

function sendWAGroup() {
  // Group chats can't be deep-linked; copy the message then open WhatsApp's share picker.
  const msg = _waPendingMsg || '';
  const url = 'https://wa.me/?text=' + encodeURIComponent(msg);
  _waCopy(msg).then(function(copied){
    closeWAModal();
    _waOpen(url);
    _waToast(copied
      ? '\u2705 Copied! Pick your group \u2192 the message is pre-filled (or long-press \u2192 Paste).'
      : 'Opening WhatsApp \u2192 pick your group.');
  });
}

function _fallbackCopyGroup() { sendWAGroup(); }

// Close WA modal on background click
document.getElementById('wa-modal').addEventListener('click', function(e) {
  if (e.target === this) closeWAModal();
});
