/* VibeMon — Supabase settings + authentication / roles */

// ---- SUPABASE SETTINGS ----
function saveSupabaseConfig(){
  const url = document.getElementById('gs-url').value.trim();
  const key = document.getElementById('supa-anon-key').value.trim();
  if(!url || !key){ alert('Please fill in both the Supabase Project URL and Anon Key.'); return; }
  // These are stored only for display — the actual values must be hardcoded at the top.
  localStorage.setItem('vibemon_supa_url', url);
  localStorage.setItem('vibemon_supa_key', key);
  document.getElementById('gs-result').innerHTML='<div class="alert-box alert-suc">✅ Config saved! <strong>Important:</strong> Also update SUPABASE_URL and SUPABASE_ANON_KEY at the top of the &lt;script&gt; in the HTML file for permanent effect.</div>';
}
function saveGSUrl(){ saveSupabaseConfig(); }
function clearGSUrl(){
  if(!confirm('Clear Supabase config from this browser? The hardcoded values in the HTML will still be used.')) return;
  localStorage.removeItem('vibemon_supa_url');
  localStorage.removeItem('vibemon_supa_key');
  document.getElementById('gs-result').innerHTML = '<div class="alert-box alert-warn">⚠️ Cleared from browser. Hardcoded values in HTML are still active.</div>';
}
async function testGS(){
  document.getElementById('gs-result').innerHTML='<div class="alert-box alert-info">⏳ Testing Supabase connection...</div>';
  try{
    const { data, error } = await _supabase.from('readings').select('id').limit(1);
    if(error) throw error;
    document.getElementById('gs-result').innerHTML='<div class="alert-box alert-suc">✅ Supabase connected! readings table is accessible.</div>';
  }catch(e){
    document.getElementById('gs-result').innerHTML=`<div class="alert-box alert-warn">⚠️ Connection failed: ${e.message}<br><small>Check your SUPABASE_URL and SUPABASE_ANON_KEY at the top of the HTML file.</small></div>`;
  }
}
function copyScript(){
  const code = document.getElementById('gs-code') ? document.getElementById('gs-code').textContent : '';
  navigator.clipboard.writeText(code).then(()=>alert('✅ Copied!')).catch(()=>alert('Select and copy manually.'));
}


// ======= AUTHENTICATION — Google Sheets Only =======
const AUTH_KEY  = 'vibromon_auth_v2'; // Persists login session across browser opens
const CREDS_KEY = 'vibromon_creds_v1'; // Persists username+password for auto-login (pre-fill)
const USERS_CACHE_KEY = 'vibromon_users_cache_v1'; // Hashed credentials for offline login
let AUTH = { loggedIn: false, username: '', displayName: '', role: 'viewer' };

// SHA-256 helper — used to hash passwords before storing in offline cache
async function _sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// Save a successfully-authenticated user into the offline credential cache
async function _cacheUserCredential(uname, pass, displayName, role) {
  try {
    const hash = await _sha256(pass);
    const existing = _loadUsersCache();
    existing[uname.toLowerCase()] = { username: uname, displayName, role, hash };
    localStorage.setItem(USERS_CACHE_KEY, JSON.stringify(existing));
  } catch(e) { /* non-critical */ }
}

function _loadUsersCache() {
  try {
    const c = localStorage.getItem(USERS_CACHE_KEY);
    return c ? JSON.parse(c) : {};
  } catch(e) { return {}; }
}

// Try offline login using cached credentials. Returns AUTH-like object or null.
async function _tryOfflineLogin(uname, pass) {
  const cache = _loadUsersCache();
  const entry = cache[uname.toLowerCase()];
  if (!entry) return null;
  try {
    const hash = await _sha256(pass);
    if (hash === entry.hash) {
      return { loggedIn: true, username: entry.username, displayName: entry.displayName, role: entry.role };
    }
  } catch(e) {}
  return null;
}

async function getUsers() {
  // Fetch active users from Supabase users table (admin only, no passwords returned)
  try {
    const { data, error } = await _supabase
      .from('users')
      .select('username, name, role')
      .eq('active', true);
    if (error) throw error;
    return (data || []).map(u => ({ username: u.username, name: u.name, role: u.role }));
  } catch(e) { console.warn('getUsers failed:', e.message); }
  return [];
}

function saveUsers(users) {
  // Users are managed in Supabase — no localStorage needed
  console.log('saveUsers: Users managed via Supabase users table');
}

function openLoginScreen() {
  document.getElementById('login-screen').classList.add('open');
  // Pre-fill saved credentials if available
  let savedU = '', savedP = '';
  try {
    const c = localStorage.getItem(CREDS_KEY);
    if (c) { const cj = JSON.parse(c); savedU = cj.u || ''; savedP = cj.p || ''; }
  } catch(e){}
  document.getElementById('login-user').value = savedU;
  document.getElementById('login-pass').value = savedP;
  document.getElementById('login-err').classList.remove('show');
  const errEl = document.getElementById('login-err');
  if (errEl) errEl.textContent = '❌ Invalid username or password.';
}

function continueAsViewer() {
  // Viewer mode removed — login required
  alert('Please login with your username and password to access VibeMon.');
}

async function doLogin() {
  const uname = document.getElementById('login-user').value.trim();
  const pass = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-err');
  const btnEl = document.querySelector('.login-btn');
  if (!uname || !pass) { errEl.textContent = '❌ Please enter username and password.'; errEl.classList.add('show'); return; }
  if (btnEl) { btnEl.textContent = '🔄 Verifying...'; btnEl.disabled = true; }
  errEl.classList.remove('show');

  // Hardcoded offline fallback — works when GSheet unreachable (file:// on mobile or no internet)
  if (uname.toLowerCase() === 'admin' && pass === 'NTPC@1011') {
    AUTH = { loggedIn: true, username: 'Admin', displayName: 'Administrator', role: 'admin' };
    try { localStorage.setItem(AUTH_KEY, JSON.stringify(AUTH)); } catch(e2){}
    try { localStorage.setItem(CREDS_KEY, JSON.stringify({u: uname, p: pass})); } catch(e3){}
    await _cacheUserCredential('Admin', pass, 'Administrator', 'admin');
    if (btnEl) { btnEl.textContent = '🔐 Login'; btnEl.disabled = false; }
    applyAuth();
    return;
  }

  try {
    // Query Supabase users table for matching credentials
    const passHash = await _sha256(pass);
    let result = null;

    if (navigator.onLine) {
      const { data: users, error } = await _supabase
        .from('users')
        .select('username, name, role, password_hash, active')
        .ilike('username', uname)
        .eq('active', true)
        .limit(1);
      if (error) throw new Error('OFFLINE');
      if (users && users.length > 0) {
        const u = users[0];
        if (u.password_hash === passHash) {
          result = { status: 'ok', user: u };
        } else {
          result = { status: 'error', msg: 'Invalid username or password.' };
        }
      } else {
        result = { status: 'error', msg: 'User not found or inactive.' };
      }
    } else {
      throw new Error('OFFLINE');
    }

    if (result.status === 'ok' && result.user) {
      const u = result.user;
      const roleMap = { 'ADMIN': 'admin', 'EDITOR': 'editor', 'VIEWER': 'viewer' };
      AUTH = {
        loggedIn: true,
        username: u.username,
        displayName: u.name || u.username,
        role: roleMap[(u.role||'').toUpperCase()] || 'viewer'
      };
      try { localStorage.setItem(AUTH_KEY, JSON.stringify(AUTH)); } catch(e){}
      try { localStorage.setItem(CREDS_KEY, JSON.stringify({u: uname, p: pass})); } catch(ec){}
      await _cacheUserCredential(u.username, pass, u.name || u.username, roleMap[(u.role||'').toUpperCase()] || 'viewer');
      applyAuth();
    } else {
      errEl.textContent = '❌ ' + (result.msg || 'Invalid username or password.');
      errEl.classList.add('show');
      document.getElementById('login-pass').value = '';
    }
  } catch(e) {
    if (e.message === 'OFFLINE' || !navigator.onLine) {
      if (btnEl) { btnEl.textContent = '🔄 Checking offline cache...'; }
      const offlineAuth = await _tryOfflineLogin(uname, pass);
      if (offlineAuth) {
        AUTH = offlineAuth;
        try { localStorage.setItem(AUTH_KEY, JSON.stringify(AUTH)); } catch(ex){}
        if (btnEl) { btnEl.textContent = '🔐 Login'; btnEl.disabled = false; }
        showToast('📵 Logged in offline — Data Entry only mode active', 'blue');
        applyAuth();
        return;
      } else {
        errEl.textContent = '📵 Offline & no cached login for this user. Please login online at least once first.';
        errEl.classList.add('show');
      }
    } else {
      errEl.textContent = '⚠️ Unable to reach Supabase. Check connection and try again.';
      errEl.classList.add('show');
    }
  } finally {
    if (btnEl) { btnEl.textContent = '🔐 Login'; btnEl.disabled = false; }
  }
}

function doLogout() {
  // Clear saved credentials and session — but keep USERS_CACHE_KEY so offline login still works
  try { localStorage.removeItem(CREDS_KEY); } catch(e){}
  try { localStorage.removeItem(AUTH_KEY); } catch(e){}
  // Note: USERS_CACHE_KEY is intentionally kept — allows offline login after logout
  AUTH = { loggedIn: false, username: '', displayName: '', role: 'viewer' };
  openLoginScreen();
}

function applyAuth() {
  document.getElementById('login-screen').classList.remove('open');
  // Body class for CSS-driven visibility
  document.body.classList.remove('role-admin','role-editor','role-viewer');
  document.body.classList.add('role-' + AUTH.role);
  // Set inspector name
  const inspEl = document.getElementById('inspector-name');
  if (inspEl) inspEl.value = AUTH.displayName;
  // Nav info
  document.getElementById('nav-role-info').style.display = 'flex';
  document.getElementById('nav-username-label').textContent = AUTH.displayName;
  const badge = document.getElementById('nav-role-badge');
  badge.innerHTML = `<span class="role-badge role-${AUTH.role}">${AUTH.role === 'editor' ? 'ENGINEER' : AUTH.role.toUpperCase()}</span>`;
  const adminBtn = document.getElementById('nav-admin-btn');
  adminBtn.style.display = AUTH.role === 'admin' ? 'inline-block' : 'none';
  // Login vs Logout button (top nav)
  document.getElementById('nav-login-btn').style.display = AUTH.role === 'viewer' ? 'inline-block' : 'none';
  document.getElementById('nav-logout-btn').style.display = AUTH.role === 'viewer' ? 'none' : 'inline-block';
  // Mobile bottom nav — logout/login sync
  const mbLogout = document.getElementById('mb-logout-btn');
  const mbLogin  = document.getElementById('mb-login-btn');
  if (mbLogout) mbLogout.style.display = AUTH.role === 'viewer' ? 'none' : 'flex';
  if (mbLogin)  mbLogin.style.display  = AUTH.role === 'viewer' ? 'flex' : 'none';
  // If viewer happens to be on a hidden tab, send them to history
  if (AUTH.role !== 'admin') {
    const cur = document.querySelector('.screen.active');
    if (cur && (AUTH.role === 'viewer' && cur.id === 'tab-entry')) showTab('history');
  }
  // Viewer default landing = history
  if (AUTH.role === 'viewer') {
    const cur2 = document.querySelector('.screen.active');
    if (!cur2 || cur2.id === 'tab-entry') showTab('history');
  }
  loadData();
  populateFilters();
  filterEntryList();
  populateUserFilter();
  const today = _todayFmt();
  const _d7 = new Date(); _d7.setDate(_d7.getDate() - 7);
  const sevenDaysAgo = _localISOString(_d7).slice(0,10);
  ['h-from'].forEach(id=>{const el=document.getElementById(id);if(el)el.value=sevenDaysAgo;});
  ['h-to'].forEach(id=>{const el=document.getElementById(id);if(el)el.value=today;});
  const excFrom=document.getElementById('exc-from'); if(excFrom)excFrom.value=sevenDaysAgo;
  const excTo=document.getElementById('exc-to'); if(excTo)excTo.value=today;
}
