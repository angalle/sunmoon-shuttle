# 05 · 스토어 등록 문구 · 개인정보처리방침 (T11)

이 문서는 **Google Play / App Store 제출에 그대로 붙여넣을 수 있는 문구 초안**과 **개인정보처리방침 URL**을 담는다.
근거: `docs/00-requirements.md`(범위 밖: 실시간 위치·예약·결제) · `docs/01-architecture.md` §7(스토어 정책 리스크) · `docs/03-verification.md` §7(AC-8: 수집 0 실측).

- 앱 id(Android): `com.angalle.sunmoonshuttle` · 웹/PWA: `https://angalle.github.io/sunmoon-shuttle/`
- 공통 전제: **비공식 앱**(학교 공식 아님) · **사용자 생성 콘텐츠 0** · **광고 0** · **개인정보 수집 0** · **무료**(과금 요소 없음)

---

## 1. 개인정보처리방침 URL (스토어 필수 입력)

| 항목 | 값 |
|---|---|
| 방침 페이지(배포 URL) | `https://angalle.github.io/sunmoon-shuttle/privacy.html` |
| 소스 | `public/privacy.html` (+ `public/privacy.css`) — 빌드 시 `dist/privacy.html` 로 복사되어 Pages 가 서빙 |
| 시행일 | 2026-10-05 |
| 문의 | 시간표·운행: 학생지원팀 041-530-2152(원본 안내문) · 앱·개인정보: GitHub 저장소 이슈 |

> ⚠️ **URL 유효 시점**: 위 URL 은 `main` push(=Pages 배포) 이후에 살아난다. 현재 배포본은 T5 시점이라
> `privacy.html` 이 아직 서빙되지 않는다 → **push 승인 후 `curl -sI` 로 200 확인이 필요하다(총괄/사용자).**

---

## 2. 앱 이름 · 설명 (붙여넣기용)

### 2-1. 앱 이름

| 언어 | 값 |
|---|---|
| 한국어 | `선문대 셔틀버스 시간표` |
| English | `Sunmoon Shuttle Bus Timetable` |

기존 `manifest.webmanifest` 의 `name`/`short_name` 과 같은 표기를 쓴다(공식 앱으로 오인될 표기는 쓰지 않는다).

### 2-2. 짧은 설명 (Play: 최대 80자)

<!-- store:short:ko -->
선문대 셔틀버스 시간표를 오프라인에서도 바로 확인하는 비공식 시간표 앱입니다.
<!-- /store:short:ko -->

<!-- store:short:en -->
Unofficial offline timetable for Sunmoon University shuttle buses.
<!-- /store:short:en -->

### 2-3. 전체 설명 (Play: 최대 4000자)

<!-- store:full:ko -->
선문대학교 셔틀버스 시간표를 오프라인에서도 바로 확인할 수 있는 비공식 시간표 앱입니다.

■ 무엇을 할 수 있나요
· 노선(아산(KTX)역 · 천안역 · 천안터미널 · 온양역/터미널 · 천안캠퍼스) × 요일(평일/토요일/일요일) 시간표를 원본 그대로 확인
· 지금 시각 기준으로 "다음 버스"까지 남은 시간을 자동 표시
· 데이터를 받은 시각(신선도)과 원본 페이지 최신 업데이트 시각을 함께 표시
· 한 번 열어두면 오프라인에서도 마지막으로 받은 시간표를 그대로 보여줍니다

■ 원본과의 관계
이 앱은 학교 공식 앱이 아닙니다(비공식). 시간표 저작권은 학교에 있으며, 앱은 학교가 공개한 원본 시간표 페이지를 출처로 표시하고 그 내용을 그대로 보여줍니다. 표기 중 해석하지 못한 항목은 임의로 판단하지 않고 그대로 안내합니다.

■ 개인정보
이 앱은 개인정보를 수집하지 않습니다. 계정·위치·기기 식별자·광고 ID를 받지 않고, 광고도 게재하지 않습니다.
오프라인 표시를 위한 시간표 데이터만 기기 안에 저장되며 외부로 전송되지 않습니다.
자세한 내용: https://angalle.github.io/sunmoon-shuttle/privacy.html

■ 이용 안내
표시되는 시간표는 학교 원본 페이지 기준입니다. 운행 변경·중단 여부는 아래 문의처로 확인해 주세요.
· 시간표·운행 문의: 학생지원팀 041-530-2152
· 앱 관련 문의: https://github.com/angalle/sunmoon-shuttle/issues
<!-- /store:full:ko -->

<!-- store:full:en -->
An unofficial, offline-first timetable viewer for Sunmoon University shuttle buses.

WHAT IT DOES
· Shows the original timetable for every route (Asan KTX, Cheonan Station, Cheonan Terminal, Onyang, Cheonan Campus) by day type (weekday / Saturday / Sunday)
· Counts down to the next departure from the current time
· Shows when the data was fetched and when the source page was last updated
· Keeps working offline with the last data it received
· Add to Home Screen to open it fullscreen like an app

ABOUT THE SOURCE
This is NOT an official university app (unofficial). The timetable copyright belongs to the university. The app credits and displays the university's published timetable pages as-is and never invents a departure that the source does not state.

PRIVACY
The app collects no personal data: no account, no location, no device identifier, no advertising ID, and no ads.
Only the timetable data is stored on your device for offline display and is never sent anywhere.
Details: https://angalle.github.io/sunmoon-shuttle/privacy.html

CONTACT
· Timetable / operation: Student Support Team +82-41-530-2152
· App issues: https://github.com/angalle/sunmoon-shuttle/issues
<!-- /store:full:en -->

---

## 3. 카테고리

| 스토어 | 주 카테고리 | 보조/대체 |
|---|---|---|
| Google Play | 여행 및 지역정보 (Travel & Local) | 대체: 지도 및 내비게이션 |
| App Store | Travel | 보조: Utilities |

교육 카테고리는 학교 공식 앱으로 오인될 소지가 있어 쓰지 않는다(비공식 고지 원칙, `docs/01 §7`).

---

## 4. 콘텐츠 등급 근거

| 설문 항목 | 사실 | 근거 |
|---|---|---|
| 폭력·선정성·욕설·도박·약물 | 없음 | 텍스트 시간표 뷰어 |
| 사용자 생성 콘텐츠·사용자 간 소통 | **없음** | 입력 폼·댓글·업로드 기능 0 |
| 광고 | **없음** | 광고 SDK·광고 슬롯 0 (`docs/03 §7.1-4` 네트워크 감사: 제3자 도메인 0) |
| 인앱 결제·구독 | 없음 | 과금 리소스 0 |
| 개인정보 수집 | **없음** | 방침 §1, 네트워크 요청 8건 전부 동일 출처 |
| 외부 링크 | 있음(학교 원본 페이지 1종) | Play 설문의 "외부 링크 포함" 항목 체크 대상 |
| 위치 공유 | 없음 | 위치 권한 미사용 |

→ 예상 등급: **Google Play 전체이용가 / App Store 4+**(외부 링크 1건만 해당).

---

## 5. Data safety (Google Play) 응답 초안

| 질문 | 응답 |
|---|---|
| 앱이 필수 사용자 데이터를 수집하거나 공유하나요? | **아니요** — 수집·공유하는 데이터 유형이 없습니다 |
| 데이터 유형(위치·개인 정보·금융·건강·메시지·사진/동영상·오디오·파일·연락처·캘린더·앱 활동·웹 검색 기록·앱 정보/성능·기기 ID) | 전부 **수집 안 함**(14개 유형 모두 미선택) |
| 데이터가 전송 중 암호화되나요? | 서버로 보내는 사용자 데이터가 없습니다. 앱은 **HTTPS로만** 통신하며 정적 자산·시간표 JSON을 받기만 합니다 |
| 사용자가 데이터 삭제를 요청할 수 있나요? | **해당 없음**(수집하지 않으므로 삭제할 서버 데이터가 없음). 기기에 남은 시간표 데이터는 앱/브라우저 저장 데이터 삭제로 제거됩니다 |
| 데이터 처리가 가족 정책(아동) 요건을 충족하나요? | 수집이 없어 해당 없음(방침 §5) |
| 독립적 보안 검토 | 없음 |

**Apple App Privacy(영양성분표)** 초안: **Data Not Collected** — 추적(Tracking) 없음 → ATT(App Tracking Transparency) 프롬프트 불필요.
개인정보처리방침 URL 필수 입력 → §1 URL 사용.

---

## 6. 비공식 고지 문구(앱 설명·스토어 문구에 공통 포함)

앱 푸터(`src/adapters/in/web/features/schedule/types/texts.ts` 의 `unofficialNotice`)와 같은 핵심 문장을 쓴다.

> 이 앱은 학교 공식 앱이 아닙니다(비공식). 시간표 저작권은 학교에 있으며, 원본 페이지를 출처로 표시합니다.

방침 페이지(`public/privacy.html`)에도 같은 취지가 들어 있다(문구 정합은 `tests/web/privacy.test.ts` 가 검사).

---

## 7. 심사 리스크와 대응

| 리스크 | 대응(이미 반영된 것) |
|---|---|
| 비공식 앱 반려 | 앱 이름·설명에 "비공식" 명시, 푸터·방침에 고지, 원본 링크 표시 |
| 저작권(시간표) 문제 | 시간표 저작권은 학교에 있음을 고지, 원본 내용을 그대로 표시(창작물 아님) |
| 개인정보 방침 누락 | `privacy.html` 준비 + 스토어 필수 입력란에 URL 기입 |
| "학교 공식" 오인 | 공식 표기·로고 미사용, 카테고리를 교육으로 두지 않음 |
| 데이터 정확성 문의 | 데이터 신선도(원본 업데이트 시각·반영 시각)를 화면에 표시, 문의처 안내 |

---

## 8. 확인 필요 (총괄)

1. **개발자 연락처(이메일)** — Play 개발자 계정의 공개 연락처. 방침 페이지의 앱 문의 경로는 현재 **GitHub 저장소 이슈**로만 안내한다(모르는 이메일을 지어내지 않았다). 이메일을 넣으려면 값 확정이 필요하다.
2. **`main` push 승인** — §1 URL 이 실제로 200 이 되려면 Pages 배포가 필요하다.
3. Play 개발자 계정 소유·기존 앱 재사용 여부(기존 계정 사용으로 결정됨 — `docs/03 §7`).
