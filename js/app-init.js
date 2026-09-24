/* VibeMon — window.onload: restore session / auto-login / initial filters */

// ---- INIT ----
window.onload=()=>{
  // Try restoring session from localStorage (persists across file opens)
  const saved = localStorage.getItem(AUTH_KEY);
  let restored = false;
  if (saved) {
    try {
      const a = JSON.parse(saved);
      if (a && a.loggedIn && a.role !== 'viewer') { AUTH = a; applyAuth(); restored = true; }
    } catch(e) {}
  }
  // If session not restored, try silent auto-login with saved credentials
  if (!restored) {
    (async function tryAutoLogin() {
      let autoU = '', autoP = '';
      try {
        const c = localStorage.getItem(CREDS_KEY);
        if (c) { const cj = JSON.parse(c); autoU = cj.u || ''; autoP = cj.p || ''; }
      } catch(e) {}
      if (autoU && autoP) {
        // Silently fill the fields and call doLogin (login screen stays hidden)
        document.getElementById('login-user').value = autoU;
        document.getElementById('login-pass').value = autoP;
        await doLogin();
      } else {
        // Show login screen on first launch instead of auto-viewer
        openLoginScreen();
      }
    })();
  }
  const today=_todayFmt();
  const _d7b=new Date(); _d7b.setDate(_d7b.getDate()-7);
  const sevenDaysAgo=_localISOString(_d7b).slice(0,10);
  ['h-from'].forEach(id=>{const el=document.getElementById(id);if(el)el.value=sevenDaysAgo;});
  ['h-to'].forEach(id=>{const el=document.getElementById(id);if(el)el.value=today;});
  document.getElementById('readings-count-label') && (document.getElementById('readings-count-label').textContent='Syncing from Supabase...');
  try { initSQLAutoDownload(); } catch(e) { console.error('initSQLAutoDownload failed:', e); }
};
