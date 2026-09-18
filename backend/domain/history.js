'use strict';

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error('An ISO timestamp with time zone is required');
  }
  // Date.parse normalizes impossible dates; reject them before normalization.
  const [year,month,day,hour,minute,second]=value.slice(0,19).split(/[-T:]/).map(Number);
  const days=new Date(Date.UTC(year,month,0)).getUTCDate();
  if(month<1||month>12||day<1||day>days||hour>23||minute>59||second>59)
    throw new Error('Invalid calendar timestamp');
  return new Date(value).toISOString();
}
function applicable(rows, at, knownAt = '9999-12-31T23:59:59.999Z') {
  // Null effective dates are retained evidence, never guessed into a timeline.
  const known = rows.filter(r => r.recordedAt <= knownAt);
  const superseded = new Set(known.filter(r => r.effectiveAt !== null && r.effectiveAt <= at).map(r => r.supersedesId).filter(Boolean));
  return known.filter(r => r.effectiveAt !== null && r.effectiveAt <= at && !superseded.has(r.id))
    .sort((a,b) => b.effectiveAt.localeCompare(a.effectiveAt) || b.recordedAt.localeCompare(a.recordedAt));
}
function latest(rows, at, knownAt) { const r = applicable(rows, at, knownAt)[0]; return r && r.active !== false ? r : null; }
function grouped(rows, field, at, knownAt) {
  return [...new Set(rows.map(r => r[field]))].map(k => latest(rows.filter(r => r[field] === k), at, knownAt)).filter(Boolean);
}
module.exports = { timestamp, applicable, latest, grouped };
