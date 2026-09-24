/* VibeMon — saving overlay + toast */

// -- Full-screen blocking overlay shown while a save/sync is in flight.
//    Prevents double-taps and any other interaction with the form until
//    the request settles, regardless of how slow the Apps Script call is.
let _vmSavingDepth = 0;
function showSavingOverlay(text) {
  _vmSavingDepth++;
  const el = document.getElementById('vm-saving-overlay');
  const txt = document.getElementById('vm-saving-text');
  if (txt) txt.textContent = text || '💾 Saving reading…';
  if (el) el.classList.add('active');
}
function hideSavingOverlay() {
  _vmSavingDepth = Math.max(0, _vmSavingDepth - 1);
  if (_vmSavingDepth > 0) return; // only hide once every caller is done
  const el = document.getElementById('vm-saving-overlay');
  if (el) el.classList.remove('active');
}

function showToast(msg, color) {
  const t = document.createElement('div');
  const bg = color === 'green' ? '#1E8449' : color === 'red' ? '#DC2626' : '#1D4E8A';
  t.style = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:${bg};color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;z-index:999;box-shadow:0 4px 16px rgba(0,0,0,.25);transition:opacity .4s`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 3000);
}
