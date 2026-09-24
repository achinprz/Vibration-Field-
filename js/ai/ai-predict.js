/* VibeMon — AI severity/recommendation suggestion (cloud prediction service) */

// Admin-configurable: URL + key are read from localStorage at call time. Unlike the
// Supabase settings box (js/auth/auth.js saveSupabaseConfig — stored for display only,
// never read back), this one actually drives the fetch below.
const AI_URL_KEY = 'vibemon_ai_url';
const AI_KEY_KEY = 'vibemon_ai_key';
// Set once cloud/vibemon_predict_api.py is deployed (see its DEPLOY_GUIDE.md), or leave
// blank and configure it from Admin Panel → AI Prediction Service instead.
const AI_DEFAULT_URL = '';
const AI_DEFAULT_KEY = '';

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
  if (box) box.innerHTML = '<div class="alert-box alert-suc">✅ AI service config saved to this browser.</div>';
}
function clearAIServiceConfig() {
  try { localStorage.removeItem(AI_URL_KEY); localStorage.removeItem(AI_KEY_KEY); } catch(e) {}
  const u = document.getElementById('ai-service-url'); if (u) u.value = '';
  const k = document.getElementById('ai-service-key'); if (k) k.value = '';
  const box = document.getElementById('ai-service-result');
  if (box) box.innerHTML = '<div class="alert-box alert-warn">⚠️ Cleared from this browser.</div>';
}
async function testAIServiceConnection() {
  const box = document.getElementById('ai-service-result');
  const url = getAIServiceUrl();
  if (!box) return;
  if (!url) { box.innerHTML = '<div class="alert-box alert-warn">⚠️ No AI service URL configured yet.</div>'; return; }
  box.innerHTML = '<div class="alert-box alert-info">⏳ Testing AI service...</div>';
  try {
    const res = await fetch(url + '/health');
    const data = await res.json();
    box.innerHTML = `<div class="alert-box alert-suc">✅ AI service reachable. Model loaded: ${data.model_loaded ? 'yes' : 'no'}${data.trained ? ', trained through ' + data.trained : ''}.</div>`;
  } catch(e) {
    box.innerHTML = `<div class="alert-box alert-warn">⚠️ Could not reach AI service: ${e.message}</div>`;
  }
}

// Label_Source provenance — mirrors the plant dashboard's window._aiAcceptedForSession
// (VibeMon_Migration_Package/.../01_Dashboard_Website/vibration_dashboard.js). true only
// between clicking "Use This Suggestion" and the next save; reset whenever a new equipment
// is selected, a fresh suggestion is fetched, or a session is saved — so it can never carry
// over onto an unrelated report. Keeps a future retrain from learning off the model's own
// accepted-as-is suggestions instead of genuine independent human judgement.
window._aiAcceptedForSession = false;
window._lastAISeverity = '';
window._lastAIRecommendation = '';

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

async function queryAIForWizard() {
  if (!entryEquip) return;
  window._aiAcceptedForSession = false;   // a freshly-fetched suggestion needs its own accept

  const box = document.getElementById('wizard-ai-box');
  const btn = document.getElementById('wizard-ai-btn');
  const url = getAIServiceUrl();
  if (!url) {
    if (box) { box.style.display='block'; box.innerHTML = '<div class="alert-box alert-warn">⚠️ AI service not configured yet. Admin: set it under Admin Panel → 🤖 AI Prediction Service.</div>'; }
    return;
  }
  if (btn) btn.textContent = '⏳ Analyzing...';
  if (box) { box.style.display='block'; box.innerHTML = '<div class="alert-box alert-info">⏳ Asking the AI model...</div>'; }

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

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);   // field networks are slow
  try {
    const res = await fetch(url + '/api/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': getAIServiceKey() },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || errBody.detail || `AI service returned ${res.status}`);
    }
    const data = await res.json();
    window._lastAISeverity = data.predicted_severity || 'NORMAL';
    window._lastAIRecommendation = data.predicted_recommendation || '';
    renderAISuggestionBox(data, box);
  } catch(e) {
    if (box) box.innerHTML = `<div class="alert-box alert-warn">⚠️ AI suggestion unavailable: ${e.message}</div>`;
  } finally {
    clearTimeout(timer);
    if (btn) btn.textContent = '🤖 Get AI Suggestion';
  }
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
  const color = AI_SEV_COLOR[r.predicted_severity] || 'var(--text)';
  const hc = r.history_context || {};
  const src = AI_SEV_SOURCE_LABEL[r.severity_source] || r.severity_source || '';
  box.innerHTML = `
    <div style="border-left:4px solid ${color};padding:10px 12px;background:var(--bg-page);border:1px solid var(--border);border-radius:6px;font-size:12px">
      <div style="font-size:15px;font-weight:700;color:${color}">
        ${r.predicted_severity}
        ${r.predicted_severity_confidence!=null ? `<span style="font-size:11px;font-weight:400;color:var(--muted)"> — ${r.predicted_severity_confidence}% confidence${src?' · decided by '+src:''}</span>` : ''}
      </div>
      ${r.diagnostics ? `<div style="margin-top:6px;color:var(--text)"><b>Diagnosis:</b> ${r.diagnostics}</div>` : ''}
      ${r.predicted_recommendation ? `<div style="margin-top:8px;padding:8px;background:rgba(0,0,0,0.03);border-radius:4px;color:var(--text)"><b>Recommended action:</b> ${r.predicted_recommendation}</div>` : ''}
      ${hc.available && (hc.trend_alert || hc.acc_trend_alert) ? `
        <div style="margin-top:8px;padding:8px;border-radius:4px;background:#FFF3CD;color:#92400E">
          <b>⚠ Trend against this machine's own history</b><br>
          ${hc.trend_alert ? (hc.note||'') + '<br>' : ''}${hc.acc_trend_alert ? (hc.acc_note||'') : ''}
        </div>` : ''}
      ${r.decoupled ? `<div style="margin-top:6px;font-size:11px;color:var(--muted)">Decoupled solo run — graded against motor limits${r.decoupled_bands ? ` (alarm ${r.decoupled_bands.alarm} · alert ${r.decoupled_bands.alert} · critical ${r.decoupled_bands.critical} mm/s)` : ''}</div>` : ''}
      ${r.equipment_known_to_model === false ? `<div style="margin-top:6px;font-size:11px;color:#92400E">ⓘ ${r.note||'No history for this equipment in the deployed model.'}</div>` : ''}
      <div style="margin-top:10px">
        <button class="btn btn-sm" onclick="applyAISuggestionToWizard()" style="background:#059669;color:#fff;border:none">✅ Use This Suggestion</button>
      </div>
    </div>`;
}

function applyAISuggestionToWizard() {
  window._aiAcceptedForSession = true;
  if (window._lastAIRecommendation) {
    entryRecs.push({ type:'manual', value: window._lastAIRecommendation });
    renderRecItems();
  }
  const sevSelect = document.getElementById('s4-sev-override');
  if (sevSelect && window._lastAISeverity) sevSelect.value = window._lastAISeverity;
  const box = document.getElementById('wizard-ai-box');
  if (box) box.style.display = 'none';
  if (typeof showToast === 'function') showToast('✅ AI suggestion applied — will be recorded as AI_ACCEPTED on save.', 'green');
}
