/* VibeMon — back-to-source-tab navigation for Data Entry */

// ============================================================
// VIBREMON v28 — BULK UPLOAD FIXES: createdOn timestamp, schedule log offline, dept auto-fetch
// ============================================================

/* ── Navigation state — which tab opened Data Entry ── */
let _entrySourceTab = null;
let _entrySourceFilters = {};

/* Feature 14: openEquipmentForEntry(equipmentId, sourceTab) */
function openEquipmentForEntry(equipName, sourceTab) {
  if (AUTH.role === 'viewer') { alert('Viewers cannot take readings. Please login as Engineer or Admin.'); return; }
  const eq = MASTER.find(m => m.name === equipName);
  if (!eq) { showToast('Equipment not found in master: ' + equipName, 'red'); return; }
  _entrySourceTab = sourceTab || null;
  _entrySourceFilters.scrollY = window.scrollY;
  showTab('entry');
  selectEquip(eq);
  // Show/hide back-to-source button
  _updateEntryBackBtn();
}

function _updateEntryBackBtn() {
  const backDiv = document.getElementById('entry-back-source');
  if (backDiv) {
    if (_entrySourceTab) {
      const tabNames = {daily:'Daily Schedule', missed:'Missed Readings', history:'History'};
      const btn = backDiv.querySelector('button');
      if (btn) btn.textContent = '← Back to ' + (tabNames[_entrySourceTab] || _entrySourceTab);
      backDiv.style.display = 'block';
    } else {
      backDiv.style.display = 'none';
    }
  }
}

function returnToSourceTab() {
  if (_entrySourceTab) {
    const src = _entrySourceTab;
    _entrySourceTab = null;
    showTab(src);
    try { refreshDailySchedule(); } catch(e){}
    try { refreshMissedReading(); } catch(e){}
    if (_entrySourceFilters.scrollY) {
      setTimeout(()=>{ window.scrollTo(0, _entrySourceFilters.scrollY); _entrySourceFilters.scrollY=0; }, 200);
    }
  } else {
    showTab('entry');
  }
  const backDiv = document.getElementById('entry-back-source');
  if (backDiv) backDiv.style.display = 'none';
}

/* Feature 9: View history filtered to one equipment */
function viewEquipHistory(equipName) {
  showTab('history');
  const searchEl = document.getElementById('h-search');
  if (searchEl) { searchEl.value = equipName; }
  renderHistory();
}

/* Feature 10 / 14: Refresh schedule pages */
function refreshDailySchedule() { try { dsRender(); } catch(e) {} }
function refreshPendingSchedule() { /* removed */ }
function refreshMissedReading() { try { mrRender(); } catch(e) {} }

/* Feature 15: After saving, return to source tab.
   We patch goStep to detect the post-save return to step 1. */
(function(){
  const _origGoStep = window.goStep;
  window.goStep = function(n) {
    _origGoStep(n);
    if (n === 1 && _entrySourceTab && !entryEquip) {
      const src = _entrySourceTab;
      _entrySourceTab = null;
      setTimeout(() => {
        showTab(src);
        try { refreshDailySchedule(); } catch(e){}
        try { refreshPendingSchedule(); } catch(e){}
        try { refreshMissedReading(); } catch(e){}
        if (_entrySourceFilters.scrollY) {
          setTimeout(()=>{ window.scrollTo(0, _entrySourceFilters.scrollY); _entrySourceFilters.scrollY=0; }, 200);
        }
      }, 300);
    }
  };
})();
