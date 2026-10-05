// T2 증거 수집기 — 실행만, 파싱 로직 없음. JSON 통계 + 마스킹 해시 계산.
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const EV = '.session-notes/evidence/tmp';

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function maskFetchedAt(inPath, outPath) {
  const j = JSON.parse(readFileSync(inPath, 'utf8'));
  j.source.fetchedAt = '<MASKED>';
  writeFileSync(outPath, JSON.stringify(j, null, 2));
}

export function stats(path) {
  const j = JSON.parse(readFileSync(path, 'utf8'));
  const lines = [];
  lines.push(`schemaVersion=${j.schemaVersion} dayTypes=${JSON.stringify(j.dayTypes)}`);
  lines.push(`semester=${JSON.stringify(j.semester)}`);
  lines.push(`holidayPeriod=${JSON.stringify(j.holidayPeriod)}`);
  lines.push(`notices=${j.notices.length} busRefs=${j.busRefs.length} contacts=${JSON.stringify(j.contacts)}`);
  lines.push(`source.sourceUpdatedAt=${j.source.sourceUpdatedAt} source.fetchedAt=${j.source.fetchedAt}`);
  lines.push(`source.contentHash=${j.source.contentHash}`);
  for (const r of j.routes) {
    const parts = Object.entries(r.byDay)
      .map(([d, v]) => `${d}=${v === null ? 'null' : `trips:${v.trips.length} cols:${v.columns.length}`}`)
      .join(' ');
    lines.push(`${r.id} [${r.status}] ${r.name} | ${parts}`);
  }
  lines.push(`bytes=${statSync(path).size}`);
  return lines.join('\n');
}

if (process.argv[2] === 'mask') {
  maskFetchedAt(process.argv[3], process.argv[4]);
  console.log('masked ->', process.argv[4]);
} else {
  console.log(stats(process.argv[2] ?? 'data/timetable.json'));
}
export { sha256File, EV, existsSync };
