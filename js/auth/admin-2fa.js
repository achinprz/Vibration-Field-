/* VibeMon — admin 2-step sign-in with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy …).
   An ADMIN login goes through two steps:
     1. the normal username + password (checked against the users table, exactly as before)
     2. a 6-digit code from the authenticator app — checked by Supabase Auth (TOTP). The secret lives only inside Supabase Auth and in the
        admin's phone; it is never stored in the users table or in this app.
   Each admin needs a Supabase Auth user (email  <username>@ADMIN_2FA_EMAIL_DOMAIN , SAME password as the VibeMon login) — see supabase/ADMIN_2FA_SETUP.md.
   Admin logins always need internet (no offline admin sign-in, no saved admin password on the phone). Everyone else signs in as before. */

const A2_MAX_WRONG_CODES = 5;

function _a2On() { return typeof ADMIN_2FA !== 'undefined' && ADMIN_2FA === true; }
function _a2Email(username) { return String(username || '').trim().toLowerCase() + '@' + ADMIN_2FA_EMAIL_DOMAIN; }
function _a2NetErr(e) { return !navigator.onLine || /failed to fetch|network|load failed|fetch/i.test((e && (e.message || e.name)) || ''); }

/* ───────── small full-screen card used for the extra step ───────── */
function _a2Show(title, bodyHtml) {
  let g = document.getElementById('a2-gate');
  if (!g) { g = document.createElement('div'); g.id = 'a2-gate'; g.className = 'a2-bg'; document.body.appendChild(g); }
  g.innerHTML = '<div class="a2-card" role="dialog" aria-label="' + escHtml(title) + '"><div class="a2-logo">⚡ VibeMon</div><h2>' + escHtml(title) + '</h2>' + bodyHtml + '<div class="a2-err" id="a2-err"></div></div>';
  g.classList.add('open');
  const ls = document.getElementById('login-screen'); if (ls) ls.classList.remove('open');
  return g;
}
function _a2Hide() { const g = document.getElementById('a2-gate'); if (g) { g.classList.remove('open'); g.innerHTML = ''; } }
function _a2Err(msg) { const e = document.getElementById('a2-err'); if (e) { e.textContent = msg || ''; e.style.display = msg ? 'block' : 'none'; } }
function _a2Busy(btn, on, text) { if (!btn) return; btn.disabled = !!on; if (text !== undefined) btn.textContent = text; }

async function admin2faSignOut() {
  try { await _supabase.auth.signOut({ scope: 'local' }); } catch (e) { /* nothing to sign out of */ }
}

// is there a live Supabase session that has already passed the authenticator code? (used when the page is re-opened)
async function admin2faSessionOk(username) {
  try {
    const { data: s } = await _supabase.auth.getSession();
    if (!s || !s.session) return false;
    if (username && String(s.session.user && s.session.user.email || '').toLowerCase() !== _a2Email(username)) return false;
    const { data, error } = await _supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    return !error && !!data && data.currentLevel === 'aal2';
  } catch (e) { return false; }
}

/* ───────── step 2a: the code, for an admin who has already set up the app ───────── */
function _a2Challenge(factorId) {
  return new Promise(done => {
    let wrong = 0;
    _a2Show('Enter your authenticator code', `
      <p class="a2-sub">Open <b>Google Authenticator</b> (or your authenticator app) and type the 6-digit code shown for <b>VibeMon</b>. The code changes every 30 seconds.</p>
      <input type="text" id="a2-code" class="a2-code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000" onkeydown="if(event.key==='Enter')document.getElementById('a2-go').click()">
      <button class="a2-btn" id="a2-go">Verify</button>
      <button class="a2-link" id="a2-out">Cancel and sign out</button>`);
    document.getElementById('a2-out').onclick = async () => { await admin2faSignOut(); _a2Hide(); done({ ok: false, cancelled: true }); };
    document.getElementById('a2-go').onclick = async () => {
      const code = document.getElementById('a2-code').value.replace(/\D/g, ''), btn = document.getElementById('a2-go');
      if (code.length !== 6) return _a2Err('Type the 6 digits.');
      _a2Err(''); _a2Busy(btn, true, 'Checking…');
      try {
        const { error } = await _supabase.auth.mfa.challengeAndVerify({ factorId, code });
        if (error) throw error;
        _a2Hide(); done({ ok: true });
      } catch (e) {
        document.getElementById('a2-code').value = '';
        if (_a2NetErr(e)) { _a2Busy(btn, false, 'Verify'); return _a2Err('No connection — try again.'); }
        if (++wrong >= A2_MAX_WRONG_CODES) { await admin2faSignOut(); _a2Hide(); return done({ ok: false, msg: 'Too many wrong codes. Sign in again.' }); }
        _a2Busy(btn, false, 'Verify');
        _a2Err('That code is not right (or it just expired). Wait for the next one. (' + (A2_MAX_WRONG_CODES - wrong) + ' tries left)');
      }
    };
    setTimeout(() => { const f = document.getElementById('a2-code'); if (f) f.focus(); }, 50);
  });
}

/* ───────── step 2b: first time — show the QR code, confirm with one code ───────── */
async function _a2Enroll(all) {
  // an earlier, unfinished set-up would block a new one
  try { for (const f of (all || [])) if (f.status !== 'verified') await _supabase.auth.mfa.unenroll({ factorId: f.id }); } catch (e) { /* ignore */ }
  const { data, error } = await _supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'VibeMon ' + new Date().toISOString().slice(0, 16).replace('T', ' ') });
  if (error) throw error;
  return new Promise(done => {
    let wrong = 0;
    _a2Show('Set up your authenticator app', `
      <p class="a2-sub">Admin logins need a second step. <b>1.</b> On your phone open <b>Google Authenticator</b> → <b>+</b> → <i>Scan a QR code</i>. <b>2.</b> Type the 6-digit code it shows.</p>
      <div class="a2-qr"><img alt="QR code" src="${escHtml(data.totp.qr_code)}"></div>
      <details class="a2-sub"><summary>Cannot scan? Type this key into the app instead</summary><code class="a2-secret">${escHtml(data.totp.secret)}</code></details>
      <input type="text" id="a2-code" class="a2-code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000" onkeydown="if(event.key==='Enter')document.getElementById('a2-go').click()">
      <button class="a2-btn" id="a2-go">Confirm and continue</button>
      <button class="a2-link" id="a2-out">Cancel and sign out</button>`);
    document.getElementById('a2-out').onclick = async () => { try { await _supabase.auth.mfa.unenroll({ factorId: data.id }); } catch (e) {} await admin2faSignOut(); _a2Hide(); done({ ok: false, cancelled: true }); };
    document.getElementById('a2-go').onclick = async () => {
      const code = document.getElementById('a2-code').value.replace(/\D/g, ''), btn = document.getElementById('a2-go');
      if (code.length !== 6) return _a2Err('Type the 6 digits.');
      _a2Err(''); _a2Busy(btn, true, 'Checking…');
      try {
        const { error: e1 } = await _supabase.auth.mfa.challengeAndVerify({ factorId: data.id, code });
        if (e1) throw e1;
        _a2Hide(); done({ ok: true });
      } catch (e) {
        document.getElementById('a2-code').value = '';
        if (_a2NetErr(e)) { _a2Busy(btn, false, 'Confirm and continue'); return _a2Err('No connection — try again.'); }
        if (++wrong >= A2_MAX_WRONG_CODES) { try { await _supabase.auth.mfa.unenroll({ factorId: data.id }); } catch (x) {} await admin2faSignOut(); _a2Hide(); return done({ ok: false, msg: 'Too many wrong codes. Sign in again to restart the set-up.' }); }
        _a2Busy(btn, false, 'Confirm and continue');
        _a2Err('That code did not match. Make sure the phone clock is on automatic time, then type the next code.');
      }
    };
    setTimeout(() => { const f = document.getElementById('a2-code'); if (f) f.focus(); }, 50);
  });
}

/* ───────── the whole second step. Call after the VibeMon password has been accepted for an ADMIN.
   Resolves {ok:true}, or {ok:false, msg?, cancelled?}. ───────── */
async function admin2faRun(username, password) {
  try {
    await admin2faSignOut();   // never carry over somebody else's earlier session
    const { error } = await _supabase.auth.signInWithPassword({ email: _a2Email(username), password });
    if (error) {
      if (_a2NetErr(error)) return { ok: false, msg: '📵 Admin sign-in needs internet. Check your connection and try again.' };
      return { ok: false, msg: '🔐 The 2-step account for this admin is missing, or its password differs from the VibeMon password. See supabase/ADMIN_2FA_SETUP.md.' };
    }
    const { data: aal, error: e0 } = await _supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (e0) throw e0;
    let r;
    if (aal.currentLevel === 'aal2') r = { ok: true };
    else {
      const { data: fl, error: e1 } = await _supabase.auth.mfa.listFactors();
      if (e1) throw e1;
      const verified = (fl.totp || []);   // listFactors().totp holds only the verified ones
      r = verified.length ? await _a2Challenge(verified[0].id) : await _a2Enroll(fl.all);
    }
    if (!r.ok) return r;
    // trust the server's word, not the screen: the session must now really be aal2
    if (!(await admin2faSessionOk(username))) { await admin2faSignOut(); return { ok: false, msg: 'The authenticator step was not completed.' }; }
    return { ok: true };
  } catch (e) {
    _a2Hide(); await admin2faSignOut();
    return { ok: false, msg: _a2NetErr(e) ? '📵 Admin sign-in needs internet. Check your connection and try again.' : '⚠️ 2-step sign-in stopped: ' + (e.message || e) };
  }
}
