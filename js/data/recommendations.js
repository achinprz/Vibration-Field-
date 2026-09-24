/* VibeMon — standard recommendations list */

// ---- STANDARD RECOMMENDATIONS (fallback until GSheet loads) ----
let STD_RECS = [
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
  "Check looseness at baseplate, anchor bolts, pipe supports — tighten as required."
];

// Recommendations that must ALWAYS be available in the picker, even after the
// RECOMMENDATIONS_MASTER sheet overwrites STD_RECS on load.
const EXTRA_RECS = [
  "Decoupled trial to be taken for further analysis"
];
function mergeExtraRecs() {
  EXTRA_RECS.forEach(r => { if (!STD_RECS.includes(r)) STD_RECS.push(r); });
}
mergeExtraRecs();
