/* VibeMon — end-of-shift WhatsApp summary.
   • A group's operator opens Daily Schedule → Performance and sends their group's summary for the day (default today) to the WhatsApp group.
   • The admin sees the same card for ALL groups (one block per group + a total) under the "Equipment read per day" charts.
   Content: equipment tested + how many Normal / Alarm / Alert / Critical, not-running/standby count, scheduled vs done,
   and for every Alert/Critical machine its highest velocity (point) and highest acceleration (point). Built only from data already in the app. */

let _ssumDate = '';
function ssumToday() { return dsFmt(new Date()); }
function ssumDateLabel(ds) { return new Date(ds + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
const SSUM_DIV = '--------------------------------';

// ── numbers for one group (or 'ALL') on one date ──
function ssumStats(team, ds) {
  const rank = { NORMAL: 1, ALARM: 2, ALERT: 3, CRITICAL: 4 };
  // a group reports only its OWN work: readings entered under another login (e.g. the admin) count in the "all groups" total only
  const mine = r => team === 'ALL' || dsReaderTeam(r) === team;
  const rows = (dsReadingsArr() || []).filter(r => r.equipment && (r.date || '').slice(0, 10) === ds && mine(r));
  const eq = {};
  rows.forEach(r => {
    const k = normalizeEquipName(r.equipment);
    const e = eq[k] = eq[k] || { name: r.equipment, sev: 'NORMAL', vel: 0, velPt: '', acc: 0, accPt: '', sevs: [] };
    e.sevs.push(r.severity);
    [['H_Vel', '-H'], ['V_Vel', '-V'], ['A_Vel', '-A']].forEach(([f, sfx]) => { const v = parseFloat(r[f]); if (!isNaN(v) && v > e.vel) { e.vel = v; e.velPt = (r.point || '') + sfx; } });
    const a = parseFloat(r.Acc); if (!isNaN(a) && a > e.acc) { e.acc = a; e.accPt = r.point || ''; }
  });
  const list = Object.values(eq);
  list.forEach(e => { e.sev = worstSev(e.sevs); });
  const count = s => list.filter(e => e.sev === s).length;
  const attention = list.filter(e => e.sev === 'ALERT' || e.sev === 'CRITICAL')
    .sort((a, b) => (rank[b.sev] - rank[a.sev]) || (b.vel - a.vel));
  // machines visited but not running / on standby that day (never counted as readings)
  const nr = new Set();
  (typeof STATUS_LOG !== 'undefined' ? STATUS_LOG : []).forEach(x => {
    if (!x.equipment || (x.date || '') !== ds) return;
    if (mine(x)) nr.add(normalizeEquipName(x.equipment));
  });
  return { team, ds, tested: list.length, normal: count('NORMAL'), alarm: count('ALARM'), alert: count('ALERT'), critical: count('CRITICAL'),
           attention, notRunning: nr.size, sched: ssumSchedule(team, ds) };
}

// scheduled locations' machines for that day and how many were completed by the group (null = no regular schedule that day)
function ssumSchedule(team, ds) {
  try {
    const dt = new Date(ds + 'T00:00:00'), y = dt.getFullYear(), m = dt.getMonth(), wd = dsDateToWD(dt);
    if (!wd) return null;
    const teams = team === 'ALL' ? Object.keys(VIBE_SCHEDULE) : [team];
    let total = 0, done = 0;
    teams.forEach(t => {
      const items = dsItemsForTeamWD(t, wd, y, m), dm = dsMonthDone(t, y, m, ds);
      total += items.length; done += items.filter(it => dm[wd + '|' + it.n]).length;
    });
    return { total, done };
  } catch (e) { return null; }
}

function ssumAttentionLines(st) {
  if (!st.attention.length) return ['No Alert / Critical equipment.'];
  const out = [];
  st.attention.forEach((e, i) => {
    const m = (typeof MASTER !== 'undefined' ? MASTER : []).find(x => normalizeEquipName(x.name) === normalizeEquipName(e.name)) || {};
    const loc = [m.unit, m.area].filter(Boolean).join(' / ');
    out.push(`${i + 1}. ${e.name}${loc ? ' (' + loc + ')' : ''} - ${e.sev}`);
    out.push(`   Max Vel ${e.vel ? e.vel.toFixed(2) + ' mm/s @ ' + e.velPt : '-'}`);
    out.push(`   Max Acc ${e.acc ? e.acc.toFixed(2) + ' g @ ' + e.accPt : '-'}`);
  });
  return out;
}

function ssumCountLines(st) {
  const l = [`Equipment tested : ${st.tested}`, `Normal ${st.normal} | Alarm ${st.alarm} | Alert ${st.alert} | Critical ${st.critical}`,
             `Not running / Standby : ${st.notRunning}`];
  l.push(st.sched ? `Scheduled : ${st.sched.total} | Done : ${st.sched.done}` : 'Scheduled : no regular schedule on this day (Sunday / reserve day)');
  return l;
}

// operator: one group's summary
function buildShiftSummaryMessage(team, ds) {
  const st = ssumStats(team, ds);
  const by = (AUTH && (AUTH.displayName || AUTH.username)) || '';
  const lines = [`*SHIFT SUMMARY - ${TEAM_NAME[team] || team}*`, SSUM_DIV, `Date : ${ssumDateLabel(ds)}`];
  if (by) lines.push(`Sent by : ${by}`);
  lines.push(SSUM_DIV, ...ssumCountLines(st), SSUM_DIV);
  if (!st.tested) lines.push('No readings were entered on this date.', SSUM_DIV);
  else lines.push('Alert / Critical:', ...ssumAttentionLines(st), SSUM_DIV);
  return lines.join('\n');
}

// admin: every group + total
function buildCombinedSummaryMessage(ds) {
  const teams = Object.keys(VIBE_SCHEDULE);
  const lines = [`*DAILY SUMMARY - ALL GROUPS*`, SSUM_DIV, `Date : ${ssumDateLabel(ds)}`, SSUM_DIV];
  teams.forEach(t => {
    const st = ssumStats(t, ds);
    lines.push(`*${TEAM_NAME[t] || t}*`, ...ssumCountLines(st));
    if (st.tested) lines.push('Alert / Critical:', ...ssumAttentionLines(st));
    lines.push(SSUM_DIV);
  });
  const all = ssumStats('ALL', ds);
  lines.push('*TOTAL*', ...ssumCountLines(all), SSUM_DIV);
  return lines.join('\n');
}

function ssumMessage() {
  const ds = _ssumDate || ssumToday();
  const admin = AUTH && AUTH.role === 'admin';
  return admin ? buildCombinedSummaryMessage(ds) : buildShiftSummaryMessage(dsCurrentTeam(), ds);
}

// ── the card (Daily Schedule → Performance), under the bar charts ──
function dsRenderShiftSummary() {
  const host = document.getElementById('ds-perf-summary'); if (!host) return;
  const admin = AUTH && AUTH.role === 'admin';
  const team = admin ? 'ALL' : dsCurrentTeam();
  if (!(AUTH && (admin || AUTH.role === 'editor')) || !team) { host.innerHTML = ''; return; }
  if (!_ssumDate) _ssumDate = ssumToday();
  const msg = ssumMessage();
  const title = admin ? '📋 Daily summary — all groups' : '📤 End-of-shift summary — ' + escHtml(TEAM_NAME[team] || team);
  const sub = admin ? 'Each group, then the total. Send it to your WhatsApp group.' : 'Send this to the WhatsApp group at the end of your shift.';
  host.innerHTML = `<div class="card" style="margin-top:12px">
    <div class="card-head" style="background:#EFF6FF;flex-wrap:wrap;gap:6px"><span class="card-title" style="color:var(--blue-text)">${title}</span>
      <span style="font-size:11px;color:var(--muted)">${sub}</span></div>
    <div class="card-body" style="padding:10px 12px">
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px">
        <label style="font-size:12px;color:var(--muted)">Date <input type="date" id="ssum-date" value="${_ssumDate}" max="${ssumToday()}" onchange="ssumSetDate(this.value)" style="margin-left:4px"></label>
        <button class="btn btn-sm btn-wa" onclick="ssumSend()">📲 Send to WhatsApp group</button>
        <button class="btn btn-sm" onclick="ssumCopy()">📋 Copy text</button>
      </div>
      <pre id="ssum-pre" style="white-space:pre-wrap;word-break:break-word;margin:0;padding:10px 12px;border-radius:8px;border:1px solid var(--border,#d1d5db);background:var(--surface2,rgba(100,116,139,.10));color:var(--text,inherit);font:12px/1.5 ui-monospace,Consolas,monospace;max-height:340px;overflow:auto">${escHtml(msg)}</pre>
    </div></div>`;
}

function ssumSetDate(v) { _ssumDate = v || ssumToday(); dsRenderShiftSummary(); }
function ssumSend() {
  _waPendingMsg = ssumMessage();
  sendWAGroup();   // copies the text and opens WhatsApp's share list — pick the group
}
function ssumCopy() {
  _waCopy(ssumMessage()).then(ok => { try { showToast(ok ? '✅ Summary copied.' : 'Could not copy — select the text and copy it.', ok ? 'green' : 'red'); } catch (e) {} });
}
