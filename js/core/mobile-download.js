/* VibeMon — mobile-safe file downloads (xlsx/pdf) for Android WebView */

// ======= MOBILE-SAFE FILE DOWNLOAD =======
// Replaces XLSX.writeFile which fails in Android WebView
// ======= EXCEL DOWNLOAD (webview_flutter compatible) =======
// webview_flutter blocks: blob: URLs, window.open(), <a download> clicks on blob/data URIs
// Works: window.location.href = data: URI (triggers Android DownloadManager)
// Fallback: In-app CSV copy modal (always works)

function mobileWriteFile(wb, filename) {
  // Attempt 1: hidden <a download> with data: URI — Chrome Android / WebView DownloadManager.
  // This avoids navigating the WebView away from the app.
  try {
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
    const dataUri = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + wbout;
    const a = document.createElement('a');
    a.href = dataUri;
    a.download = filename;
    a.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
    document.body.appendChild(a);
    a.click();
    setTimeout(function() { try { document.body.removeChild(a); } catch(e){} }, 1500);
    return;
  } catch(e1) {}

  // Attempt 2: window.location.href with data: URI (Android DownloadManager fallback)
  try {
    const wbout2 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
    const dataUri2 = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + wbout2;
    window.location.href = dataUri2;
    return;
  } catch(e2) {}

  // Final fallback: show in-app CSV copy modal
  _showDownloadModal(wb, filename);
}

function _showDownloadModal(wb, filename) {
  // Generate CSV from all sheets combined
  let csv = '';
  try {
    wb.SheetNames.forEach(sname => {
      csv += '--- ' + sname + ' ---\n';
      csv += XLSX.utils.sheet_to_csv(wb.Sheets[sname]) + '\n\n';
    });
  } catch(e) { csv = 'Error generating data'; }

  // Remove existing modal if any
  const existing = document.getElementById('_dl_modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = '_dl_modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:99999;display:flex;align-items:flex-end;justify-content:center;padding:0';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px 16px 0 0;padding:20px 16px 32px;width:100%;max-width:520px;max-height:88vh;display:flex;flex-direction:column;gap:10px;box-shadow:0 -4px 24px rgba(0,0,0,.2)">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div style="font-weight:700;font-size:15px;color:#1a1d23">📊 ${filename.replace('.xlsx','')}</div>
        <button onclick="document.getElementById('_dl_modal').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7280;line-height:1">×</button>
      </div>
      <div style="font-size:12px;color:#6b7280;line-height:1.5">Download not available in this WebView.<br>Tap <strong>Copy CSV</strong> → open Excel / Google Sheets → paste.</div>
      <textarea id="_dl_csv" readonly style="flex:1;min-height:180px;font-size:10px;font-family:monospace;border:1px solid #e2e4e8;border-radius:8px;padding:8px;resize:none;color:#1a1d23;background:#f8fafc">${csv.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</textarea>
      <div style="display:flex;gap:8px">
        <button id="_dl_copy_btn" onclick="
          var ta=document.getElementById('_dl_csv');
          ta.select();
          if(navigator.clipboard){
            navigator.clipboard.writeText(ta.value).then(function(){
              document.getElementById('_dl_copy_btn').textContent='✅ Copied!';
            }).catch(function(){
              document.execCommand('copy');
              document.getElementById('_dl_copy_btn').textContent='✅ Copied!';
            });
          } else {
            document.execCommand('copy');
            document.getElementById('_dl_copy_btn').textContent='✅ Copied!';
          }
        " style="flex:1;padding:12px;background:#1D4E8A;color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer">📋 Copy CSV Data</button>
        <button onclick="document.getElementById('_dl_modal').remove()" style="padding:12px 18px;background:#f4f5f7;border:1px solid #e2e4e8;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;color:#1a1d23">Close</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  // Auto-select text for easy copy
  setTimeout(() => { try { document.getElementById('_dl_csv').select(); } catch(e){} }, 200);
}

async function _downloadExcelBuffer(buf, filename){
  const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  // html2app Flutter WebView: use Web Share API (Android native share sheet)
  if (window._h2a_isApp && navigator.canShare) {
    try {
      const file = new File([buf], filename, { type: MIME });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return;
      }
    } catch(e) {
      if (e && e.name === 'AbortError') return; // user cancelled
    }
  }

  // PC / mobile browser — Attempt 1: blob URL <a download> (best for desktop Chrome/Firefox/Edge)
  try {
    const blob = new Blob([buf], { type: MIME });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    a.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
    document.body.appendChild(a); a.click();
    setTimeout(function(){ try { document.body.removeChild(a); } catch(e){} URL.revokeObjectURL(url); }, 1500);
    return;
  } catch(e) {}

  // Attempt 2: data URI <a download> (Android Chrome / Samsung browser)
  try {
    const bytes = new Uint8Array(buf);
    let bin = ''; const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk)
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    const dataUri = 'data:' + MIME + ';base64,' + btoa(bin);
    const a = document.createElement('a');
    a.href = dataUri; a.download = filename;
    a.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
    document.body.appendChild(a); a.click();
    setTimeout(function(){ try { document.body.removeChild(a); } catch(e2){} }, 1500);
    return;
  } catch(e) {}

  alert('Download failed. Please try in Chrome or Firefox on PC.');
}

// ── Mobile-safe PDF download ─────────────────────────────────────────────────
async function _downloadPDF(doc, filename) {
  const PDF_MIME = 'application/pdf';

  // html2app Flutter WebView: use Web Share API
  if (window._h2a_isApp && navigator.canShare) {
    try {
      const ab = doc.output('arraybuffer');
      const file = new File([ab], filename, { type: PDF_MIME });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return;
      }
    } catch(e) {
      if (e && e.name === 'AbortError') return;
    }
  }

  // PC / mobile browser — Attempt 1: blob URL <a download> (best for desktop)
  try {
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    a.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
    document.body.appendChild(a); a.click();
    setTimeout(function(){ try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch(e){} }, 1500);
    return;
  } catch(e1) {}

  // Attempt 2: data URI <a download>
  try {
    const dataUri = doc.output('datauristring');
    const a = document.createElement('a');
    a.href = dataUri; a.download = filename;
    a.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
    document.body.appendChild(a); a.click();
    setTimeout(function(){ try { document.body.removeChild(a); } catch(e2){} }, 1500);
    return;
  } catch(e2) {}

  // Attempt 3: open blob in new tab (iOS Safari)
  try { window.open(doc.output('bloburl'), '_blank'); return; } catch(e3) {}

  alert('PDF download failed. Please try in Chrome or Firefox on PC.');
}
