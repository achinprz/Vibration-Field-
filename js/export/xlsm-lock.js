/* VibeMon — the macro-enabled Excel (.xlsm) template is locked with a security password.
   • The template is stored ENCRYPTED (AES-256-GCM, key from PBKDF2-SHA256 of the password). Without the password it cannot be read —
     the password is not stored anywhere, it only unlocks the file (a wrong password simply fails to decrypt).
   • The current encrypted copy lives in Supabase (table app_settings, key 'xlsm_template_enc'); until an admin changes the password the
     starting copy inside xlsm-template-data.js is used.
   • Admins change the password / replace the template in Admin Panel → Password management.
   • A wrong password can be tried 5 times, then this page waits 30 seconds (the real protection is the encryption itself). */

const XLSM_KEY = 'xlsm_template_enc';
const XLSM_ITER = 600000;
const XLSM_MIN_LEN = 10;
let _xlsmEnvCache = null;
let _xlsmFails = 0, _xlsmLockUntil = 0;

/* ───────── crypto ───────── */
const _x64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const _xb64 = s => { const bin = atob(s), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; };
async function _xlsmKey(pass, salt, iter, usage) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pass)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, [usage]);
}
async function xlsmEncrypt(bytes, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await _xlsmKey(pass, salt, XLSM_ITER, 'encrypt');
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return { v: 1, kdf: 'PBKDF2-SHA256', iter: XLSM_ITER, salt: _x64(salt), iv: _x64(iv), ct: _x64(ct) };
}
// returns the file bytes, or throws 'WRONG' when the password does not unlock it
async function xlsmDecrypt(env, pass) {
  const key = await _xlsmKey(pass, _xb64(env.salt), env.iter || XLSM_ITER, 'decrypt');
  try { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: _xb64(env.iv) }, key, _xb64(env.ct))); }
  catch (e) { throw new Error('WRONG'); }
}

/* ───────── where the current encrypted copy is ───────── */
// -> { env, source: 'supabase' | 'starting', updated }   (throws 'OFFLINE' when the database cannot be reached)
async function xlsmLoadEnvelope(force) {
  if (_xlsmEnvCache && !force && Date.now() - _xlsmEnvCache.t < 30000) return _xlsmEnvCache.v;
  let v;
  try {
    const { data, error } = await _supabase.from('app_settings').select('value, updated_on, updated_by').eq('key', XLSM_KEY).limit(1);
    if (error) throw error;
    if (data && data.length && data[0].value) { v = { env: JSON.parse(data[0].value), source: 'supabase', updated: data[0].updated_on, by: data[0].updated_by }; }
    else v = { env: XLSM_TEMPLATE_ENC_DEFAULT, source: 'starting' };
  } catch (e) {
    if (/fetch|network|load failed|timeout/i.test(e.message || '') || !navigator.onLine) throw new Error('OFFLINE');
    v = { env: XLSM_TEMPLATE_ENC_DEFAULT, source: 'starting', note: e.message };      // table missing: the starting copy still works
  }
  _xlsmEnvCache = { t: Date.now(), v };
  return v;
}
async function xlsmSave(env) {
  const { error } = await _supabase.from('app_settings').upsert({ key: XLSM_KEY, value: JSON.stringify(env), updated_by: (AUTH && AUTH.username) || 'admin', updated_on: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
  _xlsmEnvCache = null;
}

/* ───────── the password box shown before a download ───────── */
function xlsmPrompt(opts) {
  return new Promise(resolve => {
    const old = document.getElementById('xlsm-ask'); if (old) old.remove();
    const m = document.createElement('div'); m.id = 'xlsm-ask'; m.className = 'xl-bg';
    m.innerHTML = `<div class="xl-card" role="dialog" aria-label="${escHtml(opts.title)}"><h3>🔒 ${escHtml(opts.title)}</h3><p>${escHtml(opts.intro)}</p>
      <input type="password" id="xl-pass" autocomplete="off" placeholder="Security password"><div class="xl-err" id="xl-err"></div>
      <div class="xl-row"><button class="btn" id="xl-cancel">Cancel</button><button class="btn btn-primary" id="xl-go">${escHtml(opts.button || 'Unlock')}</button></div></div>`;
    document.body.appendChild(m);
    const close = v => { m.remove(); resolve(v); };
    const err = t => { const e = document.getElementById('xl-err'); e.textContent = t || ''; e.style.display = t ? 'block' : 'none'; };
    m.querySelector('#xl-cancel').onclick = () => close(null);
    const go = async () => {
      const pass = document.getElementById('xl-pass').value, btn = document.getElementById('xl-go');
      if (!pass) return err('Enter the password.');
      if (Date.now() < _xlsmLockUntil) return err('Too many wrong tries — wait ' + Math.ceil((_xlsmLockUntil - Date.now()) / 1000) + ' seconds.');
      btn.disabled = true; btn.textContent = 'Checking…'; err('');
      try { const out = await opts.tryFn(pass); close(out); }
      catch (e) {
        btn.disabled = false; btn.textContent = opts.button || 'Unlock';
        if (e.message === 'WRONG') { _xlsmFails++; if (_xlsmFails >= 5) { _xlsmLockUntil = Date.now() + 30000; _xlsmFails = 0; err('Wrong password. Too many tries — wait 30 seconds.'); } else err('Wrong password.'); }
        else err('Could not check it: ' + (e.message || e));
        document.getElementById('xl-pass').value = ''; document.getElementById('xl-pass').focus();
      }
    };
    m.querySelector('#xl-go').onclick = go;
    m.querySelector('#xl-pass').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    setTimeout(() => { const f = document.getElementById('xl-pass'); if (f) f.focus(); }, 30);
  });
}

// Used by the Excel (.xlsm) download: asks for the password, returns the template bytes (null = cancelled)
async function xlsmUnlockTemplate() {
  let cur;
  try { cur = await xlsmLoadEnvelope(); }
  catch (e) { alert('The Excel template is locked, and the password can only be checked while you are online. Connect to the internet and try again.'); return null; }
  return xlsmPrompt({ title: 'Security password', intro: 'The macro-enabled Excel file is protected. Enter the security password to download it.', button: 'Unlock & download', tryFn: async pass => { const bytes = await xlsmDecrypt(cur.env, pass); _xlsmFails = 0; return bytes; } });
}

/* ───────── Admin Panel → Password management ───────── */
function pwmMsg(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html || ''; }
const pwmWarn = t => `<div class="alert-box alert-warn">⚠️ ${escHtml(t)}</div>`, pwmOk = t => `<div class="alert-box alert-suc">✅ ${escHtml(t)}</div>`;

async function pwmRender() {
  const host = document.getElementById('pwm-body'); if (!host) return;
  host.innerHTML = '<div class="alert-box alert-info">⏳ Loading…</div>';
  let cur = null, err = '';
  try { cur = await xlsmLoadEnvelope(true); } catch (e) { err = 'Cannot reach Supabase right now.'; }
  const starting = cur && cur.source === 'starting';
  host.innerHTML = `
    <div class="pwm-note">The macro-enabled Excel file (<b>📥 Excel (.xlsm)</b> in History) is stored <b>encrypted</b>. It can be downloaded only after entering the security password below.
      The password itself is not stored anywhere — it unlocks the file, so <b>if it is lost the file cannot be opened</b> (you could then upload the template again).</div>
    ${err ? pwmWarn(err) : ''}
    ${starting ? '<div class="alert-box alert-warn">⚠️ Still using the <b>starting password</b> that came with this version. Change it now.</div>'
              : (cur ? `<div class="pwm-dim">Password last changed ${escHtml(cur.updated ? new Date(cur.updated).toLocaleString() : '—')} by ${escHtml(cur.by || '—')}.</div>` : '')}
    <div class="pwm-card"><h4>Change the security password</h4><div id="pwm-chg-msg"></div>
      <input type="password" id="pwm-old" class="pwm-in" placeholder="Current password" autocomplete="off">
      <input type="password" id="pwm-new" class="pwm-in" placeholder="New password (min ${XLSM_MIN_LEN} characters)" autocomplete="off">
      <input type="password" id="pwm-new2" class="pwm-in" placeholder="Repeat new password" autocomplete="off">
      <button class="btn btn-primary" id="pwm-chg-btn" onclick="pwmChange()">🔑 Change password</button>
      <div class="pwm-dim">Use a long phrase — someone who copies the encrypted file can try guesses offline, so a short or common password can be broken. Tell the new password only to the people who may download the file.</div></div>
    <div class="pwm-card"><h4>Replace the macro template</h4><div id="pwm-rep-msg"></div>
      <div class="pwm-dim" style="margin-bottom:6px">When you have a new <b>.xlsm</b> (for example one whose macro no longer contains the SQL password), choose it here. It is encrypted with the current password and replaces the one in use.</div>
      <input type="file" id="pwm-file" accept=".xlsm" class="pwm-in">
      <input type="password" id="pwm-rep-pass" class="pwm-in" placeholder="Current password" autocomplete="off">
      <button class="btn btn-primary" id="pwm-rep-btn" onclick="pwmReplace()">📤 Encrypt &amp; replace template</button></div>`;
}

async function pwmChange() {
  const o = document.getElementById('pwm-old').value, n = document.getElementById('pwm-new').value, n2 = document.getElementById('pwm-new2').value, btn = document.getElementById('pwm-chg-btn');
  if (!o || !n) return pwmMsg('pwm-chg-msg', pwmWarn('Fill in the current and the new password.'));
  if (n.length < XLSM_MIN_LEN) return pwmMsg('pwm-chg-msg', pwmWarn('The new password needs at least ' + XLSM_MIN_LEN + ' characters.'));
  if (n !== n2) return pwmMsg('pwm-chg-msg', pwmWarn('The two new passwords are not the same.'));
  if (n === o) return pwmMsg('pwm-chg-msg', pwmWarn('The new password is the same as the current one.'));
  btn.disabled = true; pwmMsg('pwm-chg-msg', '<div class="alert-box alert-info">⏳ Checking and re-encrypting… (a few seconds)</div>');
  try {
    const cur = await xlsmLoadEnvelope(true);
    let bytes; try { bytes = await xlsmDecrypt(cur.env, o); } catch (e) { return pwmMsg('pwm-chg-msg', pwmWarn('The current password is wrong.')); }
    await xlsmSave(await xlsmEncrypt(bytes, n));
    ['pwm-old', 'pwm-new', 'pwm-new2'].forEach(id => { document.getElementById(id).value = ''; });
    await pwmRender(); pwmMsg('pwm-chg-msg', pwmOk('Password changed. The old password no longer opens the file.'));
  } catch (e) { pwmMsg('pwm-chg-msg', pwmWarn((/app_settings|relation|schema/i.test(e.message || '') ? 'Could not save — run supabase/app_settings.sql once in the Supabase SQL Editor. ' : 'Could not save: ') + (e.message || e))); }
  finally { btn.disabled = false; }
}

async function pwmReplace() {
  const f = (document.getElementById('pwm-file').files || [])[0], pass = document.getElementById('pwm-rep-pass').value, btn = document.getElementById('pwm-rep-btn');
  if (!f) return pwmMsg('pwm-rep-msg', pwmWarn('Choose the .xlsm file first.'));
  if (!/\.xlsm$/i.test(f.name)) return pwmMsg('pwm-rep-msg', pwmWarn('That is not an .xlsm file.'));
  if (!pass) return pwmMsg('pwm-rep-msg', pwmWarn('Enter the current password.'));
  if (f.size > 5 * 1024 * 1024) return pwmMsg('pwm-rep-msg', pwmWarn('The file is larger than 5 MB.'));
  btn.disabled = true; pwmMsg('pwm-rep-msg', '<div class="alert-box alert-info">⏳ Checking the file and encrypting…</div>');
  try {
    const cur = await xlsmLoadEnvelope(true);
    try { await xlsmDecrypt(cur.env, pass); } catch (e) { return pwmMsg('pwm-rep-msg', pwmWarn('The current password is wrong.')); }
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4B) return pwmMsg('pwm-rep-msg', pwmWarn('That file is not a valid Excel file.'));
    const zip = await JSZip.loadAsync(bytes);
    if (!zip.file('xl/vbaProject.bin')) return pwmMsg('pwm-rep-msg', pwmWarn('This file has no macros (vbaProject.bin). Choose the macro-enabled template.'));
    if (!zip.file('xl/worksheets/sheet1.xml')) return pwmMsg('pwm-rep-msg', pwmWarn('This file has no first worksheet.'));
    await xlsmSave(await xlsmEncrypt(bytes, pass));
    document.getElementById('pwm-file').value = ''; document.getElementById('pwm-rep-pass').value = '';
    await pwmRender(); pwmMsg('pwm-rep-msg', pwmOk('Template replaced (' + Math.round(bytes.length / 1024) + ' KB), protected by the current password.'));
  } catch (e) { pwmMsg('pwm-rep-msg', pwmWarn('Could not replace it: ' + (e.message || e))); }
  finally { btn.disabled = false; }
}
