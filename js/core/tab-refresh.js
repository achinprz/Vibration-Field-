/* VibeMon — per-tab refresh + applyAuth hook */

// ======= TAB REFRESH (fetches latest data from GSheet then re-renders active tab) =======
async function tabRefresh(tab) {
  // Find the button that triggered this and show spinner feedback
  const btns = document.querySelectorAll(`#tab-${tab} button`);
  let refreshBtn = null;
  btns.forEach(b => { if (b.textContent.includes('Refresh') && !b.textContent.includes('Schedule')) refreshBtn = b; });
  const origText = refreshBtn ? refreshBtn.textContent : '';
  if (refreshBtn) { refreshBtn.textContent = '⏳ Fetching...'; refreshBtn.disabled = true; }

  try {
    // Pull fresh data from Google Sheet
    const result = await _fetchAllFromGS();
    if (result && result.success) {
      populateFilters && populateFilters();
      populateUserFilter && populateUserFilter();
    }
    // Re-render the active tab
    if (tab === 'history')  renderHistory  && renderHistory();
    if (tab === 'entry')    filterEntryList && filterEntryList();
    if (tab === 'daily')    dsRender        && dsRender();
    if (tab === 'missed')   { try{mrRender();}catch(e){} }

    // Brief success flash
    if (refreshBtn) {
      refreshBtn.textContent = '✅ Updated!';
      setTimeout(() => { refreshBtn.textContent = origText; refreshBtn.disabled = false; }, 1800);
    }
  } catch(e) {
    if (refreshBtn) {
      refreshBtn.textContent = '⚠️ Failed';
      setTimeout(() => { refreshBtn.textContent = origText; refreshBtn.disabled = false; }, 2000);
    }
    console.warn('tabRefresh error:', e);
  }
}

// Hook into existing showTab side-effects + auto-refresh after data fetch
(function(){
  const _orig = window.applyAuth;
  if(typeof _orig === 'function'){
    window.applyAuth = function(){ _orig.apply(this, arguments); try{ dsRender(); }catch(e){} };
  }
})();
