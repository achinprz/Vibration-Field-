/* VibeMon — AI severity/recommendation suggestion (cloud prediction service) */

// Built-in service address + key, so every device works with no per-device setup.
// (The key is visible to anyone who views this file — acceptable here because the service only
// exposes a vibration classifier, no plant data and no writes, and is rate-limited to 120
// requests/min. If it is ever abused: change VIBEMON_API_KEY in Render, then update it below.)
// Admin Panel → AI Prediction Service can still override these on one device (optional).
const AI_DEFAULT_URL = 'https://vibemon-predict.onrender.com';
const AI_DEFAULT_KEY = '7hBkUYYgNjT0hYXpJHYb0zaaV4WYwT6bXHepyYP532c=';
const AI_URL_KEY = 'vibemon_ai_url';
const AI_KEY_KEY = 'vibemon_ai_key';
const AI_MAX_RECS = 3;

function getAIServiceUrl() {
  try { return (localStorage.getItem(AI_URL_KEY) || AI_DEFAULT_URL || '').replace(/\/+$/, ''); }
  catch(e) { return AI_DEFAULT_URL; }
}
function getAIServiceKey() {
  try { return localStorage.getItem(AI_KEY_KEY) || AI_DEFAULT_KEY; }
  catch(e) { return AI_DEFAULT_KEY; }
}
function saveAIServiceConfig() {
  const url = (document.getElementById('ai-service-url')?.value || '').trim();
  const key = (document.getElementById('ai-service-key')?.value || '').trim();
  try {
    if (url) localStorage.setItem(AI_URL_KEY, url); else localStorage.removeItem(AI_URL_KEY);
    if (key) localStorage.setItem(AI_KEY_KEY, key); else localStorage.removeItem(AI_KEY_KEY);
  } catch(e) {}
  const box = document.getElementById('ai-service-result');
  if (box) box.innerHTML = '<div class="alert-box alert-suc">✅ Override saved to this browser only.</div>';
}
function clearAIServiceConfig() {
  try { localStorage.removeItem(AI_URL_KEY); localStorage.removeItem(AI_KEY_KEY); } catch(e) {}
  const u = document.getElementById('ai-service-url'); if (u) u.value = '';
  const k = document.getElementById('ai-service-key'); if (k) k.value = '';
  const box = document.getElementById('ai-service-result');
  if (box) box.innerHTML = '<div class="alert-box alert-suc">✅ Override cleared — using the built-in service address and key.</div>';
}
async function testAIServiceConnection() {
  const box = document.getElementById('ai-service-result');
  const url = getAIServiceUrl();
  if (!box) return;
  if (!url) { box.innerHTML = '<div class="alert-box alert-warn">⚠️ No AI service URL configured.</div>'; return; }
  box.innerHTML = '<div class="alert-box alert-info">⏳ Testing AI service (a sleeping free-tier server can take ~50 s to wake)…</div>';
  try {
    const res = await fetch(url + '/health');
    const data = await res.json();
    box.innerHTML = `<div class="alert-box alert-suc">✅ AI service reachable. Model loaded: ${data.model_loaded ? 'yes' : 'no'}${data.trained ? ', trained through ' + data.trained : ''}.</div>`;
  } catch(e) {
    box.innerHTML = `<div class="alert-box alert-warn">⚠️ Could not reach AI service: ${e.message}</div>`;
  }
}

// ---------------------------------------------------------------------------------------------
//  Who sees the AI feature.  Admin: always.  Operators (role 'editor'): only while the admin has
//  switched "AI suggestions for operators" ON. The switch lives in Supabase (table app_settings,
//  key 'ai_for_operators') so it applies to every device at once.
//  No false hope: nothing is remembered on the device. Until Supabase CONFIRMS the switch is ON the
//  AI button stays hidden for operators, and the switch is re-read every time Data Entry step 3
//  opens, every time the app comes back to the foreground, and again just before a suggestion is
//  requested — so an operator who left the app open still loses it right after the admin turns it off.
// ---------------------------------------------------------------------------------------------
window.AI_OPERATORS_ENABLED = false;

function aiVisibleForCurrentUser() {
  if (typeof AUTH === 'undefined' || !AUTH.loggedIn) return false;
  if (AUTH.role === 'admin') return true;
  return AUTH.role === 'editor' && window.AI_OPERATORS_ENABLED === true;
}
function applyAIVisibility() {
  const card = document.getElementById('wizard-ai-card');
  if (card) card.style.display = aiVisibleForCurrentUser() ? '' : 'none';
  const note = document.getElementById('wizard-ai-note');
  if (note) note.textContent = (typeof AUTH !== 'undefined' && AUTH.role === 'admin' && window.AI_OPERATORS_ENABLED !== true)
    ? '👁 Only admins see this — AI suggestions are switched OFF for operators.' : '';
}
function syncAIOperatorToggle() {
  const cb = document.getElementById('ai-operator-toggle');
  if (cb) cb.checked = window.AI_OPERATORS_ENABLED === true;
}
async function fetchAppSettings() {
  try {
    const { data, error } = await _supabase.from('app_settings').select('key,value');
    if (error) throw error;
    const m = {};
    (data || []).forEach(r => { m[r.key] = r.value; });
    window.AI_OPERATORS_ENABLED = (m['ai_for_operators'] === 'on');
  } catch(e) {
    window.AI_OPERATORS_ENABLED = false;   // cannot confirm it is ON -> treat as OFF
    console.warn('app_settings unavailable — AI hidden for operators (run supabase/app_settings.sql if this is a new database):', e.message);
  }
  applyAIVisibility();
  syncAIOperatorToggle();
  try { aiWarmUp(); } catch(e) {}
  return true;
}
function refreshAIVisibility() { applyAIVisibility(); return fetchAppSettings(); }
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && typeof AUTH !== 'undefined' && AUTH.loggedIn) fetchAppSettings();
});
async function setAIOperatorAccess(enabled) {
  const msg = document.getElementById('ai-operator-status');
  if (typeof AUTH === 'undefined' || AUTH.role !== 'admin') return;
  const { error } = await _supabase.from('app_settings').upsert({
    key: 'ai_for_operators', value: enabled ? 'on' : 'off',
    updated_by: AUTH.username, updated_on: new Date().toISOString()
  }, { onConflict: 'key' });
  if (error) {
    syncAIOperatorToggle();
    if (msg) msg.innerHTML = `<div class="alert-box alert-warn">⚠️ Could not save: ${error.message}<br><small>Run <code>supabase/app_settings.sql</code> once in the Supabase SQL Editor, then try again.</small></div>`;
    return;
  }
  window.AI_OPERATORS_ENABLED = enabled;
  applyAIVisibility();
  if (msg) msg.innerHTML = `<div class="alert-box alert-suc">✅ AI suggestions are now <b>${enabled ? 'ON' : 'OFF'}</b> for operators (admins always see them). Operators lose or gain the button the next time they open Data Entry step 3 or bring the app to the front.</div>`;
}
// Label_Source provenance — mirrors the plant dashboard's window._aiAcceptedForSession
// (VibeMon_Migration_Package/.../01_Dashboard_Website/vibration_dashboard.js). true only
// between clicking "Use This Suggestion" and the next save; reset whenever a new equipment
// is selected, a fresh suggestion is fetched, or a session is saved — so it can never carry
// over onto an unrelated report. Keeps a future retrain from learning off the model's own
// accepted-as-is suggestions instead of genuine independent human judgement.
window._aiAcceptedForSession = false;
window._lastAISeverity = '';
window._lastAIRecommendations = [];

function aggregateEntryReadingsForAI() {
  let h_vel=0, v_vel=0, a_vel=0, acc=0, h_dis=0, v_dis=0, a_dis=0;
  if (entryEquip && entryEquip.points) {
    entryEquip.points.forEach(pt => {
      const r = entryReadings[pt] || {};
      h_vel = Math.max(h_vel, parseFloat(r.H_Vel) || 0);
      v_vel = Math.max(v_vel, parseFloat(r.V_Vel) || 0);
      a_vel = Math.max(a_vel, parseFloat(r.A_Vel) || 0);
      acc   = Math.max(acc,   parseFloat(r.Acc)   || 0);
      h_dis = Math.max(h_dis, parseFloat(r.H_Dis) || 0);
      v_dis = Math.max(v_dis, parseFloat(r.V_Dis) || 0);
      a_dis = Math.max(a_dis, parseFloat(r.A_Dis) || 0);
    });
  }
  return { H_Vel:h_vel, V_Vel:v_vel, A_Vel:a_vel, Acc:acc, H_Dis:h_dis, V_Dis:v_dis, A_Dis:a_dis };
}

// Up to AI_MAX_RECS distinct actions for this session.
// Current service: it returns them ready-made in r.recommendations (bearing action, then every action the readings
// trigger, then the model's own pick). Older service versions returned only ONE action whenever acceleration was >= 1.0 g
// (the bearing rule overwrote the rest), even though r.diagnostics named several causes — so for those we rebuild the
// missing actions from the diagnostics text, using the same rule texts as the plant trainer.
const AI_DIAG_ACTIONS = [
  [/bearing wear|gear tooth defect/i, 'Inspect and lubricate DE & NDE bearings. Replace bearing if wear/clearance is excessive.'],
  [/misalignment/i, 'Check and correct shaft/coupling alignment. Tighten coupling bolts.'],
  [/unbalance|fouling|cavitation/i, 'Inspect rotor/impeller for material build-up, erosion, or mechanical damage. Perform dynamic balancing.'],
  [/foundation looseness|resonance/i, 'Check and tighten foundation anchor bolts, baseplate mountings, and support structures.']
];
function collectAIRecommendations(r) {
  const out = [], seen = new Set();
  const add = t => {
    t = String(t || '').trim();
    const k = t.toLowerCase().replace(/\s+/g, ' ');
    if (t && !seen.has(k)) { seen.add(k); out.push(t); }
  };
  if (Array.isArray(r.recommendations) && r.recommendations.length) {
    r.recommendations.forEach(add);
    return out.slice(0, AI_MAX_RECS);
  }
  add(r.bearing_action);
  const diag = String(r.diagnostics || '');
  if (!/^Anomalous - .*decoupled|solo run/i.test(diag)) {
    AI_DIAG_ACTIONS.forEach(([rx, action], i) => {
      if (i === 0 && r.bearing_action) return;      // the bearing action above already covers bearing wear
      if (rx.test(diag)) add(action);
    });
  }
  String(r.universal_recommendation || '').split('|').forEach(add);
  add(r.predicted_recommendation);
  return out.slice(0, AI_MAX_RECS);
}

// The free cloud plan puts the AI server to sleep after ~15 idle minutes and waking it takes up to 1–2 minutes.
// So: (1) wake it in the background as soon as an allowed user is signed in / opens step 3, and (2) before a real
// request, wake it explicitly by retrying the tiny /health call (with a live counter) instead of one long request
// that can time out.
let _aiLastAwake = 0, _aiWarming = false;
const AI_AWAKE_MS = 8 * 60 * 1000;
async function aiPing(timeoutMs) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(getAIServiceUrl() + '/health', { signal: ctrl.signal, cache: 'no-store' });
    if (res.ok) { _aiLastAwake = Date.now(); return true; }
  } catch(e) { /* asleep, starting, or offline — the caller retries */ }
  finally { clearTimeout(timer); }
  return false;
}
function aiWarmUp() {
  if (_aiWarming || !getAIServiceUrl() || !aiVisibleForCurrentUser() || !navigator.onLine) return;
  if (Date.now() - _aiLastAwake < AI_AWAKE_MS) return;
  _aiWarming = true;
  aiPing(90000).finally(() => { _aiWarming = false; });
}
async function aiWake(maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (Date.now() - _aiLastAwake < AI_AWAKE_MS) return true;
    if (await aiPing(45000)) return true;
    await new Promise(r => setTimeout(r, 3000));
  }
  return false;
}
async function queryAIForWizard() {
  if (!entryEquip) return;
  window._aiAcceptedForSession = false;   // a freshly-fetched suggestion needs its own accept

  const box = document.getElementById('wizard-ai-box');
  const btn = document.getElementById('wizard-ai-btn');
  await fetchAppSettings();   // the admin may have switched AI off since this screen was opened
  if (!aiVisibleForCurrentUser()) {
    if (typeof showToast === 'function') showToast('AI suggestions have been switched off by the admin.', 'blue');
    return;
  }
  const url = getAIServiceUrl();
  if (!url) {
    if (box) { box.style.display='block'; box.innerHTML = '<div class="alert-box alert-warn">⚠️ AI service address is not configured.</div>'; }
    return;
  }
  if (btn) btn.textContent = '⏳ Analyzing...';
  const say = (cls, html) => { if (box) { box.style.display = 'block'; box.innerHTML = `<div class="alert-box ${cls}">${html}</div>`; } };
  say('alert-info', '⏳ Contacting the AI server…');

  const t0 = Date.now();
  const ticker = setInterval(() => {
    const secs = Math.round((Date.now() - t0) / 1000);
    if (secs >= 4) say('alert-info', `⏳ Waking up the AI server — the first request after a quiet period takes up to 1–2 minutes (${secs} s)…`);
  }, 1000);
  let awake = false;
  try { awake = await aiWake(150000); } finally { clearInterval(ticker); }
  if (!awake) {
    say('alert-warn', '⚠️ The AI server did not wake up in time. Please tap “Get AI Suggestion” again in a minute.');
    if (btn) btn.textContent = '🤖 Get AI Suggestion';
    return;
  }
  say('alert-info', '⏳ Asking the AI model…');

  const agg = aggregateEntryReadingsForAI();
  const payload = {
    equipment: entryEquip.name,
    category: entryEquip.category || 'OTHER',
    dept: entryEquip.dept || 'UNKNOWN',
    area: entryEquip.area || '',
    rpm: parseFloat(entryEquip.rpm) || 0,
    ...agg,
    decoupled: isDecoupledMode() ? 'Yes' : 'No'
  };

  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {   // one retry for a network hiccup or a 5xx while the server settles
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 40000);
    try {
      const res = await fetch(url + '/api/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': getAIServiceKey() },
        body: JSON.stringify(payload),
        signal: ctrl.signal
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const err = new Error(errBody.error || errBody.detail || `AI service returned ${res.status}`);
        err.status = res.status;
        throw err;
      }
      const data = await res.json();
      _aiLastAwake = Date.now();
      window._lastAISeverity = data.predicted_severity || 'NORMAL';
      window._lastAIRecommendations = collectAIRecommendations(data);
      renderAISuggestionBox(data, box);
      lastErr = null;
      break;
    } catch(e) {
      lastErr = e;
      if (e.status && e.status < 500) break;        // 4xx (bad key, bad request): retrying cannot help
      if (attempt === 0) await new Promise(r => setTimeout(r, 3000));
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastErr) say('alert-warn', `⚠️ AI suggestion unavailable: ${lastErr.name === 'AbortError' ? 'the service did not answer in time — please try again' : lastErr.message}`);
  if (btn) btn.textContent = '🤖 Get AI Suggestion';
}
const AI_SEV_COLOR = { NORMAL:'#1E8449', ALARM:'#92400E', ALERT:'#9A3412', CRITICAL:'#991B1B' };
const AI_SEV_SOURCE_LABEL = {
  'model': 'machine learning',
  'decoupled-rule': 'decoupled solo-run limits',
  'model+acc-rule': 'machine learning + acceleration rule',
  'expert-escalation': 'ISO 20816 escalation',
  'expert-no-model': 'ISO 20816 (no model for this machine)'
};

function renderAISuggestionBox(r, box) {
  if (!box) return;
  box.style.display = 'block';
  const color = AI_SEV_COLOR[r.predicted_severity] || 'var(--text-main,var(--text))';
  const hc = r.history_context || {};
  const src = AI_SEV_SOURCE_LABEL[r.severity_source] || r.severity_source || '';
  const recs = window._lastAIRecommendations || [];
  box.innerHTML = `
    <div style="border-left:4px solid ${color};padding:10px 12px;background:var(--bg-page);border:1px solid var(--border);border-radius:6px;font-size:12px">
      <div style="font-size:15px;font-weight:700;color:${color}">
        ${escHtml(r.predicted_severity)}
        ${r.predicted_severity_confidence!=null ? `<span style="font-size:11px;font-weight:400;color:var(--text-muted,var(--muted))"> — ${r.predicted_severity_confidence}% confidence${src?' · decided by '+escHtml(src):''}</span>` : ''}
      </div>
      ${r.diagnostics ? `<div style="margin-top:6px;color:var(--text-main,var(--text))"><b>Diagnosis:</b> ${escHtml(r.diagnostics)}</div>` : ''}
      ${recs.length ? `<div style="margin-top:8px;padding:8px;background:rgba(0,0,0,0.03);border-radius:4px;color:var(--text-main,var(--text))">
        <b>Recommended action${recs.length>1?'s ('+recs.length+')':''}:</b>
        <ol style="margin:4px 0 0 18px;padding:0">${recs.map(t => `<li style="margin-bottom:3px">${escHtml(t)}</li>`).join('')}</ol></div>` : ''}
      ${hc.available && (hc.trend_alert || hc.acc_trend_alert) ? `
        <div style="margin-top:8px;padding:8px;border-radius:4px;background:#FFF3CD;color:#92400E">
          <b>⚠ Trend against this machine's own history</b><br>
          ${hc.trend_alert ? escHtml(hc.note||'') + '<br>' : ''}${hc.acc_trend_alert ? escHtml(hc.acc_note||'') : ''}
        </div>` : ''}
      ${r.decoupled ? `<div style="margin-top:6px;font-size:11px;color:var(--text-muted,var(--muted))">Decoupled solo run — graded against motor limits${r.decoupled_bands ? ` (alarm ${r.decoupled_bands.alarm} · alert ${r.decoupled_bands.alert} · critical ${r.decoupled_bands.critical} mm/s)` : ''}</div>` : ''}
      ${r.equipment_known_to_model === false ? `<div style="margin-top:6px;font-size:11px;color:#92400E">ⓘ ${escHtml(r.note||'No history for this equipment in the deployed model.')}</div>` : ''}
      <div style="margin-top:10px">
        <button class="btn btn-sm" onclick="applyAISuggestionToWizard()" style="background:#059669;color:#fff;border:none">✅ Use This Suggestion (severity${recs.length ? ' + '+recs.length+' recommendation'+(recs.length>1?'s':'') : ''})</button>
      </div>
    </div>`;
}

function applyAISuggestionToWizard() {
  window._aiAcceptedForSession = true;
  const have = new Set(entryRecs.map(r => String(r.value || '').trim().toLowerCase().replace(/\s+/g, ' ')));
  (window._lastAIRecommendations || []).forEach(t => {
    const k = t.toLowerCase().replace(/\s+/g, ' ');
    if (!have.has(k)) { entryRecs.push({ type:'ai', value: t }); have.add(k); }
  });
  renderRecItems();
  const sevSelect = document.getElementById('s4-sev-override');
  if (sevSelect && window._lastAISeverity) sevSelect.value = window._lastAISeverity;
  const box = document.getElementById('wizard-ai-box');
  if (box) box.style.display = 'none';
  if (typeof showToast === 'function') showToast('✅ AI suggestion applied — will be recorded as AI_ACCEPTED on save.', 'green');
}
