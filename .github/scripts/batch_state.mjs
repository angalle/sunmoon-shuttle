#!/usr/bin/env node
// .github/scripts/batch_state.mjs — 배치 v2 관측성 기록기 (T15 infraprojectcreator)
//
// docs/02-monitoring.md 부록 A 의 지표를 "파일로 남는" 형태로 구현한다. 런타임 의존성 0(Node 내장만).
//
// 기록하는 것:
//   <state>/last-run.json     — 모든 실행(성공·실패)의 최근 1건: rc·aiMode·model·durationSec·needsReview
//   <state>/last-success.json — **마지막 성공 발행** 시각(finishedAt). "배치 마지막 성공 시각" 지표의 원천.
//   <state>/alerts.log        — 알림 1줄씩(비밀값 없음). 러너가 죽어도 남는 로컬 파일.
//
// 사용:
//   node .github/scripts/batch_state.mjs record-run     --rc=0 --ai=on --model=x --duration=12 --json=data/timetable.json --log=/path/log
//   node .github/scripts/batch_state.mjs record-success --ai=on --model=x --duration=12 --json=data/timetable.json
//   node .github/scripts/batch_state.mjs check-staleness
//   node .github/scripts/batch_state.mjs summarize --json=data/timetable.json
//
// 종료 코드: record-run 은 추출 실패 시 1, 그 외 0. check-staleness 는 30h 초과 시 0(경고만) —
//   경고는 ::warning:: 어노테이션과 alerts.log 로만 남긴다(발행을 막지 않는다).

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const argv = process.argv.slice(2);
const cmd = argv[0];
const opts = {};
for (const a of argv.slice(1)) {
  const m = /^--([^=]+)=(.*)$/s.exec(a);
  if (m) opts[m[1]] = m[2];
}

const stateDir = opts['state'] || process.env.SUNMOON_STATE_DIR || join(homedir(), '.sunmoon-shuttle-batch');
mkdirSync(stateDir, { recursive: true });
const alertsPath = join(stateDir, 'alerts.log');

const nowIso = () => new Date().toISOString();
const say = (s) => process.stdout.write(s + '\n');

function alert(kind, message) {
  // 비밀값 금지: 값이 아니라 상태·경로·건수만 적는다.
  const line = `${nowIso()} kind=${kind} ${message.replace(/\s+/g, ' ').trim()}`;
  appendFileSync(alertsPath, line + '\n');
  say(`::warning title=배치 알림::${line}`);
  say(`ALERT ${line}`);
}

/** 계약 JSON 을 안전하게 읽는다(없거나 깨졌으면 null — 발행 판단은 워크플로가 한다). */
function readJson(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** needsReview=true 를 가진 구조화 항목 수 — 스키마 v2 의 검증 불일치 지표. */
function countNeedsReview(json) {
  if (!json || typeof json !== 'object') return 0;
  let n = 0;
  const walk = (node, depth) => {
    if (depth > 6 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const v of node) walk(v, depth + 1);
      return;
    }
    if (node.needsReview === true) n += 1;
    for (const v of Object.values(node)) walk(v, depth + 1);
  };
  walk(json, 0);
  return n;
}

/** 추출 실패 원인 분류 — 로그 원문 패턴으로만 판단한다(추측 아님, 문자열 근거). */
function classifyFailure(logPath) {
  if (!logPath || !existsSync(logPath)) return 'extract-failed';
  let log = '';
  try {
    log = readFileSync(logPath, 'utf8');
  } catch {
    return 'extract-failed';
  }
  if (/sourceQuote/i.test(log)) return 'quote-validation-failed'; // 인용 검증 실패(발행 중단)
  if (/needsReview|스키마|schema/i.test(log) && /\b(FAIL|실패|exit 1)\b/i.test(log)) return 'schema-validation-failed';
  return 'extract-failed';
}

function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n');
}

const jsonPath = opts['json'] || 'data/timetable.json';

if (cmd === 'record-run') {
  const rc = Number(opts['rc'] ?? '1');
  const aiMode = opts['ai'] || 'unknown';
  const model = opts['model'] || '';
  const durationSec = Number(opts['duration'] ?? '0');
  const json = readJson(jsonPath);
  const needsReview = countNeedsReview(json);
  const record = {
    kind: 'batch-run',
    startedAt: opts['startedAt'] || null,
    finishedAt: nowIso(),
    rc,
    ok: rc === 0,
    aiMode,
    model,
    durationSec,
    schemaVersion: json?.schemaVersion ?? null,
    contentHash: json?.source?.contentHash ?? null,
    needsReviewCount: needsReview,
    runner: process.env.RUNNER_NAME || null,
    workflowRun: process.env.GITHUB_RUN_ID || null,
  };
  writeJson(join(stateDir, 'last-run.json'), record);

  if (rc !== 0) {
    // 실패 → 발행 금지(커밋 안 함) + 알림 1건. 마지막 정상 JSON 은 손대지 않는다.
    const kind = classifyFailure(opts['log']);
    alert(kind, `배치 실패(rc=${rc}, ai=${aiMode}, model=${model || 'n/a'}) — 발행 중단, 마지막 정상 JSON 유지`);
    process.exitCode = 1;
  } else if (needsReview > 0) {
    // 발행은 하되 표시 — 검증 불일치 > 0 (docs/02 부록 A).
    alert('needs-review', `검증 불일치 ${needsReview}건(needsReview=true) — 발행은 진행, 원본 대조 필요`);
  }
  say(`last-run.json 기록: rc=${rc} ai=${aiMode} needsReview=${needsReview}`);
  process.exit();
}

if (cmd === 'record-success') {
  const json = readJson(jsonPath);
  const needsReview = countNeedsReview(json);
  const record = {
    kind: 'batch-success',
    finishedAt: nowIso(),
    aiMode: opts['ai'] || 'unknown',
    model: opts['model'] || '',
    durationSec: Number(opts['duration'] ?? '0'),
    schemaVersion: json?.schemaVersion ?? null,
    contentHash: json?.source?.contentHash ?? null,
    needsReviewCount: needsReview,
    runner: process.env.RUNNER_NAME || null,
    workflowRun: process.env.GITHUB_RUN_ID || null,
  };
  writeJson(join(stateDir, 'last-success.json'), record);
  say(`last-success.json 기록: ${JSON.stringify(record)}`);
  process.exit();
}

if (cmd === 'check-staleness') {
  const p = join(stateDir, 'last-success.json');
  const prev = readJson(p);
  if (!prev || !prev.finishedAt) {
    say('check-staleness: 이전 성공 기록 없음(첫 실행) — 판단 보류');
    process.exit();
  }
  const hours = (Date.now() - Date.parse(prev.finishedAt)) / 3600000;
  const h = Math.round(hours * 10) / 10;
  // 스케줄이 하루 1회(24h 간격)라 GitHub cron 지연만으로도 24h 를 넘는다 → 여유를 둔 30h 를 기준으로 한다.
  if (hours > 30) {
    alert('stale-batch', `직전 배치 성공이 ${h}h 전(>30h) — 러너/스케줄 확인 필요`);
  } else {
    say(`check-staleness: 직전 성공 ${h}h 전 — 정상(≤30h)`);
  }
  process.exit();
}

if (cmd === 'summarize') {
  const json = readJson(jsonPath);
  if (!json) {
    say('::error title=계약 JSON 없음::data/timetable.json 을 읽을 수 없다');
    process.exit(1);
  }
  const needsReview = countNeedsReview(json);
  const routes = Array.isArray(json.routes) ? json.routes.length : 0;
  const rules = Array.isArray(json.dateRules) ? json.dateRules.length : 0;
  const ai = rules ? (json.dateRules.filter((r) => r?.extractedBy === 'ai').length ?? 0) : 0;
  say(`schemaVersion=${json.schemaVersion} 노선=${routes} dateRules=${rules}(ai=${ai}) needsReview=${needsReview} hash=${json.source?.contentHash ?? 'n/a'}`);
  process.exit();
}

say('사용: batch_state.mjs [record-run|record-success|check-staleness|summarize] --opt=value');
process.exit(2);
