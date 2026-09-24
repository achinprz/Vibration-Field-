/* VibeMon — last-reading lookup and schedule status */

function getLastReading(equipName) {
  const recs = READINGS.filter(r=>r.equipment===equipName);
  return recs.length ? recs.sort((a,b)=>new Date(b.date)-new Date(a.date))[0] : null;
}

// PERF: build a {equipmentName: latestReading} map in a SINGLE pass over READINGS.
// Use this instead of calling getLastReading() inside a loop over equipment —
// calling getLastReading() per-equipment re-scans the whole READINGS array every
// time (O(equipment * readings)), which is what was freezing the app when typing
// in the Data Entry / Template Builder search boxes or switching into those tabs
// once enough reading history had built up.
function buildLastReadingMap() {
  const map = {};
  READINGS.forEach(r => {
    if (!r.equipment) return;
    const prev = map[r.equipment];
    if (!prev || new Date(r.date) > new Date(prev.date)) map[r.equipment] = r;
  });
  return map;
}

function schedInfo(e, last) {
  if (last === undefined) last = getLastReading(e.name);
  if(!last) return {status:'NEW'};
  const d = Math.floor((new Date()-new Date(last.date))/86400000);
  if(d>e.frequency) return {status:'OVERDUE',days:d,over:d-e.frequency};
  if(d>=e.frequency) return {status:'DUE',days:d};
  return {status:'OK',days:d};
}
