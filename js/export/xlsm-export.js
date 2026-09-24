/* VibeMon — build .xlsm from template + readings */

// ── Download as Excel (.xlsx) — ALL_READINGS format ────────────────────────

function _vibeMonTemplateBytes(){
  const bin = atob(VIBEMON_XLSM_TEMPLATE_B64);
  const u8 = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
function _xmlEsc(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
}
function _colRef(i){ // 0-based -> A, B, ... AA
  let s = '', n = i;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n/26) - 1; } while (n >= 0);
  return s;
}
function _buildSheetXml(headers, rows){
  const numericCols = new Set([7,8,10,11,12,13,14,15,16]);
  const lastCol = _colRef(headers.length - 1);
  const totalRows = rows.length + 1;
  const parts = [];
  parts.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  parts.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">');
  parts.push('<dimension ref="A1:' + lastCol + totalRows + '"/>');
  parts.push('<sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews>');
  parts.push('<sheetFormatPr defaultRowHeight="15"/>');
  parts.push('<sheetData>');
  // header row (inline strings)
  parts.push('<row r="1">');
  headers.forEach((h, ci) => {
    parts.push('<c r="' + _colRef(ci) + '1" t="inlineStr"><is><t>' + _xmlEsc(h) + '</t></is></c>');
  });
  parts.push('</row>');
  rows.forEach((row, ri) => {
    const rowIdx = ri + 2;
    parts.push('<row r="' + rowIdx + '">');
    row.forEach((v, ci) => {
      if (v === '' || v == null) return;
      const ref = _colRef(ci) + rowIdx;
      if (numericCols.has(ci)) {
        const n = parseFloat(v);
        if (!isNaN(n)) { parts.push('<c r="' + ref + '"><v>' + n + '</v></c>'); return; }
      }
      parts.push('<c r="' + ref + '" t="inlineStr"><is><t>' + _xmlEsc(v) + '</t></is></c>');
    });
    parts.push('</row>');
  });
  parts.push('</sheetData>');
  parts.push('<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>');
  parts.push('<drawing r:id="rId1"/>');
  parts.push('</worksheet>');
  return parts.join('');
}

async function downloadSQLReadingsExcel() {
  if (typeof JSZip === 'undefined') { alert('Zip engine still loading, please try again.'); return; }
  // Use same History tab filters (date range, unit, area, user, search) as Excel/PDF exports
  const from=document.getElementById('h-from').value;
  const to=document.getElementById('h-to').value;
  const unit=document.getElementById('h-unit').value;
  const area=document.getElementById('h-area').value;
  const q=(document.getElementById('h-search').value||'').toLowerCase();
  const user=document.getElementById('h-user')?.value||'';
  const rangeLabel = (from||'start') + ' to ' + (to||'today');

  const filtered = READINGS.filter(r=>
    (!from||r.date>=from)&&(!to||r.date<=to+'~')&&
    (!unit||r.unit===unit)&&(!area||r.area===area)&&
    (!user||(r.username===user||r.inspector===user))&&
    (!q||r.equipment.toLowerCase().includes(q))
  ).sort((a,b)=>b.date.localeCompare(a.date)||a.equipment.localeCompare(b.equipment));
  if (filtered.length === 0) { showToast('No readings found for ' + rangeLabel + '. Please adjust filters and try again.', 'orange'); return; }

  const today = new Date();
  const p = n => String(n).padStart(2,'0');
  const dateStr = today.getFullYear() + p(today.getMonth()+1) + p(today.getDate());

  const rows = filtered.map(r => _buildSQLRow(r));

  try {
    const zip = await JSZip.loadAsync(_vibeMonTemplateBytes());

    // 1) Replace the (first) worksheet XML with our data
    const sheetPath = 'xl/worksheets/sheet1.xml';
    if (!zip.file(sheetPath)) throw new Error('Template missing ' + sheetPath);
    zip.file(sheetPath, _buildSheetXml(SQL_EXPORT_HEADERS, rows));

    // 2) Ensure sheet is named ALL_READINGS (required by the VBA macro)
    const wbPath = 'xl/workbook.xml';
    let wbXml = await zip.file(wbPath).async('string');
    wbXml = wbXml.replace(/(<sheet\b[^>]*\bname=")[^"]*(")/, '$1ALL_READINGS$2');
    zip.file(wbPath, wbXml);

    const blob = await zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12',
      compression: 'DEFLATE'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Vibmon_SQL_Readings_' + dateStr + '.xlsm';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('📊 SQL Export: ' + filtered.length + ' readings (' + rangeLabel + ') → .xlsm (macro-enabled, click Upload button in Excel)', 'green');
  } catch (e) {
    console.error(e);
    alert('Failed to build .xlsm: ' + e.message);
  }
}
