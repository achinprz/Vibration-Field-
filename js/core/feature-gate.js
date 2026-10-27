/* VibeMon — new features start on a fixed date (FEATURES_FROM in config.js) so operators see no change before then.
     fxLive()          – today is on/after FEATURES_FROM: everybody gets the new features
     fxEhiVisible()    – the Equipment Health Index (badge on the trend page, "Worst Health" list): live for everybody on that date,
                         and visible to ADMINS before it (view-only) so they can check the numbers
     fxRulesFor(y, m)  – does the catch-up plan / "Not running" handling of month y/m (0-11) use the new rules? Only for months that
                         START on or after FEATURES_FROM, so a month already under way is never re-planned halfway. */

function _fxToday() { const t = new Date(), p = n => String(n).padStart(2, '0'); return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate()); }
function fxLive() { try { return _fxToday() >= FEATURES_FROM; } catch (e) { return false; } }
function fxIsAdmin() { try { return typeof AUTH !== 'undefined' && AUTH && AUTH.role === 'admin'; } catch (e) { return false; } }
function fxEhiVisible() { return fxLive() || fxIsAdmin(); }
function fxRulesFor(y, m) { try { return y + '-' + String(m + 1).padStart(2, '0') + '-01' >= FEATURES_FROM; } catch (e) { return false; } }

// shows / hides every element marked data-fx="live" (everybody, from the date) or data-fx="ehi" (from the date, admins earlier)
function fxApply() {
  document.querySelectorAll('[data-fx]').forEach(el => {
    const kind = el.getAttribute('data-fx');
    const on = kind === 'ehi' ? fxEhiVisible() : fxLive();
    el.style.display = on ? '' : 'none';
  });
}
document.addEventListener('DOMContentLoaded', fxApply);
setInterval(fxApply, 60000);   // the day can change while the app is open
