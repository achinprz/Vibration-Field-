/* VibeMon — admin logins sign out by themselves after 15 minutes without use (any tap, key press or scroll counts as use).
   A red bar warns during the last minute; touching the screen keeps the session going. Field engineers are not affected. */

const ADMIN_IDLE_MINUTES = 15;
const ADMIN_IDLE_WARN_SECONDS = 60;
let _idleLast = 0, _idleTimer = null, _idleBound = false;

function _idleBar() {
  let b = document.getElementById('idle-warn');
  if (!b) { b = document.createElement('div'); b.id = 'idle-warn'; b.className = 'idle-warn'; b.style.display = 'none'; document.body.appendChild(b); }
  return b;
}
function _idleTouch() { if (_idleTimer) { _idleLast = Date.now(); _idleBar().style.display = 'none'; } }

function idleStart() {
  _idleLast = Date.now();
  if (!_idleBound) {
    _idleBound = true;
    ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel', 'click'].forEach(ev => document.addEventListener(ev, _idleTouch, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', () => { if (_idleTimer && !document.hidden) _idleTick(); });
  }
  if (_idleTimer) clearInterval(_idleTimer);
  _idleTimer = setInterval(_idleTick, 5000);
}
function idleStop() {
  if (_idleTimer) clearInterval(_idleTimer);
  _idleTimer = null;
  const b = document.getElementById('idle-warn'); if (b) b.style.display = 'none';
}
function _idleTick() {
  if (!_idleTimer) return;
  const left = ADMIN_IDLE_MINUTES * 60000 - (Date.now() - _idleLast);
  if (left <= 0) { idleStop(); doLogout('You were signed out after ' + ADMIN_IDLE_MINUTES + ' minutes without use. Please sign in again.'); return; }
  const b = _idleBar();
  if (left <= ADMIN_IDLE_WARN_SECONDS * 1000) { b.textContent = '⏱ Signing out in ' + Math.ceil(left / 1000) + ' s — touch the screen to stay signed in'; b.style.display = 'block'; }
  else b.style.display = 'none';
}
