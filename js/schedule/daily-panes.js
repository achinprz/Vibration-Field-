/* VibeMon — Daily Schedule tab: left menu, one section shown at a time.
   Sections: 'cal' calendar + day table (the default), 'find' equipment search, 'perf' performance, 'cmp' team comparison (admin).
   The month controls in the tab header apply to every section. */

const DSV_KEYS = ['cal', 'find', 'perf', 'cmp'];
window.DSV_ACTIVE = 'cal';

function dsvSelect(key) {
  if (key === 'cmp' && (typeof AUTH === 'undefined' || AUTH.role !== 'admin')) key = 'cal';   // admin-only section
  if (DSV_KEYS.indexOf(key) < 0) key = 'cal';
  document.querySelectorAll('#tab-daily .dsv-pane').forEach(p => p.classList.toggle('on', p.getAttribute('data-dsv') === key));
  document.querySelectorAll('#tab-daily .dsv-nav-btn').forEach(b => b.classList.toggle('on', b.getAttribute('data-dsv') === key));
  window.DSV_ACTIVE = key;
  if (key === 'find') {
    try { if (typeof dsqRefresh === 'function') dsqRefresh(); } catch (e) {}
    const i = document.getElementById('ds-eq-search');
    if (i && !('ontouchstart' in window)) setTimeout(() => { try { i.focus(); } catch (e) {} }, 50);   // no auto-keyboard on phones
  }
}
// if the role changed while an admin-only section was open (logout / login), fall back to the calendar
function dsvGuard() {
  if (window.DSV_ACTIVE === 'cmp' && (typeof AUTH === 'undefined' || AUTH.role !== 'admin')) dsvSelect('cal');
}
