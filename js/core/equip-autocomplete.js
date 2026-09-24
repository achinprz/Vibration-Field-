/* VibeMon — searchable dropdown (autocomplete) for equipment search boxes */

// attachEquipAutocomplete(inputId, cfg)
//   cfg.source()       -> array of { name, unit, area, meta }  (already narrowed by the
//                         filters currently applied on that screen; NOT by the typed text)
//   cfg.fields(item)   -> optional string that the typed text is matched against
//                         (default: item.name — same as the screen's own list filter)
//   cfg.context()      -> optional string describing the applied filters (shown in the dropdown)
//   cfg.onPick(item)   -> called after the user picks a suggestion (input already holds the name)
//   cfg.onEnter()      -> optional; called when Enter is pressed with no suggestion highlighted
function attachEquipAutocomplete(inputId, cfg) {
  const input = document.getElementById(inputId);
  if (!input || input._acAttached) return;
  input._acAttached = true;
  cfg = cfg || {};
  const MAX_SHOWN = 40;

  input.setAttribute('autocomplete', 'off');
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('spellcheck', 'false');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');

  const panel = document.createElement('div');
  panel.className = 'ac-panel';
  panel.setAttribute('role', 'listbox');
  panel.style.display = 'none';
  document.body.appendChild(panel);

  let shown = [];   // suggestions currently rendered
  let active = -1;  // highlighted index
  let isOpen = false;

  function textOf(item) { return String(cfg.fields ? cfg.fields(item) : item.name || ''); }

  function highlight(text, q) {
    text = String(text == null ? '' : text);
    if (!q) return escHtml(text);
    const lower = text.toLowerCase();
    let out = '', pos = 0, i;
    while ((i = lower.indexOf(q, pos)) !== -1) {
      out += escHtml(text.slice(pos, i)) + '<mark>' + escHtml(text.slice(i, i + q.length)) + '</mark>';
      pos = i + q.length;
    }
    return out + escHtml(text.slice(pos));
  }

  function rank(item, q) {
    const name = String(item.name || '').toLowerCase();
    const i = name.indexOf(q);
    if (i === 0) return 0;                                   // starts with
    if (i > 0 && /[^a-z0-9]/.test(name.charAt(i - 1))) return 1; // starts a word
    return i > 0 ? 2 : 3;                                    // contains in name / only in other fields
  }

  function compute() {
    const q = input.value.toLowerCase();
    let list = [];
    try { list = (cfg.source && cfg.source()) || []; } catch (e) { console.warn('equip autocomplete source failed:', e); }
    const matches = q ? list.filter(it => textOf(it).toLowerCase().includes(q)) : list.slice();
    matches.sort((a, b) => (a.dim ? 1 : 0) - (b.dim ? 1 : 0) ||   // greyed-out (dim) items always last
      (q ? rank(a, q) - rank(b, q) : 0) ||
      String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' }));
    return { q, total: matches.length, universe: list.length, items: matches.slice(0, MAX_SHOWN) };
  }

  function render() {
    const r = compute();
    shown = r.items;
    active = shown.length ? 0 : -1;
    const ctx = cfg.context ? cfg.context() : '';
    let html = '';
    if (!shown.length) {
      html = '<div class="ac-empty">No matching equipment' +
        (ctx ? '<br><small>Applied filters: ' + escHtml(ctx) + '</small>' : '') + '</div>';
    } else {
      html = shown.map((it, i) => {
        const sub = [it.unit, it.area].filter(Boolean).join(' · ');
        return '<div class="ac-item' + (it.dim ? ' ac-dim' : '') + (i === active ? ' active' : '') + '" role="option" data-i="' + i + '">' +
          '<div class="ac-main"><span class="ac-name">' + highlight(it.name, r.q) + '</span>' +
          (it.meta ? '<span class="ac-meta">' + escHtml(it.meta) + '</span>' : '') + '</div>' +
          (sub ? '<div class="ac-sub">' + highlight(sub, cfg.fields ? r.q : '') + '</div>' : '') +
          '</div>';
      }).join('');
      const more = r.total > shown.length ? 'Showing ' + shown.length + ' of ' + r.total + ' — keep typing to narrow' : r.total + ' match' + (r.total !== 1 ? 'es' : '');
      html += '<div class="ac-foot">' + more + (ctx ? '<br>Filters: ' + escHtml(ctx) : '') + '</div>';
    }
    panel.innerHTML = html;
    panel.scrollTop = 0;
    open();
  }

  function position() {
    const rect = input.getBoundingClientRect();
    const vv = window.visualViewport;
    const vTop = vv ? vv.offsetTop : 0;
    const vBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const vWidth = vv ? vv.width : window.innerWidth;
    const width = Math.min(Math.max(rect.width, 260), vWidth - 16);
    const left = Math.max(8, Math.min(rect.left, vWidth - width - 8));
    const below = vBottom - rect.bottom - 8;
    const above = rect.top - vTop - 8;
    panel.style.width = width + 'px';
    panel.style.left = left + 'px';
    if (below >= 180 || below >= above) {
      panel.style.top = (rect.bottom + 2) + 'px';
      panel.style.bottom = 'auto';
      panel.style.maxHeight = Math.max(120, Math.min(340, below)) + 'px';
    } else {
      panel.style.top = 'auto';
      panel.style.bottom = (window.innerHeight - rect.top + 2) + 'px';
      panel.style.maxHeight = Math.max(120, Math.min(340, above)) + 'px';
    }
  }

  function open() {
    isOpen = true;
    panel.style.display = 'block';
    input.setAttribute('aria-expanded', 'true');
    position();
  }
  function close() {
    isOpen = false;
    panel.style.display = 'none';
    input.setAttribute('aria-expanded', 'false');
  }

  function setActive(i) {
    if (!shown.length) return;
    active = (i + shown.length) % shown.length;
    panel.querySelectorAll('.ac-item').forEach((el, idx) => el.classList.toggle('active', idx === active));
    const el = panel.querySelector('.ac-item.active');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function pick(i) {
    const it = shown[i];
    if (!it) return;
    input.value = it.name;
    close();
    if (cfg.onPick) cfg.onPick(it);
  }

  input.addEventListener('input', render);
  input.addEventListener('focus', () => {
    if (input.value) setTimeout(() => { try { input.select(); } catch (e) {} }, 0);
    render();
  });
  input.addEventListener('blur', close);
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!isOpen) render(); else setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (isOpen) setActive(active - 1); }
    else if (e.key === 'Enter') {
      if (isOpen && active >= 0 && shown[active]) { e.preventDefault(); pick(active); }
      else if (cfg.onEnter) { e.preventDefault(); close(); cfg.onEnter(); }
    }
    else if (e.key === 'Escape' || e.key === 'Tab') close();
  });

  // Keep focus in the input while the user taps/drags inside the list, then pick on click.
  panel.addEventListener('mousedown', e => e.preventDefault());
  panel.addEventListener('click', e => {
    const el = e.target.closest('.ac-item');
    if (el) pick(parseInt(el.getAttribute('data-i'), 10));
  });
  panel.addEventListener('mousemove', e => {
    const el = e.target.closest('.ac-item');
    if (el) { const i = parseInt(el.getAttribute('data-i'), 10); if (i !== active) setActive(i); }
  });

  window.addEventListener('resize', () => { if (isOpen) position(); });
  window.addEventListener('scroll', () => { if (isOpen) position(); }, true);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', () => { if (isOpen) position(); });
}
