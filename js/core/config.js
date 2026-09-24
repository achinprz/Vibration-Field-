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

// Legacy GS stubs — kept so no other code breaks
const GS_KEY = 'vibromon_gsurl';
const GS_DEFAULT_URL = '';
function getGSUrl() { return ''; }
// Exception responsible department assignments: { equipment: dept }
// Responsible dept is sourced directly from Alert/Critical readings (responsibleDept field).
const DEPTS_LIST = ['AHD','CHP','EMD','OFS','BMD','TMD','C&I','TAD'];
