// Mirrors the local app policy; parity is checked in tests/retention.test.mjs.
export function getProductionRetentionStart(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(part=>[part.type,part.value]));
  let year=Number(parts.year),month=Number(parts.month);
  if(Number(parts.day)<10) {month--;if(month===0){year--;month=12;}}
  return `${year}-${String(month).padStart(2,'0')}-01`;
}
export function retainProductionRecords(records, now = new Date()) {
  const cutoff=getProductionRetentionStart(now);
  return Object.fromEntries(Object.entries(records).filter(([date])=>!/^\d{4}-\d{2}-\d{2}$/.test(date) || date>=cutoff));
}
