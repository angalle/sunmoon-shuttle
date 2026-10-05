#!/usr/bin/env node
/**
 * 계약 JSON 최소 검증 — T3(infraprojectcreator) · docs/02-monitoring.md M3
 *
 * 역할 구분(경계):
 *   - 이 스크립트는 **배포/반영 경로의 마지막 방어선**이다. "손상된 데이터가 사이트로 새는 것"만 막는다.
 *   - 정밀한 스키마·골든 일치 검증은 파서(T2)와 골든 테스트가 담당한다 — 여기서 중복 구현하지 않는다.
 *
 * 사용: node .github/scripts/verify_contract.mjs [data/timetable.json]
 * 실패 시 exit 1 (조용한 통과 금지) + ::error 애너테이션.
 */
import { readFileSync } from 'node:fs';

const path = process.argv[2] ?? 'data/timetable.json';

function weekdayRows(t) {
  if (!Array.isArray(t.routes)) return 0;
  return t.routes.reduce((n, r) => n + (r?.byDay?.weekday?.length ?? r?.trips?.length ?? 0), 0);
}

let t;
try {
  t = JSON.parse(readFileSync(path, 'utf8'));
} catch (e) {
  console.error(`::error title=JSON 파손::${path} 를 파싱할 수 없다: ${e.message}`);
  process.exit(1);
}

const errs = [];
if (!Number.isInteger(t.schemaVersion) || t.schemaVersion < 1) {
  errs.push('schemaVersion 이 1 이상의 정수가 아니다');
}
if (!Array.isArray(t.routes) || t.routes.length === 0) {
  errs.push('routes 가 비었거나 배열이 아니다');
} else {
  for (const r of t.routes) {
    if (!r || typeof r.id !== 'string' || r.id.length === 0) {
      errs.push('route.id 누락');
      break;
    }
    if (typeof r.name !== 'string' || r.name.length === 0) {
      errs.push(`route ${r.id}: name 누락`);
      break;
    }
  }
}
if (!t.source || typeof t.source !== 'object') {
  errs.push('source 누락 (sourceUpdatedAt·contentHash 의 근거)');
}

if (errs.length > 0) {
  for (const e of errs) console.error(`::error title=계약 검증 실패::${e}`);
  process.exit(1);
}

console.log(`계약 검증 OK — schemaVersion=${t.schemaVersion} 노선=${t.routes.length} 평일행=${weekdayRows(t)}`);
