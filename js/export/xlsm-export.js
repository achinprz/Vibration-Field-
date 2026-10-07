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
const _SHEET_XML_DEFAULT_ROOT = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
// extraTail = whatever sat AFTER the <drawing/> element in the template's own sheet1.xml
// (typically <legacyDrawing/> + the <mc:AlternateContent> block that wires a Form/ActiveX
// button's on-click macro) — carried over as-is so a button the template author drew keeps
// working in the downloaded file, without this code needing to know button XML at all.
// rootTag = the template's own <worksheet ...> opening tag, reused verbatim — a button block
// uses namespace prefixes (xdr:, mc:, ...) that only the 2 namespaces hardcoded below declare;
// without the template's full set of xmlns declarations the file is invalid XML (Excel refuses
// or "repairs" it) even though the button markup itself is byte-for-byte unchanged.
function _buildSheetXml(headers, rows, extraTail, rootTag, sheetPr, drawingBlock){
  const numericCols = new Set([7,8,10,11,12,13,14,15,16]);
  const lastCol = _colRef(headers.length - 1);
  const totalRows = rows.length + 1;
  const parts = [];
  parts.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  parts.push(rootTag || _SHEET_XML_DEFAULT_ROOT);
  if (sheetPr) parts.push(sheetPr);
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
  if (drawingBlock) parts.push(drawingBlock);
  if (extraTail) parts.push(extraTail);
  parts.push('</worksheet>');
  return parts.join('');
}
// Pulls the button/control markup back out of the template's own sheet1.xml, so it isn't lost
// when the sheet gets rebuilt with real data. Returns '' if the template has none (still works —
// the file just won't have a wired-up button, same as before this existed).
function _extractSheetTail(originalSheetXml){
  const m = /<drawing\b[^>]*\/>([\s\S]*)<\/worksheet>/.exec(originalSheetXml || '');
  return m ? m[1] : '';
}
// The template's own <worksheet ...> opening tag (all its xmlns declarations), so a preserved
// button's namespace prefixes (xdr:, mc:, ...) resolve. Falls back to the plain default root
// when there's nothing to preserve (extraTail empty) or the template's tag can't be found.
// The template sheet's <sheetPr codeName="..."/> — ties the sheet to its VBA sheet module, so keep it.
function _extractSheetPr(originalSheetXml){
  const m = /<sheetPr\b[^>]*\/>|<sheetPr\b[^>]*>[\s\S]*?<\/sheetPr>/.exec(originalSheetXml || '');
  return m ? m[0] : '';
}
// The template's own <pageSetup .../> + <drawing .../> elements, verbatim. Their r:id values are
// whatever THIS template's sheet1.xml.rels assigns (a template saved with printer settings has the
// drawing at rId2, not rId1) — hardcoding an id points the drawing at the wrong part and Excel
// reports the file as corrupt and drops the shape/button.
function _extractDrawingBlock(originalSheetXml){
  const ps = /<pageSetup\b[^>]*\/>/.exec(originalSheetXml || '');
  const dr = /<drawing\b[^>]*\/>/.exec(originalSheetXml || '');
  return (ps ? ps[0] : '') + (dr ? dr[0] : '');
}
function _extractSheetHead(originalSheetXml){
  const m = /<worksheet\b[^>]*>/.exec(originalSheetXml || '');
  return m ? m[0] : _SHEET_XML_DEFAULT_ROOT;
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

    // 1) Replace the (first) worksheet XML with our data, keeping whatever button(s) the
    // template itself has wired up (see _extractSheetTail — it reads the ORIGINAL sheet before
    // it gets overwritten, so an updated template's buttons carry over automatically).
    const sheetPath = 'xl/worksheets/sheet1.xml';
    if (!zip.file(sheetPath)) throw new Error('Template missing ' + sheetPath);
    const origSheetXml = await zip.file(sheetPath).async('string');
    const sheetTail = _extractSheetTail(origSheetXml);
    const sheetHead = _extractSheetHead(origSheetXml);
    zip.file(sheetPath, _buildSheetXml(SQL_EXPORT_HEADERS, rows, sheetTail, sheetHead, _extractSheetPr(origSheetXml), _extractDrawingBlock(origSheetXml)));

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
