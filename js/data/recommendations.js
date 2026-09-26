/* VibeMon — standard recommendations list */

// The standard-recommendation list lives in the Supabase table `recommendations` and is edited from
// Admin Panel → Recommendations. STD_RECS is what Data Entry / Edit Report offer, and it is filled from that
// table on every load (fetchRecommendations in data-loader.js) — even when the table is empty.
//
// This built-in copy is NOT the live list. It is only used
//   • to fill an empty table with one click (Admin Panel → Recommendations → "Load the built-in recommendations"), and
//   • as a last resort when this device has never reached Supabase and has no saved copy of the list.
const BUILTIN_RECS = [
  "Overall vibration is NORMAL — continue periodic monitoring as per schedule.",
  "Lubricate motor DE and NDE bearings per lubrication schedule.",
  "Lubricate pump DE and NDE bearings per lubrication schedule.",
  "Check and correct shaft alignment (motor-pump/fan coupling misalignment suspected).",
  "Inspect rotor/impeller/fan blade for imbalance, erosion, or buildup — arrange dynamic balancing.",
  "Inspect and correct soft-foot at all mounting pads and foundation bolts.",
  "Check bearing condition — plan bearing replacement in next opportunity/PM.",
  "STOP EQUIPMENT IMMEDIATELY — critical vibration; arrange inspection and repair.",
  "Inspect gearbox oil level and oil condition — arrange oil sampling and analysis.",
  "Check for resonance — verify equipment running speed vs. natural frequency.",
  "Check for cavitation in pump — verify suction pressure and flow conditions.",
  "Inspect coupling element (flexible insert) — replace if worn or damaged.",
  "Verify motor rotor condition — check for electrical unbalance or broken rotor bars.",
  "Check looseness at baseplate, anchor bolts, pipe supports — tighten as required.",
  "Decoupled trial to be taken for further analysis"
];
const EXTRA_RECS = ["Decoupled trial to be taken for further analysis"];   // used by the Recommendations screen to spot a missing built-in

// Last good copy of the table saved on this device (so Data Entry still has its list when offline).
const RECS_CACHE_KEY = 'vibemon_recs_cache_v1';
let STD_RECS = (function () {
  try { const c = JSON.parse(localStorage.getItem(RECS_CACHE_KEY)); if (Array.isArray(c)) return c; } catch (e) {}
  return BUILTIN_RECS.slice();
})();
