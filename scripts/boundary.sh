#!/usr/bin/env bash
# 헥사고날 경계 검사 — T0 계약 (docs/01-architecture.md §3)
#
# 검사 ① src/domain/**  : 브라우저·네트워크·환경·시계 API 사용 0건
#                         (fetch / XMLHttpRequest / document / window / indexedDB /
#                          localStorage / sessionStorage / navigator / import.meta.env /
#                          process.env / Date.now)
#                         이유 — domain 은 순수해야 한다. 시간은 포트(clock)로 주입한다.
# 검사 ② src/application/** : adapters/** import 0건 (의존 방향 adapter → application → domain)
#
# 위반이 있으면 위반 줄을 출력하고 exit 1. 위반 0이면 PASS 출력 후 exit 0.
# 사용: bash scripts/boundary.sh   (npm run lint:boundary)

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

fail=0

# --- 검사 ①: domain 순수성 ---
DOMAIN_DIR="src/domain"
DOMAIN_PATTERN='\bfetch[[:space:]]*\(|\bXMLHttpRequest\b|\bdocument\b|\bwindow\b|\bindexedDB\b|\blocalStorage\b|\bsessionStorage\b|\bnavigator\b|import\.meta\.env|\bprocess\.env|\bDate\.now\b'

if [ -d "$DOMAIN_DIR" ]; then
  # 주석 줄(//, *, /*)은 실행 코드가 아니므로 제외한다 — 나머지 줄에서만 금지 API 를 찾는다.
  hits="$(grep -rnE "$DOMAIN_PATTERN" "$DOMAIN_DIR" --include='*.ts' 2>/dev/null \
    | grep -vE ':[0-9]+:[[:space:]]*(//|\*|/\*)' || true)"
  if [ -n "$hits" ]; then
    echo "FAIL [경계①/domain 순수성] $DOMAIN_DIR 안에서 금지 API 사용:"
    printf '%s\n' "$hits"
    fail=1
  else
    echo "PASS [경계①/domain 순수성] $DOMAIN_DIR — 브라우저·네트워크·환경·시계 API 사용 0건"
  fi
else
  echo "SKIP [경계①/domain 순수성] $DOMAIN_DIR 디렉터리 없음"
fi

# --- 검사 ②: application 은 adapters 를 모른다 ---
APP_DIR="src/application"
APP_PATTERN="from[[:space:]]+['\"][^'\"]*adapters"

if [ -d "$APP_DIR" ]; then
  hits="$(grep -rnE "$APP_PATTERN" "$APP_DIR" --include='*.ts' 2>/dev/null \
    | grep -vE ':[0-9]+:[[:space:]]*(//|\*|/\*)' || true)"
  if [ -n "$hits" ]; then
    echo "FAIL [경계②/application→adapters] $APP_DIR 에서 adapters import:"
    printf '%s\n' "$hits"
    fail=1
  else
    echo "PASS [경계②/application→adapters] $APP_DIR — adapters import 0건"
  fi
else
  echo "SKIP [경계②/application→adapters] $APP_DIR 디렉터리 없음"
fi

if [ "$fail" -ne 0 ]; then
  echo "BOUNDARY: FAIL (위반 있음)"
  exit 1
fi

echo "BOUNDARY: PASS (위반 0건)"
exit 0
