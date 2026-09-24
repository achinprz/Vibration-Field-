/* VibeMon — date/time helpers (local IST, no timezone shift) */

// ── DATE/TIME HELPERS ──────────────────────────────────────────────────────
// Timestamps are stored in Supabase exactly as the engineer enters them (local IST).
// _utcToLocal() now strips any timezone suffix and displays the raw DB value as-is
// so there is NO +5:30 shift when reading back from Supabase.
//
// _localISOString()  →  "2026-08-08T10:27:53"   (local, no Z, no offset)
// _localNowStr()     →  "2026-08-08 10:27:53"   (for READINGS in-memory)
// _utcToLocal(ts)    →  strips tz suffix, returns "YYYY-MM-DD HH:MM:SS" as stored
//
function _localISOString(d) {
  d = d || new Date();
  const pad = n => String(n).padStart(2,'0');
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) +
         'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}
function _localNowStr() {
  // Returns "YYYY-MM-DD HH:MM:SS" in local time
  return _localISOString().replace('T',' ');
}
function _utcToLocal(ts) {
  // Returns the timestamp EXACTLY as stored in Supabase — no timezone conversion.
  // Strips any trailing offset/Z (e.g. "+00:00", "+05:30", "Z") and normalises
  // the separator so the result is always "YYYY-MM-DD HH:MM:SS".
  if (!ts) return '';
  const s = String(ts).trim();
  // Remove any timezone suffix: Z, +HH:MM, -HH:MM, +HHMM, -HHMM
  const bare = s.replace(/[Zz]$/, '').replace(/[+-]\d{2}:?\d{2}$/, '').trim();
  // Normalise T separator to a space and truncate to 19 chars
  return bare.replace('T', ' ').slice(0, 19);
}
// ─────────────────────────────────────────────────────────────────────────────
