/* VibeMon — wires the equipment autocomplete dropdown to every equipment search box */

// Each box suggests only equipment that pass the filters currently applied on its own screen
// (unit / area / group / days / dates ...), matched against what has been typed so far.
// Equipment details (unit, area, dept) come from the Equipment Master (MASTER).

function _acVal(id) { const el = document.getElementById(id); return el ? el.value : ''; }

function _acCtx(pairs) {
  return pairs.filter(p => p[1]).map(p => p[0] + ': ' + p[1]).join(' · ');
}

function _acMasterItems(unit, area) {
  return MASTER
    .filter(e => (!unit || e.unit === unit) && (!area || e.area === area))
    .map(e => ({ name: e.name, unit: e.unit, area: e.area, meta: e.dept || '' }));
}

function initEquipSearchDropdowns() {
  // ── Data Entry: equipment list ─────────────────────────────────────────────
  attachEquipAutocomplete('e-search', {
    source: () => _acMasterItems(_acVal('e-unit'), _acVal('e-area')),
    context: () => _acCtx([['Unit', _acVal('e-unit')], ['Area', _acVal('e-area')]]),
    onPick: () => filterEntryList(),
    onEnter: () => filterEntryList()
  });

  // ── Template Builder modal ────────────────────────────────────────────────
  attachEquipAutocomplete('tb-search', {
    source: () => _acMasterItems(_acVal('tb-unit'), _acVal('tb-area')),
    context: () => _acCtx([['Unit', _acVal('tb-unit')], ['Area', _acVal('tb-area')]]),
    onPick: () => renderTemplateEquipList(),
    onEnter: () => renderTemplateEquipList()
  });

  // ── History: every equipment in the Master (narrowed by Unit / Area). Equipment that have
  //    readings matching ALL applied filters (dates, user, severity ...) are listed first;
  //    the rest follow greyed-out so the dropdown is never empty for a valid equipment name.
  attachEquipAutocomplete('h-search', {
    source: () => {
      const from = _acVal('h-from'), to = _acVal('h-to');
      const unit = _acVal('h-unit'), area = _acVal('h-area');
      const user = _acVal('h-user'), sev = _acVal('h-sev'), dec = _acVal('h-decoupled');
      const hit = new Map();   // equipment name -> first reading that matches every applied filter
      READINGS.forEach(r => {
        if (!r.equipment || hit.has(r.equipment)) return;
        if (from && r.date < from) return;
        if (to && r.date > to) return;
        if (unit && r.unit !== unit) return;
        if (area && r.area !== area) return;
        if (user && r.username !== user && r.inspector !== user) return;
        if (sev && r.severity !== sev) return;   // session severity is the worst reading, so this never hides a valid match
        if (dec === 'yes' && !(r.isDecoupled || (r.remarks && r.remarks.includes('Decoupled Trial')))) return;
        hit.set(r.equipment, r);
      });
      const items = [], seen = new Set();
      MASTER.forEach(e => {
        if ((unit && e.unit !== unit) || (area && e.area !== area)) return;
        seen.add(e.name);
        const has = hit.has(e.name) || !READINGS.length;
        items.push({ name: e.name, unit: e.unit, area: e.area, meta: has ? (e.dept || '') : 'no readings for filters', dim: !has });
      });
      hit.forEach((r, name) => {   // equipment that appear in readings but are missing from the Master
        if (!seen.has(name)) items.push({ name, unit: r.unit, area: r.area, meta: '' });
      });
      return items;
    },
    context: () => _acCtx([
      ['Dates', (_acVal('h-from') || '…') + ' → ' + (_acVal('h-to') || '…')],
      ['Unit', _acVal('h-unit')], ['Area', _acVal('h-area')], ['User', _acVal('h-user')],
      ['Severity', _acVal('h-sev')], ['Decoupled', _acVal('h-decoupled') === 'yes' ? 'trial only' : '']
    ]),
    onPick: () => renderHistory(),
    onEnter: () => renderHistory()
  });

  // ── Missed Readings: rows that pass group / unit / area / days filters ────
  attachEquipAutocomplete('mr-f-search', {
    source: () => {
      const group = _acVal('mr-f-group'), unit = _acVal('mr-f-unit'), area = _acVal('mr-f-area');
      const daysMin = parseInt(_acVal('mr-f-days') || '0', 10);
      return _mrAllRows.filter(r =>
        (!group || r.responsibleGroup.includes(group)) &&
        (!unit || r.unit === unit) &&
        (!area || r.area === area) &&
        (!daysMin || (r.daysSince !== null && r.daysSince >= daysMin))
      ).map(r => ({
        name: r.name, unit: r.unit, area: r.area,
        meta: r.daysSince === null || r.daysSince >= 9999 ? 'Never read' : r.daysSince + 'd since'
      }));
    },
    // The Missed Readings filter also matches unit / area text, so the dropdown does too.
    fields: it => [it.name, it.unit, it.area].join(' '),
    context: () => _acCtx([
      ['Group', _acVal('mr-f-group')], ['Unit', _acVal('mr-f-unit')], ['Area', _acVal('mr-f-area')],
      ['Days', _acVal('mr-f-days') ? _acVal('mr-f-days') + '+' : '']
    ]),
    onPick: () => mrApplyFilters(),
    onEnter: () => mrApplyFilters()
  });
}

initEquipSearchDropdowns();
