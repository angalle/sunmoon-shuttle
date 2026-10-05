#!/usr/bin/env node
/**
 * 커밋/PR 메시지용 한 줄 요약 — T3(infraprojectcreator)
 * 출력: "<학기> · 노선 N · 평일행 M · sha256:xxxxxxxxxxxx"
 * (docs/02-monitoring.md §2 정보 알림 형식: 노선·행수·해시를 메시지에 남긴다)
 *
 * 사용: node .github/scripts/summarize.mjs [data/timetable.json]
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const path = process.argv[2] ?? 'data/timetable.json';
const buf = readFileSync(path);
const t = JSON.parse(buf.toString('utf8'));

const rows = (t.routes ?? []).reduce(
  (n, r) => n + (r?.byDay?.weekday?.length ?? r?.trips?.length ?? 0),
  0,
);
const hash = `sha256:${createHash('sha256').update(buf).digest('hex').slice(0, 12)}`;

process.stdout.write(`${t.semester?.label ?? '학기미상'} · 노선 ${t.routes?.length ?? 0} · 평일행 ${rows} · ${hash}`);
