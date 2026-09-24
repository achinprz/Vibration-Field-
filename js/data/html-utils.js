/* VibeMon — XSS-safe escaping helpers (jsArg / escHtml) */

// XSS-safe helpers for embedding dynamic values in inline HTML/JS.
//
// jsArg(value) is THE single safe way to pass a dynamic string into an
// inline onclick/onchange handler, e.g.:
//     onclick="doThing(${jsArg(name)})"
// It already returns a fully-quoted, HTML-attribute-safe literal — do NOT
// wrap its result in extra quotes at the call site (no `'${jsArg(x)}'`).
//
// Two independent escaping passes are required, and this is why:
//   1) JSON.stringify() produces a syntactically valid JS string literal
//      (correctly escapes quotes, backslashes, control chars, unicode).
//   2) HTML-entity escaping makes that literal safe to sit inside an HTML
//      attribute value (handles &, <, >, and BOTH quote characters).
// JSON.stringify() alone is NOT safe to drop into a double-quoted HTML
// attribute: it always wraps the value in literal double-quotes, which
// terminates the attribute early for EVERY value, not just ones with
// "special" characters (e.g. onclick="fn("ID FAN A")" is already broken).
// Manually escaping only single quotes (the old `str.replace(/'/g,"\\'")`
// pattern used elsewhere in this file) is not safe either — it leaves
// double-quotes, ampersands, and backslashes unescaped, which breaks for
// equipment names such as `PUMP "A" / B (MAIN)` or `MOTOR & GEAR BOX - A`.
function jsArg(value) {
  return JSON.stringify(String(value ?? ''))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
