# T3b 증거 — scrape.yml 성공 케이스 + Pages 계약 JSON 200 (infraprojectcreator, 2026-10-05)

카드: `t_2e071b0c` · 저장소: https://github.com/angalle/sunmoon-shuttle (public) · 브랜치 `main`
모든 값은 **실제 명령 원출력**이다(요약·재구성 없음). 비밀값 없음(토큰은 마스킹조차 저장하지 않음 — 계정 이름만).

---

## 0. 선행 조건 — T2 커밋 push(이 카드에서 수행)

```
$ git log --oneline origin/main..HEAD
b24c150 ci(scrape): fetchedAt 제외 내용 비교로 무변경 시 커밋 0건 + docs/01 §4 fetchedAt 의미 1줄
86037f1 data(scrape): 생성물 data/timetable.json + T2 증거·재현 스크립트
d9f4d24 test(scraper): 골든(11개 스냅샷 행·셀·Χ→null·업데이트 날짜) + 결정성 + 조립 테스트
9c8682c feat(scraper): 원본 스냅샷 → 계약 JSON 파서(구조 파싱·colspan·Χ→null·검증 게이트)

$ git push origin main
To https://github.com/angalle/sunmoon-shuttle.git
   4723eb5..b24c150  main -> main
```

`gh workflow run` 은 `gh auth switch -u angalle` 후 실행(활성 계정 `mz-heesun` 은 pull 전용).

## 1. 변경한 것 — `scrape.yml` 변경 감지(fetchedAt 제외)

T2 실측: 같은 입력으로 3회 파싱하면 `source.fetchedAt` 만 달라진다(행·셀·contentHash 는 결정적).
→ 원시 `git diff --quiet` 는 **항상 changed=true** 가 되어 '수집 시각만 바뀐' 노이즈 커밋이 쌓인다.
→ `jq -S 'del(.source.fetchedAt)'` 정규화 비교로 교체하고, 무변경이면 HEAD 로 복원 후 커밋 0건.

### 로컬 재현 (파서 산출물이 커밋본과 동일한지)
```
$ npm run scrape -- --local data/raw/*.html        # exit 0
[scrape] 입력 스냅샷 11개 (평일 5 · 토요일 3 · 일요일 3)
[scrape]   asan-ktx(아산(KTX)역) [active] — 평일 42행 · 토요일 4행 · 일요일 6행
[scrape]   cheonan-station(천안역) [active] — 평일 33행 · 토요일 4행 · 일요일 5행
[scrape]   cheonan-terminal(천안터미널) [active] — 평일 38행 · 토요일 4행 · 일요일 5행
[scrape]   onyang(온양역/터미널) [active] — 평일 7행 · 토요일 없음(원본) · 일요일 없음(원본)
[scrape]   cheonan-campus(천안캠퍼스) [suspended] — 평일 0행 · 토요일 없음(원본) · 일요일 없음(원본)
[scrape] 안내문 17건 · 시내버스 참고 15건 · 문의 학생지원팀 041-530-2152
[scrape] 검증 통과(issues 0) · dayTypes [weekday, saturday, sunday]
[scrape] 씀: data/timetable.json (84846 bytes) · sha256:16fac81b0115f70b78b43d750681042053e13dccebc96e9d7b9be7fb7744f900

$ diff -u <(git show HEAD:data/timetable.json | jq -S 'del(.source.fetchedAt)') \
          <(jq -S 'del(.source.fetchedAt)' data/timetable.json)
NO-CONTENT-DIFF (fetchedAt 만 변동)          # ← 커밋본과 내용 동일, fetchedAt 만 새 시각
$ jq -r '.source.fetchedAt' data/timetable.json ; git checkout -- data/timetable.json
2026-10-05T14:43:45+09:00
```

### 정적 검증
```
$ actionlint .github/workflows/scrape.yml        # exit 0 (지적 0건 — 출력 없음)
$ bash -n <변경 감지 스텝 셸>                     # 문법 OK
```

### 분기 4케이스(샌드박스 git 저장소에서 스텝 셸 원본 실행)
| 케이스 | 내용 | `$GITHUB_OUTPUT` | 스텝 로그 |
|---|---|---|---|
| A | `fetchedAt` 만 변동 | `changed=false` | `fetchedAt 외 내용 동일 → 데이터 변경 없음 → 커밋 0건…` + HEAD 복원 확인 |
| B | 실제 내용 변동(트립 키 추가 / 안내문 텍스트 수정) | `changed=true` | `data/timetable.json 내용 변경 감지 → 커밋한다` |
| C | HEAD 에 `data/timetable.json` 없음(최초 반입) | `changed=true` | `기존 data/timetable.json 이 HEAD 에 없다(최초 반영) → 커밋한다` |
| D | **구로직** `git diff --quiet` + A 입력 | (구) `changed=TRUE` | 노이즈 커밋의 원인 — 신로직은 A 에서 `changed=false` |

## 2. scrape.yml 수동 트리거 1·2회차 (성공 케이스)

### 1회차 — https://github.com/angalle/sunmoon-shuttle/actions/runs/37269154462 (job 13s)
```
$ gh workflow run scrape.yml --repo angalle/sunmoon-shuttle --ref main \
    -f raw_glob='data/raw/*.html' -f mode=commit -f reason='2026-2학기 스냅샷 정규 반입'
→ run 37269154462

스텝: ✓ 체크아웃 ✓ Node 설정 ✓ 의존성 설치 ✓ 스냅샷 파싱 ✓ 계약 JSON 최소 검증 ✓ 테스트 ✓ 변경 감지
      - 반영 — main 커밋 (mode=commit)      ← skipped
      - 반영 — 검토용 PR (mode=pr)           ← skipped

매칭된 스냅샷: 11개
[scrape] 입력 스냅샷 11개 (평일 5 · 토요일 3 · 일요일 3)
[scrape] 씀: data/timetable.json (84846 bytes) · sha256:16fac81b0115f70b78b43d750681042053e13dccebc96e9d7b9be7fb7744f900
계약 검증 OK — schemaVersion=1 노선=5 평일행=120
Test Files  7 passed (7)
      Tests  75 passed (75)
fetchedAt 외 내용 동일 → 데이터 변경 없음 → 커밋 0건(fetchedAt 은 직전 내용 변경 시각을 유지)
```

### 2회차 — https://github.com/angalle/sunmoon-shuttle/actions/runs/37269211341 (job 14s)
```
1회차와 동일: 스냅샷 11개 · 계약 검증 OK · Tests 75 passed (75)
✓ 변경 감지 (fetchedAt 제외 — 내용 무변경이면 커밋 0건)
- 반영 — main 커밋 (mode=commit)   ← skipped
fetchedAt 외 내용 동일 → 데이터 변경 없음 → 커밋 0건(fetchedAt 은 직전 내용 변경 시각을 유지)

$ git log origin/main --oneline -1
b24c150 ci(scrape): fetchedAt 제외 내용 비교로 무변경 시 커밋 0건 + docs/01 §4 fetchedAt 의미 1줄
→ 두 번 실행 모두 **반영 커밋 0건**(노이즈 커밋 차단 실증)
```

## 3. deploy.yml 성공 (b24c150 push) — https://github.com/angalle/sunmoon-shuttle/actions/runs/37269144210

```
JOBS: ✓ build (경계 → test → build) 15s    ✓ deploy (github-pages) 8s
build 스텝 전부 success: 체크아웃 · Node 설정 · 의존성 설치 · 헥사고날 경계 검사 · 테스트 · 정적 빌드 ·
                        계약 데이터 동봉 · Pages 설정 · 배포 아티팩트 업로드
동봉: dist/data/timetable.json (84846 bytes)
```

## 4. Pages 서빙 확인 (계약 JSON)

```
$ curl -sI https://angalle.github.io/sunmoon-shuttle/data/timetable.json
HTTP/2 200
content-type: application/json; charset=utf-8
content-length: 84846
last-modified: Mon, 05 Oct 2026 05:45:13 GMT
etag: "6ac33969-14b6e"

$ curl -s .../data/timetable.json | jq -r '.source.sourceUpdatedAt, .source.fetchedAt, .source.contentHash'
2026-08-20
2026-10-05T14:39:32+09:00
sha256:16fac81b0115f70b78b43d750681042053e13dccebc96e9d7b9be7fb7744f900

$ curl -s .../data/timetable.json | shasum -a 256 | awk '{print $1}'
269699a634d14ab69ded294c110b6f9e04b436d6b4d0660d1f88c7d78a48ef4b
$ shasum -a 256 data/timetable.json | awk '{print $1}'
269699a634d14ab69ded294c110b6f9e04b436d6b4d0660d1f88c7d78a48ef4b      # 배포본 = 로컬 (동일)

$ curl -sI https://angalle.github.io/sunmoon-shuttle/            # 루트 앱
HTTP/2 200 · last-modified: Mon, 05 Oct 2026 05:45:13 GMT · etag: "6ac33969-1a0"
$ curl -s https://angalle.github.io/sunmoon-shuttle/ | grep -oE 'src="[^"]+"'
src="./assets/index-CYcdGgtf.js"                                  # 상대경로 → 하위경로 정상

$ curl -s -o /dev/null -w 'HTTP %{http_code}\n' https://angalle.github.io/sunmoon-shuttle/timetable.json
HTTP 404        # ⚠️ data/ 없이 읽으면 404 — 앱은 /data/timetable.json 을 읽어야 한다
```

## 5. docs/02 §6 주간 신선도 점검 1줄 명령 (원출력 그대로)

```
$ curl -sL https://angalle.github.io/sunmoon-shuttle/data/timetable.json | jq -r '"원본 업데이트=\(.source.sourceUpdatedAt)  우리 반영=\(.source.fetchedAt)  해시=\(.source.contentHash)"'; curl -s "https://api.github.com/repos/angalle/sunmoon-shuttle/commits?path=data/timetable.json&per_page=1" | jq -r '"마지막 data 커밋=" + .[0].commit.committer.date'
원본 업데이트=2026-08-20  우리 반영=2026-10-05T14:39:32+09:00  해시=sha256:16fac81b0115f70b78b43d750681042053e13dccebc96e9d7b9be7fb7744f900
마지막 data 커밋=2026-10-05T05:41:48Z
```

## 6. 남긴 위험·가정
- **이번 트리거는 반영 커밋 0건**이다(T2 가 이미 같은 내용을 커밋했으므로 정상). "내용이 실제로 바뀌면 커밋 1건" 경로는 CI 에서 아직 실측하지 않았다 —
  로컬 샌드박스 케이스 B(`changed=true`)로만 검증했고, CI 실측은 다음 실제 스냅샷 변경 때 확인된다.
- `source.fetchedAt` 은 이제 **"마지막 내용 변경 시각"** 이다. 그래서 앱의 M2(데이터 나이)는 "우리가 언제 마지막으로 내용을 갱신했는지"를 뜻한다(docs/01 §4·docs/02 §1 M2).
- 저장소 `Watch → Custom → Actions` 알림 수신 설정은 사람이 1회 해야 한다(계정 설정 접근 필요 — 미검증).
- 앱(T5)이 읽는 경로는 `/data/timetable.json` 이다(루트 `/timetable.json` 은 404 — 실측).

## 7. 최종 배포(문서 커밋) — https://github.com/angalle/sunmoon-shuttle/actions/runs/37269370314

push `ce24362`(§8·§6 문서 갱신) → `build` success · `deploy (github-pages)` success(9s).

```
$ curl -sI https://angalle.github.io/sunmoon-shuttle/                      # 2026-10-05 14:48 KST 재측정
HTTP/2 200 · last-modified: Mon, 05 Oct 2026 05:48:22 GMT · etag: "6ac33a26-1a0"
$ curl -sI https://angalle.github.io/sunmoon-shuttle/data/timetable.json
HTTP/2 200 · content-length: 84846 · last-modified: 05:48:22 GMT · etag: "6ac33a26-14b6e"
$ curl -s .../data/timetable.json | jq -r '.source.sourceUpdatedAt, .source.fetchedAt, .source.contentHash'
2026-08-20
2026-10-05T14:39:32+09:00
sha256:16fac81b0115f70b78b43d750681042053e13dccebc96e9d7b9be7fb7744f900
→ 재배포해도 내용·해시 불변, last-modified(배포 시각)만 갱신
```
