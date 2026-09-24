/* VibeMon — global state, fetch/cache of master + readings from Supabase */

let MASTER = [], READINGS = [];
let entryEquip = null, entryReadings = {}, entryRecs = [];

// Fetch Equipment Master from Google Sheet — caches to localStorage for offline use
const _MASTER_CACHE_KEY = 'vibemon_master_cache_v1';
function _restoreMasterFromCache() {
  try {
    const cached = localStorage.getItem(_MASTER_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        MASTER = parsed;
        MASTER.forEach(eq => { if (eq.limits) DYNAMIC_EQUIP_LIMITS[eq.name] = eq.limits; });
        buildEquipmentMap();
        console.log('[Offline] Equipment Master from cache:', MASTER.length);
        return true;
      }
    }
  } catch(e) {}
  MASTER = [];
  return false;
}
async function fetchEquipmentMaster() {
  try {
    const { data, error } = await _supabase
      .from('equipment_master')
      .select('*')
      .order('name');
    if (error) throw error;
    if (data && data.length > 0) {
      MASTER = data.map(eq => ({
        name: eq.name, unit: eq.unit, area: eq.area, dept: eq.dept,
        category: eq.category || 'OTHER',   // fed to the AI prediction API — see supabase/equipment_category.sql
        rpm: eq.rpm, frequency: eq.frequency,
        points: eq.points ? (Array.isArray(eq.points) ? eq.points : JSON.parse(eq.points)) : [],
        params: eq.params ? (Array.isArray(eq.params) ? eq.params : JSON.parse(eq.params)) : [],
        limits: eq.limits ? (typeof eq.limits === 'object' ? eq.limits : JSON.parse(eq.limits)) : null
      }));
      MASTER.forEach(eq => { if (eq.limits) DYNAMIC_EQUIP_LIMITS[eq.name] = eq.limits; });
      try { localStorage.setItem(_MASTER_CACHE_KEY, JSON.stringify(MASTER)); } catch(e) {}
      buildEquipmentMap();
      console.log('Equipment Master loaded from Supabase:', MASTER.length, 'equipments');
      return true;
    }
    console.warn('Equipment Master: Supabase returned no data.');
  } catch(e) {
    console.warn('Equipment Master fetch failed:', e.message);
  }
  return _restoreMasterFromCache();
}

// Fetch Recommendations from Supabase
async function fetchRecommendations() {
  try {
    const { data, error } = await _supabase
      .from('recommendations')
      .select('recommendation')
      .order('id');
    if (error) throw error;
    if (data && data.length > 0) {
      STD_RECS = data.map(r => r.recommendation);
      mergeExtraRecs();
      console.log('Recommendations loaded:', STD_RECS.length);
      return true;
    }
  } catch(e) {
    console.warn('Recommendations fetch failed:', e.message);
  }
  return false;
}

function loadData() {
  READINGS = [];
  const statusEl = document.getElementById('gs-result');
  if (statusEl) statusEl.innerHTML = '<div class="alert-box alert-info">⏳ Initializing connection & fetching data from Supabase...</div>';
  
  Promise.all([
    fetchEquipmentMaster(),
    fetchRecommendations(),
    fetchVibeSchedule(),
    _fetchAllFromGS()
  ])
  .then(async ([masterOk, recsOk, fetchResult]) => {
    populateFilters();
    populateUserFilter && populateUserFilter();
    
    if (fetchResult && fetchResult.success) {
      // Online — remove offline mode
      document.body.classList.remove('offline-mode');
      const msg = `✅ Supabase connected! ${READINGS.length} readings synced successfully.`;
      if (statusEl) statusEl.innerHTML = `<div class="alert-box alert-suc">${msg}</div>`;
      const banner = document.getElementById('gs-setup-banner');
      if(banner) { banner.remove(); const nav=document.querySelector('.nav'); if(nav) nav.style.marginTop=''; }
    } else if (fetchResult && fetchResult.offline) {
      // Offline — entry-only mode
      document.body.classList.add('offline-mode');
      READINGS = []; // no cached readings shown
      if (statusEl) statusEl.innerHTML = `<div class="alert-box alert-warn">📵 Offline Mode — Equipment Master loaded from cache. Take readings and they will sync when internet is restored.</div>`;
      // Force to Data Entry tab — history/schedule tabs are hidden
      showTab('entry');
      try { OfflineQ._refreshPill && OfflineQ._refreshPill(); } catch(e) {}
    } else {
      const errMsg = fetchResult ? fetchResult.error : 'Sync failed';
      if (statusEl) statusEl.innerHTML = `<div class="alert-box alert-warn">⚠️ Sync failed: ${errMsg}<br><small>Check SUPABASE_URL and SUPABASE_ANON_KEY at the top of the HTML file.</small></div>`;
    }
    
    // Refresh UI
    const activeTab = document.querySelector('.screen.active');
    if(activeTab) {
      const id = activeTab.id;
      if(id==='tab-history') renderHistory();
      if(id==='tab-entry') filterEntryList();
      if(id==='tab-daily') dsRender();
            if(id==='tab-missed') { try{mrRender();}catch(e){} }
    }
  })
  .catch((err) => {
    console.warn('Initial data load error:', err);
    if (statusEl) statusEl.innerHTML = `<div class="alert-box alert-warn">⚠️ Initial load error: ${err.message}</div>`;
    const activeTab = document.querySelector('.screen.active');
    if(activeTab) {
      const id = activeTab.id;
      if(id==='tab-history') renderHistory();
      if(id==='tab-entry') filterEntryList();
      if(id==='tab-daily') dsRender();
            if(id==='tab-missed') { try{mrRender();}catch(e){} }
    }
  });
}

function saveReadings() {
  // READINGS are NOT stored in localStorage — Google Sheet is the source of truth.
}

async function manualFetchGS() {
  const res = document.getElementById('gs-result');
  if(res) res.innerHTML='<div class="alert-box alert-info">⏳ Fetching data from Supabase...</div>';
  const result = await _fetchAllFromGS();
  await fetchVibeSchedule();
  if(result.success) {
    const msg = `✅ Sync complete! ${READINGS.length} readings loaded from Supabase.`;
    // Dismiss the setup banner if it exists
    const banner = document.getElementById('gs-setup-banner');
    if(banner) { banner.remove(); const nav=document.querySelector('.nav'); if(nav) nav.style.marginTop=''; }
    if(res) res.innerHTML=`<div class="alert-box alert-suc">${msg}</div>`;
    renderHistory && renderHistory();
    renderDashboard && renderDashboard();
    populateUserFilter && populateUserFilter();
    const activeTab = document.querySelector('.screen.active');
    if(activeTab && activeTab.id==='tab-daily') dsRender();
  } else {
    if(res) res.innerHTML=`<div class="alert-box alert-warn">⚠️ Sync failed: ${result.error}<br><small>Steps to fix:<br>1. Open the HTML file and verify SUPABASE_URL and SUPABASE_ANON_KEY at the top<br>2. Check your Supabase project is active and tables exist<br>3. Confirm Row Level Security policies allow anon reads<br>4. Try clicking 🔄 Refresh again</small></div>`;
  }
}

async function _fetchAllFromGS() {
  try {
    // Paginated fetch — Supabase caps at 1000 rows per request
    let allRows = [];
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await _supabase
        .from('readings')
        .select('*')
        .order('date', { ascending: false })
        .order('created_on', { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      allRows = allRows.concat(data);
      console.log(`Fetched ${allRows.length} readings so far...`);
      if (data.length < PAGE) break;   // last page
      from += PAGE;
    }
    const rows = allRows;
    READINGS = rows.map(r => {
      // Clean timestamps: '2026-07-08T00:20:00+00:00' → '2026-07-08 00:20:00'
      const cleanTS = (ts) => {
        // Convert UTC timestamp from Supabase to local device time (fixes wrong time display)
        if (!ts) return '';
        return _utcToLocal(String(ts));
      };
      return {
        reportId:        r.report_id        || '',
        date:            (r.date || '').slice(0, 10),
        username:        r.username         || '',
        inspector:       r.inspector        || '',
        unit:            r.unit             || '',
        area:            r.area             || '',
        equipment:       r.equipment        || '',
        rpm:             r.rpm              || '',
        frequency:       r.frequency        || '',
        point:           r.point            || '',
        H_Vel:           r.h_vel            || '',
        V_Vel:           r.v_vel            || '',
        A_Vel:           r.a_vel            || '',
        Acc:             r.acc              || '',
        H_Dis:           r.h_dis            || '',
        V_Dis:           r.v_dis            || '',
        A_Dis:           r.a_dis            || '',
        severity:        r.severity         || 'NORMAL',
        recommendations: r.recommendations  || '',
        remarks:         r.remarks          || '',
        responsibleDept: r.responsible_dept || deptFromMaster(r.equipment),
        isDecoupled:     r.is_decoupled     || false,
        createdOn:       cleanTS(r.created_on),
        updatedOn:       cleanTS(r.updated_on)
      };
    });
    saveReadings();
    return { success: true, added: READINGS.length, total: READINGS.length };
  } catch(e) {
    console.log('[Offline] Supabase fetch failed. Offline entry-only mode active.', e.message);
    return { success: false, error: e.message, offline: true };
  }
}

async function fetchFromGS() {
  const result = await _fetchAllFromGS();
  if (result.success) {
    const statusEl = document.getElementById('gs-result');
    if (statusEl) statusEl.innerHTML = `<div class="alert-box alert-suc">✅ Synced from Supabase! ${READINGS.length} records loaded.</div>`;
  }
  const activeTab = document.querySelector('.screen.active');
  if(activeTab) {
    const id = activeTab.id;
    if(id==='tab-history') renderHistory();
    if(id==='tab-entry') filterEntryList();
    if(id==='tab-daily') dsRender();   }
  if(result.success) {
    console.log('Synced ' + result.total + ' records from Supabase');
    populateUserFilter && populateUserFilter();
  } else {
    showGSheetSetupBanner('sync-failed');
  }
}

function showGSheetSetupBanner(reason) {
  // Show a dismissible toast so mobile users know something went wrong
  const existingBanner = document.getElementById('gs-mobile-banner');
  if (existingBanner) return; // already shown
  const banner = document.createElement('div');
  banner.id = 'gs-mobile-banner';
  banner.style.cssText = 'position:fixed;top:56px;left:8px;right:8px;background:#FEF3C7;border:1px solid #F59E0B;border-radius:8px;padding:8px 12px;font-size:11px;color:#92400E;z-index:200;display:flex;align-items:center;justify-content:space-between;gap:8px;box-shadow:0 2px 8px rgba(0,0,0,.12)';
  banner.innerHTML = '<span>⚠️ <strong>Supabase not connected.</strong> Check your internet/mobile data, then pull down to refresh. Verify SUPABASE_URL and SUPABASE_ANON_KEY in the HTML file.</span><button onclick="this.parentElement.remove()" style="border:none;background:none;font-size:16px;cursor:pointer;color:#92400E;flex-shrink:0">✕</button>';
  document.body.appendChild(banner);
  // Auto-dismiss after 8 seconds
  setTimeout(() => { try { banner.remove(); } catch(e){} }, 8000);
}

// (saveReadings defined above — this duplicate removed)
