/* VibeMon — Supabase configuration + client, legacy GS stubs, dept list */

// ============================================================
// VibeMon v4 — Supabase Backend. No Google Sheets dependency.
// ============================================================

// ⚡ SUPABASE CONFIGURATION — Replace with your project values
// Get these from: Supabase Dashboard → Project Settings → API
const SUPABASE_URL = 'https://fuxqxjbtudimxszlivrw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1eHF4amJ0dWRpbXhzemxpdnJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxNDEzODMsImV4cCI6MjEwNTcxNzM4M30.n-0v-IEHVRhuIvMyujySYznKy9gyDxwwC7CS8RRqOzo';

// Initialize Supabase client
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── NEW FEATURES START ON THIS DATE ─────────────────────────────────────────────────────────────────────────────────────
// Not running / Standby, the Equipment Health Index, the "Worst Health" list and the health-based catch-up priority switch on for
// everybody on this date (and the catch-up plan of any month starting on or after it uses the new rules). Before it, operators see
// nothing different (admins can already look at the health score and the Worst Health list). Format YYYY-MM-DD.
const FEATURES_FROM = '2026-11-01';

// ── ADMIN 2-STEP SIGN-IN (authenticator app) ───────────────────────────────────────────────────────────────────────────
// true  = an ADMIN login must also type the 6-digit code from Google Authenticator (needs a Supabase Auth user per admin, see supabase/ADMIN_2FA_SETUP.md).
// false = admins sign in with the password only, as before. Emergency switch if the set-up goes wrong.
const ADMIN_2FA = true;
const ADMIN_2FA_EMAIL_DOMAIN = 'users.vibemon.app';   // the admin's Supabase Auth email is  <username>@<this>  (not a real mailbox)

// Legacy GS stubs — kept so no other code breaks
const GS_KEY = 'vibromon_gsurl';
const GS_DEFAULT_URL = '';
function getGSUrl() { return ''; }
// Exception responsible department assignments: { equipment: dept }
// Responsible dept is sourced directly from Alert/Critical readings (responsibleDept field).
const DEPTS_LIST = ['AHD','CHP','EMD','OFS','BMD','TMD','C&I','TAD'];
