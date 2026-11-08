# T7·T11 감사 원출력 (a11y_smoke.mjs)

- 일시: 2026-11-08T08:55:46.134Z
- URL: http://127.0.0.1:49887/sunmoon-shuttle/?now=2026-10-05T14%3A40%3A00%2B09%3A00
- 뷰포트: 390×844 @2x (mobile, touch)
- 스크린샷: .session-notes/T7-light.png · .session-notes/T7-dark.png · .session-notes/T7-focus-skip-link.png · .session-notes/T11-privacy.png

### ① 매니페스트 (Page.getAppManifest)

- url: http://127.0.0.1:49887/sunmoon-shuttle/manifest.webmanifest
- errors: []
- name: 선문대 셔틀버스 시간표 · Sunmoon Shuttle Bus
- short_name: 셔틀버스 Shuttle
- display: standalone · start_url: ./ · scope: ./
- theme_color: #00687a · background_color: #f3f6f7


### ② 아이콘 실측(HTTP 200 · IHDR 치수 · 바이트)

| src | sizes | purpose | status | 실제 치수 | 바이트 |
|---|---|---|---|---|---|
| ./icons/icon-192.png | 192x192 | any | 200 | 192x192 | 1991B |
| ./icons/icon-512.png | 512x512 | any | 200 | 512x512 | 6079B |
| ./icons/maskable-192.png | 192x192 | maskable | 200 | 192x192 | 1294B |
| ./icons/maskable-512.png | 512x512 | maskable | 200 | 512x512 | 4290B |


### ③ light — 대비 실측(전체 61개 텍스트 노드)

| 요소 | 문구 | 전경 | 배경 | 크기 | 대비 | 기준 |
|---|---|---|---|---|---|---|
| a.shuttle-skip-link | 본문으로 건너뛰기 | rgb(255, 255, 255) | rgb(0, 104, 122) | 16px | 6.44:1 | ≥4.5 |
| time.shuttle-appbar__clock | 10월 5일 (월) · 14:40 | rgb(22, 34, 42) | rgb(243, 246, 247) | 15px bold | 14.92:1 | ≥4.5 |
| button.shuttle-button.shuttle-button--secondary.shuttle-appbar__info | ⓘ | rgb(0, 104, 122) | rgb(243, 246, 247) | 16px | 5.93:1 | ≥4.5 |
| span.shuttle-tab__label | 평일 | rgb(0, 104, 122) | rgb(227, 241, 243) | 13px | 5.56:1 | ≥4.5 |
| span.shuttle-tab__label | 토요일 | rgb(91, 104, 112) | rgb(236, 241, 242) | 13px | 5.04:1 | ≥4.5 |
| span.shuttle-tab__label | 일요일 | rgb(91, 104, 112) | rgb(236, 241, 242) | 13px | 5.04:1 | ≥4.5 |
| span.shuttle-chip__label | 학교 도착 | rgb(93, 111, 120) | rgb(255, 255, 255) | 13px | 5.24:1 | ≥4.5 |
| span.shuttle-chip__count | 0 | rgb(93, 111, 120) | rgb(236, 241, 242) | 11px bold | 4.6:1 | ≥4.5 |
| span.shuttle-chip__label | 터미널 도착 | rgb(255, 255, 255) | rgb(0, 104, 122) | 13px bold | 6.44:1 | ≥4.5 |
| span.shuttle-chip__count | 16 | rgb(255, 255, 255) | rgb(0, 104, 122) | 11px bold | 6.44:1 | ≥4.5 |
| p.shuttle-strip__line | 일요일 시간표로 운행합니다 · 개천절대체휴일: 일요일  | rgb(27, 58, 107) | rgb(231, 238, 251) | 14px | 9.67:1 | ≥4.5 |
| span.shuttle-departure__time | 09:00 | rgb(91, 104, 112) | rgb(255, 255, 255) | 15px | 5.74:1 | ≥4.5 |
| span.shuttle-departure__route | 아산(KTX)역 | rgb(91, 104, 112) | rgb(255, 255, 255) | 15px | 5.74:1 | ≥4.5 |
| span.shuttle-departure__dir | 학교에서 출발 · 09:20 도착 · 약 20분 소요 | rgb(91, 104, 112) | rgb(255, 255, 255) | 13px | 5.74:1 | ≥4.5 |
| span.shuttle-departure__time | 09:00 | rgb(91, 104, 112) | rgb(255, 255, 255) | 15px | 5.74:1 | ≥4.5 |
| span.shuttle-departure__route | 천안역 | rgb(91, 104, 112) | rgb(255, 255, 255) | 15px | 5.74:1 | ≥4.5 |
| span.shuttle-departure__dir | 학교에서 출발 · 09:30 도착 | rgb(91, 104, 112) | rgb(255, 255, 255) | 13px | 5.74:1 | ≥4.5 |
| span.shuttle-departure__time | 09:00 | rgb(91, 104, 112) | rgb(255, 255, 255) | 15px | 5.74:1 | ≥4.5 |
| span.shuttle-departure__route | 천안터미널 | rgb(91, 104, 112) | rgb(255, 255, 255) | 15px | 5.74:1 | ≥4.5 |
| span.shuttle-departure__dir | 학교에서 출발 · 09:30 도착 | rgb(91, 104, 112) | rgb(255, 255, 255) | 13px | 5.74:1 | ≥4.5 |
| span.shuttle-departure__time | 12:00 | rgb(91, 104, 112) | rgb(255, 255, 255) | 15px | 5.74:1 | ≥4.5 |
| span.shuttle-departure__route | 아산(KTX)역 | rgb(91, 104, 112) | rgb(255, 255, 255) | 15px | 5.74:1 | ≥4.5 |
| span.shuttle-departure__dir | 학교에서 출발 · 12:20 도착 · 약 20분 소요 | rgb(91, 104, 112) | rgb(255, 255, 255) | 13px | 5.74:1 | ≥4.5 |
| span.shuttle-departure__time | 12:00 | rgb(91, 104, 112) | rgb(255, 255, 255) | 15px | 5.74:1 | ≥4.5 |
| span.shuttle-departure__route | 천안역 | rgb(91, 104, 112) | rgb(255, 255, 255) | 15px | 5.74:1 | ≥4.5 |
| span.shuttle-departure__dir | 학교에서 출발 · 12:30 도착 | rgb(91, 104, 112) | rgb(255, 255, 255) | 13px | 5.74:1 | ≥4.5 |
| span.shuttle-departure__time | 12:00 | rgb(91, 104, 112) | rgb(255, 255, 255) | 15px | 5.74:1 | ≥4.5 |
| span.shuttle-departure__route | 천안터미널 | rgb(91, 104, 112) | rgb(255, 255, 255) | 15px | 5.74:1 | ≥4.5 |
| span.shuttle-departure__dir | 학교에서 출발 · 12:30 도착 | rgb(91, 104, 112) | rgb(255, 255, 255) | 13px | 5.74:1 | ≥4.5 |
| span.shuttle-departure__time | 16:00 | rgb(0, 104, 122) | rgb(230, 243, 244) | 15px bold | 5.67:1 | ≥4.5 |
| span.shuttle-departure__route | 천안역 | rgb(22, 34, 42) | rgb(230, 243, 244) | 15px | 14.26:1 | ≥4.5 |
| span.shuttle-departure__dir | 학교에서 출발 · 16:30 도착 | rgb(91, 104, 112) | rgb(230, 243, 244) | 13px | 5.05:1 | ≥4.5 |
| span.shuttle-departure__time | 16:00 | rgb(22, 34, 42) | rgb(255, 255, 255) | 15px bold | 16.2:1 | ≥4.5 |
| span.shuttle-departure__route | 천안터미널 | rgb(22, 34, 42) | rgb(255, 255, 255) | 15px | 16.2:1 | ≥4.5 |
| span.shuttle-departure__dir | 학교에서 출발 · 16:30 도착 | rgb(91, 104, 112) | rgb(255, 255, 255) | 13px | 5.74:1 | ≥4.5 |
| span.shuttle-departure__time | 16:10 | rgb(22, 34, 42) | rgb(255, 255, 255) | 15px bold | 16.2:1 | ≥4.5 |
| span.shuttle-departure__route | 아산(KTX)역 | rgb(22, 34, 42) | rgb(255, 255, 255) | 15px | 16.2:1 | ≥4.5 |
| span.shuttle-departure__dir | 학교에서 출발 · 16:30 도착 · 약 20분 소요 | rgb(91, 104, 112) | rgb(255, 255, 255) | 13px | 5.74:1 | ≥4.5 |
| span.shuttle-departure__time | 18:00 | rgb(22, 34, 42) | rgb(255, 255, 255) | 15px bold | 16.2:1 | ≥4.5 |
| span.shuttle-departure__route | 천안터미널 | rgb(22, 34, 42) | rgb(255, 255, 255) | 15px | 16.2:1 | ≥4.5 |
| span.shuttle-departure__dir | 학교에서 출발 · 18:30 도착 | rgb(91, 104, 112) | rgb(255, 255, 255) | 13px | 5.74:1 | ≥4.5 |
| span.shuttle-departure__time | 18:10 | rgb(22, 34, 42) | rgb(255, 255, 255) | 15px bold | 16.2:1 | ≥4.5 |
| span.shuttle-departure__route | 천안역 | rgb(22, 34, 42) | rgb(255, 255, 255) | 15px | 16.2:1 | ≥4.5 |
| span.shuttle-departure__dir | 학교에서 출발 · 18:40 도착 | rgb(91, 104, 112) | rgb(255, 255, 255) | 13px | 5.74:1 | ≥4.5 |
| span.shuttle-departure__time | 18:20 | rgb(22, 34, 42) | rgb(255, 255, 255) | 15px bold | 16.2:1 | ≥4.5 |
| span.shuttle-departure__route | 아산(KTX)역 | rgb(22, 34, 42) | rgb(255, 255, 255) | 15px | 16.2:1 | ≥4.5 |
| span.shuttle-departure__dir | 학교에서 출발 · 18:40 도착 · 약 20분 소요 | rgb(91, 104, 112) | rgb(255, 255, 255) | 13px | 5.74:1 | ≥4.5 |
| span.shuttle-departure__time | 19:00 | rgb(22, 34, 42) | rgb(255, 255, 255) | 15px bold | 16.2:1 | ≥4.5 |
| span.shuttle-departure__route | 천안역 | rgb(22, 34, 42) | rgb(255, 255, 255) | 15px | 16.2:1 | ≥4.5 |
| span.shuttle-departure__dir | 학교에서 출발 · 19:30 도착 | rgb(91, 104, 112) | rgb(255, 255, 255) | 13px | 5.74:1 | ≥4.5 |
| span.shuttle-departure__time | 19:10 | rgb(22, 34, 42) | rgb(255, 255, 255) | 15px bold | 16.2:1 | ≥4.5 |
| span.shuttle-departure__route | 아산(KTX)역 | rgb(22, 34, 42) | rgb(255, 255, 255) | 15px | 16.2:1 | ≥4.5 |
| span.shuttle-departure__dir | 학교에서 출발 · 19:30 도착 · 약 20분 소요 | rgb(91, 104, 112) | rgb(255, 255, 255) | 13px | 5.74:1 | ≥4.5 |
| span.shuttle-departure__time | 19:30 | rgb(22, 34, 42) | rgb(255, 255, 255) | 15px bold | 16.2:1 | ≥4.5 |
| span.shuttle-departure__route | 천안터미널 | rgb(22, 34, 42) | rgb(255, 255, 255) | 15px | 16.2:1 | ≥4.5 |
| span.shuttle-departure__dir | 학교에서 출발 · 20:00 도착 | rgb(91, 104, 112) | rgb(255, 255, 255) | 13px | 5.74:1 | ≥4.5 |
| span.shuttle-departure__time | 20:00 | rgb(22, 34, 42) | rgb(255, 255, 255) | 15px bold | 16.2:1 | ≥4.5 |
| span.shuttle-departure__route | 아산(KTX)역 | rgb(22, 34, 42) | rgb(255, 255, 255) | 15px | 16.2:1 | ≥4.5 |
| span.shuttle-departure__dir | 학교에서 출발 · 20:20 도착 · 약 20분 소요 | rgb(91, 104, 112) | rgb(255, 255, 255) | 13px | 5.74:1 | ≥4.5 |
| p.shuttle-splash__title | 선문대 셔틀 | rgb(22, 34, 42) | rgb(243, 246, 247) | 28px bold (큰글씨) | 14.92:1 | ≥3 |
| p.shuttle-splash__message | 시간표 불러오는 중 | rgb(91, 104, 112) | rgb(243, 246, 247) | 14px | 5.28:1 | ≥4.5 |

미달: 0건


#### light — 터치 타깃 실측(16개)

| 요소 | 문구 | 폭 | 높이 | 최소(문서) |
|---|---|---|---|---|
| a.shuttle-skip-link | 본문으로 건너뛰기 | 139px | 48px | 48×48 |
| button.shuttle-button.shuttle-button--secondary.shuttle-appbar__info | ⓘ | 48px | 48px | 48×48 |
| button.shuttle-tab | 평일 | 119px | 40px | 48×40 |
| button.shuttle-tab | 토요일 | 119px | 40px | 48×40 |
| button.shuttle-tab | 일요일 | 119px | 40px | 48×40 |
| button.shuttle-chip.shuttle-chip--empty | 학교 도착 0 | 94px | 44px | 48×44 |
| button.shuttle-chip | 터미널 도착 16 | 108px | 44px | 48×44 |
| section.shuttle-tabpanel.shuttle-tabpanel--enter | 시간표09:00아산(KTX)역학교에서 출발 · 09 | 358px | 1024px | 48×48 |
| button.shuttle-icon-button |  | 48px | 48px | 48×48 |
| button.shuttle-icon-button.shuttle-sheet__close |  | 48px | 48px | 48×48 |
| summary | 정차 시간 안내 | 334px | 48px | 48×48 |
| summary | 시내버스 참고 | 334px | 48px | 48×48 |
| a | 학교 안내 페이지 열기 | 112px | 48px | 48×48 |
| a | 개인정보처리방침 | 90px | 48px | 48×48 |
| button.shuttle-chip | 터미널 도착 12 | 108px | 44px | 48×44 |
| section.shuttle-tabpanel.shuttle-tabpanel--enter | 시간표08:00아산(KTX)역학교에서 출발 · 08 | 358px | 800px | 48×48 |

규격 미달: 0건

레이아웃: 요소 307개 · body bg=rgb(243, 246, 247) · body color=rgb(22, 34, 42) · scrollWidth=390 ≤ clientWidth=390


#### 키보드 포커스(실측)
- activeElement: a.shuttle-skip-link
- outline: solid 3px rgb(0, 104, 122)


### 설치 안내 삭제 + 본문 텍스트 노드 전수 목록(T31 · docs/07 §13)
- 설치 안내 노드: false · 금지 문자열 실측(값·상태·라벨 구역): 0건
- §9-4 예외 구역(상태 1줄): 합니다
- 본문 텍스트 노드 59개 · 허용 구역 밖 0건
- 전수 목록(문자열·위치·크기): .session-notes/T31-본문텍스트노드.md

| 요소 | 문자열 | 위치(x,y) | 크기(w×h) | 폰트(px) | 구분 |
|---|---|---|---|---|---|
| a.shuttle-skip-link | 본문으로 건너뛰기 | 12,12 | 139×48 | 16 | 값·상태·라벨 |
| time.shuttle-appbar__clock | 10월 5일 (월) · 14:40 | 16,20 | 145×23 | 15 | 값·상태·라벨 |
| button.shuttle-button.shuttle-button--secondary.shuttle-appbar__info | ⓘ | 326,8 | 48×48 | 16 | 값·상태·라벨 |
| span.shuttle-tab__label | 평일 | 60,77 | 23×20 | 13 | 값·상태·라벨 |
| span.shuttle-tab__label | 토요일 | 178,77 | 34×20 | 13 | 값·상태·라벨 |
| span.shuttle-tab__label | 일요일 | 297,77 | 34×20 | 13 | 값·상태·라벨 |
| span.shuttle-chip__label | 학교 도착 | 29,123 | 48×20 | 13 | 값·상태·라벨 |
| span.shuttle-chip__count | 0 | 81,124 | 20×18 | 11 | 값·상태·라벨 |
| span.shuttle-chip__label | 터미널 도착 | 131,123 | 60×20 | 13 | 값·상태·라벨 |
| span.shuttle-chip__count | 16 | 195,124 | 23×18 | 11 | 값·상태·라벨 |
| p.shuttle-strip__line | 일요일 시간표로 운행합니다 · 개천절대체휴일: 일요일 시간표로 운행 | 31,167 | 331×43 | 14 | §9-4 예외(상태 1줄) |
| span.shuttle-departure__time | 09:00 | 28,55 | 52×20 | 15 | 값·상태·라벨 |
| span.shuttle-departure__route | 아산(KTX)역 | 92,44 | 80×20 | 15 | 값·상태·라벨 |
| span.shuttle-departure__dir | 학교에서 출발 · 09:20 도착 · 약 20분 소요 | 92,68 | 270×17 | 13 | 값·상태·라벨 |
| span.shuttle-departure__time | 09:00 | 28,111 | 52×20 | 15 | 값·상태·라벨 |
| span.shuttle-departure__route | 천안역 | 92,100 | 39×20 | 15 | 값·상태·라벨 |
| span.shuttle-departure__dir | 학교에서 출발 · 09:30 도착 | 92,124 | 270×17 | 13 | 값·상태·라벨 |
| span.shuttle-departure__time | 09:00 | 28,167 | 52×20 | 15 | 값·상태·라벨 |
| span.shuttle-departure__route | 천안터미널 | 92,156 | 65×20 | 15 | 값·상태·라벨 |
| span.shuttle-departure__dir | 학교에서 출발 · 09:30 도착 | 92,180 | 270×17 | 13 | 값·상태·라벨 |
| span.shuttle-departure__time | 12:00 | 28,223 | 52×20 | 15 | 값·상태·라벨 |
| span.shuttle-departure__route | 아산(KTX)역 | 92,212 | 80×20 | 15 | 값·상태·라벨 |
| span.shuttle-departure__dir | 학교에서 출발 · 12:20 도착 · 약 20분 소요 | 92,236 | 270×17 | 13 | 값·상태·라벨 |
| span.shuttle-departure__time | 12:00 | 28,279 | 52×20 | 15 | 값·상태·라벨 |
| span.shuttle-departure__route | 천안역 | 92,268 | 39×20 | 15 | 값·상태·라벨 |
| span.shuttle-departure__dir | 학교에서 출발 · 12:30 도착 | 92,292 | 270×17 | 13 | 값·상태·라벨 |
| span.shuttle-departure__time | 12:00 | 28,335 | 52×20 | 15 | 값·상태·라벨 |
| span.shuttle-departure__route | 천안터미널 | 92,324 | 65×20 | 15 | 값·상태·라벨 |
| span.shuttle-departure__dir | 학교에서 출발 · 12:30 도착 | 92,348 | 270×17 | 13 | 값·상태·라벨 |
| span.shuttle-departure__time | 16:00 | 28,391 | 52×20 | 15 | 값·상태·라벨 |
| span.shuttle-departure__route | 천안역 | 92,380 | 82×20 | 15 | 값·상태·라벨 |
| span.shuttle-departure__dir | 학교에서 출발 · 16:30 도착 | 92,404 | 270×17 | 13 | 값·상태·라벨 |
| span.shuttle-departure__time | 16:00 | 28,447 | 52×20 | 15 | 값·상태·라벨 |
| span.shuttle-departure__route | 천안터미널 | 92,436 | 65×20 | 15 | 값·상태·라벨 |
| span.shuttle-departure__dir | 학교에서 출발 · 16:30 도착 | 92,460 | 270×17 | 13 | 값·상태·라벨 |
| span.shuttle-departure__time | 16:10 | 28,503 | 52×20 | 15 | 값·상태·라벨 |
| span.shuttle-departure__route | 아산(KTX)역 | 92,492 | 81×20 | 15 | 값·상태·라벨 |
| span.shuttle-departure__dir | 학교에서 출발 · 16:30 도착 · 약 20분 소요 | 92,516 | 270×17 | 13 | 값·상태·라벨 |
| span.shuttle-departure__time | 18:00 | 28,559 | 52×20 | 15 | 값·상태·라벨 |
| span.shuttle-departure__route | 천안터미널 | 92,548 | 65×20 | 15 | 값·상태·라벨 |
| span.shuttle-departure__dir | 학교에서 출발 · 18:30 도착 | 92,572 | 270×17 | 13 | 값·상태·라벨 |
| span.shuttle-departure__time | 18:10 | 28,615 | 52×20 | 15 | 값·상태·라벨 |
| span.shuttle-departure__route | 천안역 | 92,604 | 39×20 | 15 | 값·상태·라벨 |
| span.shuttle-departure__dir | 학교에서 출발 · 18:40 도착 | 92,628 | 270×17 | 13 | 값·상태·라벨 |
| span.shuttle-departure__time | 18:20 | 28,671 | 52×20 | 15 | 값·상태·라벨 |
| span.shuttle-departure__route | 아산(KTX)역 | 92,660 | 81×20 | 15 | 값·상태·라벨 |
| span.shuttle-departure__dir | 학교에서 출발 · 18:40 도착 · 약 20분 소요 | 92,684 | 270×17 | 13 | 값·상태·라벨 |
| span.shuttle-departure__time | 19:00 | 28,727 | 52×20 | 15 | 값·상태·라벨 |
| span.shuttle-departure__route | 천안역 | 92,716 | 39×20 | 15 | 값·상태·라벨 |
| span.shuttle-departure__dir | 학교에서 출발 · 19:30 도착 | 92,740 | 270×17 | 13 | 값·상태·라벨 |
| span.shuttle-departure__time | 19:10 | 28,783 | 52×20 | 15 | 값·상태·라벨 |
| span.shuttle-departure__route | 아산(KTX)역 | 92,772 | 81×20 | 15 | 값·상태·라벨 |
| span.shuttle-departure__dir | 학교에서 출발 · 19:30 도착 · 약 20분 소요 | 92,796 | 270×17 | 13 | 값·상태·라벨 |
| span.shuttle-departure__time | 19:30 | 28,839 | 52×20 | 15 | 값·상태·라벨 |
| span.shuttle-departure__route | 천안터미널 | 92,828 | 65×20 | 15 | 값·상태·라벨 |
| span.shuttle-departure__dir | 학교에서 출발 · 20:00 도착 | 92,852 | 270×17 | 13 | 값·상태·라벨 |
| span.shuttle-departure__time | 20:00 | 28,895 | 52×20 | 15 | 값·상태·라벨 |
| span.shuttle-departure__route | 아산(KTX)역 | 92,884 | 81×20 | 15 | 값·상태·라벨 |
| span.shuttle-departure__dir | 학교에서 출발 · 20:20 도착 · 약 20분 소요 | 92,908 | 270×17 | 13 | 값·상태·라벨 |


### ④ dark — 대비 실측(전체 61개 텍스트 노드)

| 요소 | 문구 | 전경 | 배경 | 크기 | 대비 | 기준 |
|---|---|---|---|---|---|---|
| a.shuttle-skip-link | 본문으로 건너뛰기 | rgb(16, 22, 29) | rgb(95, 195, 207) | 16px | 8.83:1 | ≥4.5 |
| time.shuttle-appbar__clock | 10월 5일 (월) · 14:40 | rgb(238, 242, 246) | rgb(18, 22, 27) | 15px bold | 16.14:1 | ≥4.5 |
| button.shuttle-button.shuttle-button--secondary.shuttle-appbar__info | ⓘ | rgb(95, 195, 207) | rgb(18, 22, 27) | 16px | 8.82:1 | ≥4.5 |
| span.shuttle-tab__label | 평일 | rgb(95, 195, 207) | rgb(23, 58, 64) | 13px | 5.94:1 | ≥4.5 |
| span.shuttle-tab__label | 토요일 | rgb(185, 195, 206) | rgb(34, 42, 51) | 13px | 8.13:1 | ≥4.5 |
| span.shuttle-tab__label | 일요일 | rgb(185, 195, 206) | rgb(34, 42, 51) | 13px | 8.13:1 | ≥4.5 |
| span.shuttle-chip__label | 학교 도착 | rgb(154, 166, 178) | rgb(27, 33, 41) | 13px | 6.54:1 | ≥4.5 |
| span.shuttle-chip__count | 0 | rgb(154, 166, 178) | rgb(34, 42, 51) | 11px bold | 5.85:1 | ≥4.5 |
| span.shuttle-chip__label | 터미널 도착 | rgb(16, 22, 29) | rgb(95, 195, 207) | 13px bold | 8.83:1 | ≥4.5 |
| span.shuttle-chip__count | 16 | rgb(16, 22, 29) | rgb(95, 195, 207) | 11px bold | 8.83:1 | ≥4.5 |
| p.shuttle-strip__line | 일요일 시간표로 운행합니다 · 개천절대체휴일: 일요일  | rgb(189, 211, 245) | rgb(27, 39, 64) | 14px | 9.78:1 | ≥4.5 |
| span.shuttle-departure__time | 09:00 | rgb(185, 195, 206) | rgb(27, 33, 41) | 15px | 9.07:1 | ≥4.5 |
| span.shuttle-departure__route | 아산(KTX)역 | rgb(185, 195, 206) | rgb(27, 33, 41) | 15px | 9.07:1 | ≥4.5 |
| span.shuttle-departure__dir | 학교에서 출발 · 09:20 도착 · 약 20분 소요 | rgb(185, 195, 206) | rgb(27, 33, 41) | 13px | 9.07:1 | ≥4.5 |
| span.shuttle-departure__time | 09:00 | rgb(185, 195, 206) | rgb(27, 33, 41) | 15px | 9.07:1 | ≥4.5 |
| span.shuttle-departure__route | 천안역 | rgb(185, 195, 206) | rgb(27, 33, 41) | 15px | 9.07:1 | ≥4.5 |
| span.shuttle-departure__dir | 학교에서 출발 · 09:30 도착 | rgb(185, 195, 206) | rgb(27, 33, 41) | 13px | 9.07:1 | ≥4.5 |
| span.shuttle-departure__time | 09:00 | rgb(185, 195, 206) | rgb(27, 33, 41) | 15px | 9.07:1 | ≥4.5 |
| span.shuttle-departure__route | 천안터미널 | rgb(185, 195, 206) | rgb(27, 33, 41) | 15px | 9.07:1 | ≥4.5 |
| span.shuttle-departure__dir | 학교에서 출발 · 09:30 도착 | rgb(185, 195, 206) | rgb(27, 33, 41) | 13px | 9.07:1 | ≥4.5 |
| span.shuttle-departure__time | 12:00 | rgb(185, 195, 206) | rgb(27, 33, 41) | 15px | 9.07:1 | ≥4.5 |
| span.shuttle-departure__route | 아산(KTX)역 | rgb(185, 195, 206) | rgb(27, 33, 41) | 15px | 9.07:1 | ≥4.5 |
| span.shuttle-departure__dir | 학교에서 출발 · 12:20 도착 · 약 20분 소요 | rgb(185, 195, 206) | rgb(27, 33, 41) | 13px | 9.07:1 | ≥4.5 |
| span.shuttle-departure__time | 12:00 | rgb(185, 195, 206) | rgb(27, 33, 41) | 15px | 9.07:1 | ≥4.5 |
| span.shuttle-departure__route | 천안역 | rgb(185, 195, 206) | rgb(27, 33, 41) | 15px | 9.07:1 | ≥4.5 |
| span.shuttle-departure__dir | 학교에서 출발 · 12:30 도착 | rgb(185, 195, 206) | rgb(27, 33, 41) | 13px | 9.07:1 | ≥4.5 |
| span.shuttle-departure__time | 12:00 | rgb(185, 195, 206) | rgb(27, 33, 41) | 15px | 9.07:1 | ≥4.5 |
| span.shuttle-departure__route | 천안터미널 | rgb(185, 195, 206) | rgb(27, 33, 41) | 15px | 9.07:1 | ≥4.5 |
| span.shuttle-departure__dir | 학교에서 출발 · 12:30 도착 | rgb(185, 195, 206) | rgb(27, 33, 41) | 13px | 9.07:1 | ≥4.5 |
| span.shuttle-departure__time | 16:00 | rgb(95, 195, 207) | rgb(29, 50, 54) | 15px bold | 6.53:1 | ≥4.5 |
| span.shuttle-departure__route | 천안역 | rgb(238, 242, 246) | rgb(29, 50, 54) | 15px | 11.95:1 | ≥4.5 |
| span.shuttle-departure__dir | 학교에서 출발 · 16:30 도착 | rgb(185, 195, 206) | rgb(29, 50, 54) | 13px | 7.53:1 | ≥4.5 |
| span.shuttle-departure__time | 16:00 | rgb(238, 242, 246) | rgb(27, 33, 41) | 15px bold | 14.4:1 | ≥4.5 |
| span.shuttle-departure__route | 천안터미널 | rgb(238, 242, 246) | rgb(27, 33, 41) | 15px | 14.4:1 | ≥4.5 |
| span.shuttle-departure__dir | 학교에서 출발 · 16:30 도착 | rgb(185, 195, 206) | rgb(27, 33, 41) | 13px | 9.07:1 | ≥4.5 |
| span.shuttle-departure__time | 16:10 | rgb(238, 242, 246) | rgb(27, 33, 41) | 15px bold | 14.4:1 | ≥4.5 |
| span.shuttle-departure__route | 아산(KTX)역 | rgb(238, 242, 246) | rgb(27, 33, 41) | 15px | 14.4:1 | ≥4.5 |
| span.shuttle-departure__dir | 학교에서 출발 · 16:30 도착 · 약 20분 소요 | rgb(185, 195, 206) | rgb(27, 33, 41) | 13px | 9.07:1 | ≥4.5 |
| span.shuttle-departure__time | 18:00 | rgb(238, 242, 246) | rgb(27, 33, 41) | 15px bold | 14.4:1 | ≥4.5 |
| span.shuttle-departure__route | 천안터미널 | rgb(238, 242, 246) | rgb(27, 33, 41) | 15px | 14.4:1 | ≥4.5 |
| span.shuttle-departure__dir | 학교에서 출발 · 18:30 도착 | rgb(185, 195, 206) | rgb(27, 33, 41) | 13px | 9.07:1 | ≥4.5 |
| span.shuttle-departure__time | 18:10 | rgb(238, 242, 246) | rgb(27, 33, 41) | 15px bold | 14.4:1 | ≥4.5 |
| span.shuttle-departure__route | 천안역 | rgb(238, 242, 246) | rgb(27, 33, 41) | 15px | 14.4:1 | ≥4.5 |
| span.shuttle-departure__dir | 학교에서 출발 · 18:40 도착 | rgb(185, 195, 206) | rgb(27, 33, 41) | 13px | 9.07:1 | ≥4.5 |
| span.shuttle-departure__time | 18:20 | rgb(238, 242, 246) | rgb(27, 33, 41) | 15px bold | 14.4:1 | ≥4.5 |
| span.shuttle-departure__route | 아산(KTX)역 | rgb(238, 242, 246) | rgb(27, 33, 41) | 15px | 14.4:1 | ≥4.5 |
| span.shuttle-departure__dir | 학교에서 출발 · 18:40 도착 · 약 20분 소요 | rgb(185, 195, 206) | rgb(27, 33, 41) | 13px | 9.07:1 | ≥4.5 |
| span.shuttle-departure__time | 19:00 | rgb(238, 242, 246) | rgb(27, 33, 41) | 15px bold | 14.4:1 | ≥4.5 |
| span.shuttle-departure__route | 천안역 | rgb(238, 242, 246) | rgb(27, 33, 41) | 15px | 14.4:1 | ≥4.5 |
| span.shuttle-departure__dir | 학교에서 출발 · 19:30 도착 | rgb(185, 195, 206) | rgb(27, 33, 41) | 13px | 9.07:1 | ≥4.5 |
| span.shuttle-departure__time | 19:10 | rgb(238, 242, 246) | rgb(27, 33, 41) | 15px bold | 14.4:1 | ≥4.5 |
| span.shuttle-departure__route | 아산(KTX)역 | rgb(238, 242, 246) | rgb(27, 33, 41) | 15px | 14.4:1 | ≥4.5 |
| span.shuttle-departure__dir | 학교에서 출발 · 19:30 도착 · 약 20분 소요 | rgb(185, 195, 206) | rgb(27, 33, 41) | 13px | 9.07:1 | ≥4.5 |
| span.shuttle-departure__time | 19:30 | rgb(238, 242, 246) | rgb(27, 33, 41) | 15px bold | 14.4:1 | ≥4.5 |
| span.shuttle-departure__route | 천안터미널 | rgb(238, 242, 246) | rgb(27, 33, 41) | 15px | 14.4:1 | ≥4.5 |
| span.shuttle-departure__dir | 학교에서 출발 · 20:00 도착 | rgb(185, 195, 206) | rgb(27, 33, 41) | 13px | 9.07:1 | ≥4.5 |
| span.shuttle-departure__time | 20:00 | rgb(238, 242, 246) | rgb(27, 33, 41) | 15px bold | 14.4:1 | ≥4.5 |
| span.shuttle-departure__route | 아산(KTX)역 | rgb(238, 242, 246) | rgb(27, 33, 41) | 15px | 14.4:1 | ≥4.5 |
| span.shuttle-departure__dir | 학교에서 출발 · 20:20 도착 · 약 20분 소요 | rgb(185, 195, 206) | rgb(27, 33, 41) | 13px | 9.07:1 | ≥4.5 |
| p.shuttle-splash__title | 선문대 셔틀 | rgb(238, 242, 246) | rgb(18, 22, 27) | 28px bold (큰글씨) | 16.14:1 | ≥3 |
| p.shuttle-splash__message | 시간표 불러오는 중 | rgb(185, 195, 206) | rgb(18, 22, 27) | 14px | 10.17:1 | ≥4.5 |

미달: 0건


#### dark — 터치 타깃 실측(16개)

| 요소 | 문구 | 폭 | 높이 | 최소(문서) |
|---|---|---|---|---|
| a.shuttle-skip-link | 본문으로 건너뛰기 | 139px | 48px | 48×48 |
| button.shuttle-button.shuttle-button--secondary.shuttle-appbar__info | ⓘ | 48px | 48px | 48×48 |
| button.shuttle-tab | 평일 | 119px | 40px | 48×40 |
| button.shuttle-tab | 토요일 | 119px | 40px | 48×40 |
| button.shuttle-tab | 일요일 | 119px | 40px | 48×40 |
| button.shuttle-chip.shuttle-chip--empty | 학교 도착 0 | 94px | 44px | 48×44 |
| button.shuttle-chip | 터미널 도착 16 | 108px | 44px | 48×44 |
| section.shuttle-tabpanel.shuttle-tabpanel--enter | 시간표09:00아산(KTX)역학교에서 출발 · 09 | 358px | 1024px | 48×48 |
| button.shuttle-icon-button |  | 48px | 48px | 48×48 |
| button.shuttle-icon-button.shuttle-sheet__close |  | 48px | 48px | 48×48 |
| summary | 정차 시간 안내 | 334px | 48px | 48×48 |
| summary | 시내버스 참고 | 334px | 48px | 48×48 |
| a | 학교 안내 페이지 열기 | 112px | 48px | 48×48 |
| a | 개인정보처리방침 | 90px | 48px | 48×48 |
| button.shuttle-chip | 터미널 도착 12 | 108px | 44px | 48×44 |
| section.shuttle-tabpanel.shuttle-tabpanel--enter | 시간표08:00아산(KTX)역학교에서 출발 · 08 | 358px | 800px | 48×48 |

규격 미달: 0건

레이아웃: 요소 307개 · body bg=rgb(18, 22, 27) · body color=rgb(238, 242, 246) · scrollWidth=390 ≤ clientWidth=390


#### 안전영역 토큰 주입 실측
- --safe-area-top=59px · --safe-area-bottom=34px 주입 → padding-top=59px · padding-bottom=34px


### ⑦ 전체화면(standalone, --app= 모드)
- matchMedia('(display-mode: standalone)') = true
- 설치 안내 문구 0건(§13-2 로 삭제 — 옛 "이미 설치 상태라 미표시" 조건이 아니다)
- 스크린샷: /Users/leeheesun/Documents/GitHub/sunmoon-shuttle/.session-notes/T7-standalone.png


### ⑧ 개인정보처리방침(privacy.html · T11)
- URL: http://127.0.0.1:49887/sunmoon-shuttle/privacy.html (HTTP 200, 6238B)
- h1: 개인정보처리방침 · 필수 문구 누락: 0건
- body bg=rgb(243, 246, 247) · color=rgb(22, 34, 42) · 가로 스크롤 없음(scrollWidth=390)
- 푸터 링크: {"href":"./privacy.html","text":"개인정보처리방침","resolved":"http://127.0.0.1:49887/sunmoon-shuttle/privacy.html"}
- 스크린샷: /Users/leeheesun/Documents/GitHub/sunmoon-shuttle/.session-notes/T11-privacy.png

| 요소 | 문구 | 전경 | 배경 | 크기 | 대비 | 기준 |
|---|---|---|---|---|---|---|
| a.privacy-back | ← 앱으로 돌아가기 | rgb(0, 104, 122) | rgb(243, 246, 247) | 16px bold | 5.93:1 | ≥4.5 |
| h1.privacy-title | 개인정보처리방침 | rgb(22, 34, 42) | rgb(243, 246, 247) | 28px bold (큰글씨) | 14.92:1 | ≥3 |
| p.privacy-lead | (이하 “이 앱”)는 앱이며 학교의 공식 앱이
     | rgb(22, 34, 42) | rgb(243, 246, 247) | 16px | 14.92:1 | ≥4.5 |
| strong | 선문대 셔틀버스 시간표 | rgb(22, 34, 42) | rgb(243, 246, 247) | 16px bold | 14.92:1 | ≥4.5 |
| strong | 비공식 | rgb(22, 34, 42) | rgb(243, 246, 247) | 16px bold | 14.92:1 | ≥4.5 |
| strong | 이용자의 개인정보를 수집하지 않습니다. | rgb(22, 34, 42) | rgb(243, 246, 247) | 16px bold | 14.92:1 | ≥4.5 |
| h2 | 1. 수집하는 개인정보 항목 — 없음 | rgb(22, 34, 42) | rgb(243, 246, 247) | 20px bold (큰글씨) | 14.92:1 | ≥3 |
| p | 이 앱에는 회원가입·로그인 기능이 없고, 계정·이름·이 | rgb(22, 34, 42) | rgb(243, 246, 247) | 16px | 14.92:1 | ≥4.5 |
| strong | 수집하지 않습니다. | rgb(22, 34, 42) | rgb(243, 246, 247) | 16px bold | 14.92:1 | ≥4.5 |
| li | 위치 정보(GPS) — 수집하지 않습니다. | rgb(22, 34, 42) | rgb(243, 246, 247) | 16px | 14.92:1 | ≥4.5 |
| li | 기기 식별자·광고 ID — 수집하지 않습니다. | rgb(22, 34, 42) | rgb(243, 246, 247) | 16px | 14.92:1 | ≥4.5 |
| li | 사용 기록·이용 통계·쿠키 기반 추적 — 수집하지 않습 | rgb(22, 34, 42) | rgb(243, 246, 247) | 16px | 14.92:1 | ≥4.5 |
| p | 수집하는 개인정보 항목이 없으므로 개인정보의 이용·보유 | rgb(22, 34, 42) | rgb(243, 246, 247) | 16px | 14.92:1 | ≥4.5 |
| h2 | 2. 기기에 저장되는 정보 — 로컬 저장만 | rgb(22, 34, 42) | rgb(243, 246, 247) | 20px bold (큰글씨) | 14.92:1 | ≥3 |
| p | 이 앱은 서버를 운영하지 않으며, 이용자의 정보를 외부 | rgb(22, 34, 42) | rgb(243, 246, 247) | 16px | 14.92:1 | ≥4.5 |
| strong | 오프라인에서도 시간표를 바로 보여주고 화면 설정을 기억 | rgb(22, 34, 42) | rgb(243, 246, 247) | 16px bold | 14.92:1 | ≥4.5 |
| li | — 원본 시간표에서 추출한 시간표 JSON, 내용 해시 | rgb(22, 34, 42) | rgb(243, 246, 247) | 16px | 14.92:1 | ≥4.5 |
| strong | IndexedDB | rgb(22, 34, 42) | rgb(243, 246, 247) | 16px bold | 14.92:1 | ≥4.5 |
| li | — 화면 설정(마지막으로 고른 요일·방향 필터)과 그  | rgb(22, 34, 42) | rgb(243, 246, 247) | 16px | 14.92:1 | ≥4.5 |
| strong | localStorage | rgb(22, 34, 42) | rgb(243, 246, 247) | 16px bold | 14.92:1 | ≥4.5 |
| p | 이 값들은 브라우저(또는 앱) 안에만 있고 외부로 전송 | rgb(22, 34, 42) | rgb(243, 246, 247) | 16px | 14.92:1 | ≥4.5 |
| h2 | 3. 제3자 제공 · 광고 · 분석 도구 — 없음 | rgb(22, 34, 42) | rgb(243, 246, 247) | 20px bold (큰글씨) | 14.92:1 | ≥3 |
| p | 이 앱은 개인정보를 또한 이 앱은 , 광고·분석(트래킹 | rgb(22, 34, 42) | rgb(243, 246, 247) | 16px | 14.92:1 | ≥4.5 |
| strong | 제3자에게 제공하지 않습니다. | rgb(22, 34, 42) | rgb(243, 246, 247) | 16px bold | 14.92:1 | ≥4.5 |
| strong | 광고를 게재하지 않으며 | rgb(22, 34, 42) | rgb(243, 246, 247) | 16px bold | 14.92:1 | ≥4.5 |
| p | 이 앱이 네트워크로 요청하는 대상은 앱 화면 파일(HT | rgb(22, 34, 42) | rgb(243, 246, 247) | 16px | 14.92:1 | ≥4.5 |
| h2 | 4. 외부 링크(원본 페이지)로 이동할 때 | rgb(22, 34, 42) | rgb(243, 246, 247) | 20px bold (큰글씨) | 14.92:1 | ≥3 |
| p | 이 앱은 시간표 출처를 밝히기 위해 선문대학교 원본 페 | rgb(22, 34, 42) | rgb(243, 246, 247) | 16px | 14.92:1 | ≥4.5 |
| strong | 그 사이트의 개인정보 정책이 적용 | rgb(22, 34, 42) | rgb(243, 246, 247) | 16px bold | 14.92:1 | ≥4.5 |
| h2 | 5. 아동의 개인정보 | rgb(22, 34, 42) | rgb(243, 246, 247) | 20px bold (큰글씨) | 14.92:1 | ≥3 |
| p | 이 앱은 개인정보를 수집하지 않으므로 아동(만 14세  | rgb(22, 34, 42) | rgb(243, 246, 247) | 16px | 14.92:1 | ≥4.5 |
| h2 | 6. 문의처 | rgb(22, 34, 42) | rgb(243, 246, 247) | 20px bold (큰글씨) | 14.92:1 | ≥3 |
| li | 시간표·운행 안내(원본 안내문): 학생지원팀 | rgb(22, 34, 42) | rgb(243, 246, 247) | 16px | 14.92:1 | ≥4.5 |
| a | 041-530-2152 | rgb(0, 104, 122) | rgb(243, 246, 247) | 16px | 5.93:1 | ≥4.5 |
| li | 앱·개인정보 관련 문의: | rgb(22, 34, 42) | rgb(243, 246, 247) | 16px | 14.92:1 | ≥4.5 |
| a | GitHub 저장소 이슈 | rgb(0, 104, 122) | rgb(243, 246, 247) | 16px | 5.93:1 | ≥4.5 |
| p | 개인정보를 수집하지 않으므로 열람·정정·삭제 요청의 대 | rgb(22, 34, 42) | rgb(243, 246, 247) | 16px | 14.92:1 | ≥4.5 |
| h2 | 7. 시행일 · 개정 이력 | rgb(22, 34, 42) | rgb(243, 246, 247) | 20px bold (큰글씨) | 14.92:1 | ≥3 |
| li | 시행일: 2026-10-05 | rgb(22, 34, 42) | rgb(243, 246, 247) | 16px | 14.92:1 | ≥4.5 |
| li | v1.0 (2026-10-05) — 최초 제정 | rgb(22, 34, 42) | rgb(243, 246, 247) | 16px | 14.92:1 | ≥4.5 |
| p | 이 앱은 학교 공식 앱이 아닙니다(비공식). 시간표 저 | rgb(91, 104, 112) | rgb(243, 246, 247) | 14px | 5.28:1 | ≥4.5 |
| a | 원본 페이지 열기 | rgb(0, 104, 122) | rgb(243, 246, 247) | 14px | 5.93:1 | ≥4.5 |

미달: 0건
