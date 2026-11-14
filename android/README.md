# android/ — Capacitor 안드로이드 패키징 (T8·T25 · InfraProjectCreator)

웹 자산(`dist/`)을 **한 줄도 고치지 않고** Capacitor 로 감싸 AAB/APK 를 만든다.
계약: `docs/01-architecture.md` §6(배포/실행) · `docs/03-verification.md` AC-7 · `docs/07-mobile-ux.md` §3·§5·AC-U8.
증거 원문·실측값: `.session-notes/T8-증거.md`, `.session-notes/T8-*.log`, **`.session-notes/T25-증거.md`**(스플래시·아이콘·상태바·서명·에뮬 스모크).

## 실행 3단계 (재현)

```bash
# 1) 웹 자산 + 계약 데이터 + Capacitor 동기화
node_modules/.bin/cap sync android        # ← 스크립트를 쓰면 아래 한 줄이 1~3단계를 전부 한다

# 또는 전체를 한 번에 (권장)
bash android/build-release.sh            # → android/app/build/outputs/bundle/release/app-release.aab
bash android/build-release.sh debug      # → android/app/build/outputs/apk/debug/app-debug.apk
bash android/build-release.sh verify     # → 산출물 존재·크기·sha256·jarsigner 만 확인
```

`build-release.sh` 가 하는 일(= 손으로 할 때의 순서, 순서를 바꾸면 깨진다):

1. `npm run build` → `dist/` (vite: `base './'` 상대경로 · `emptyOutDir` 로 dist 를 **비운다**)
2. `data/timetable.json` → `dist/data/timetable.json` 복사 **← 이 단계가 없으면 앱이 404 오류 화면을 띄운다**
   (`.github/workflows/deploy.yml` 의 "계약 데이터 동봉" 스텝과 같은 일 — Pages 배포본과 앱 자산을 일치시킨다)
3. `cap sync android` → `android/app/src/main/assets/public/` 로 웹 자산 복사 + 플러그인/설정 갱신
4. `./android/gradlew -p android bundleRelease | assembleDebug` (JDK17 · ANDROID_HOME · build-tools 36 을 PATH 선두에)
5. 산출물 확인: `stat` + `shasum -a 256` + `jarsigner -verify`

### 웹만 바뀐 경우 — 자산 재동기화 (T33)

`dist/` 를 새로 만들었는데 **Android 자산을 다시 넣지 않으면 앱은 옛 UI 를 계속 보여준다**.
실측: T25 빌드 번들 `assets/index-qWPrV94-.js` 가 자산에 남아, **삭제된 설치 안내 카드가 앱에서 계속 보였다**
(`docs/07-mobile-ux.md` §14-1 표 · §14-2 규칙 "수동 복사 금지 — 스크립트로").

```bash
npm run build                                  # dist/ 최신화
node scripts/sync-android-assets.mjs           # dist/ → android/app/src/main/assets/public/  (멱등)
node scripts/sync-android-assets.mjs --check    # 복사 없이 드리프트만 검사 (IN-SYNC / OUT-OF-SYNC)
bash android/build-release.sh                   # AAB 재빌드 (내부의 cap sync 가 자산을 다시 넣는다)
bash scripts/t33_artifact_asset_check.sh        # AAB/APK 안에 옛 번들·금지어 0건 + jarsigner -verify
bash scripts/t33_emulator_smoke.sh [AVD]        # 에뮬: 설치 안내 0건 · 시간표 렌더 · logcat FATAL 0 (CDP 로 DOM 직접 평가)
```

- **옛 해시 번들은 남기지 않는다**: 스크립트는 대상을 지우고 `dist/` 를 통째로 넣는다(Capacitor
  `copyWebDir` 와 같은 의미 — `@capacitor/cli/dist/tasks/copy.js`). 대상에만 남아 있던 파일 중
  `-<hash>.js|.css|.map` 모양이면 **낡은 웹 자산으로 판정해 버린다**. `cordova.js`·`cordova_plugins.js`
  (Capacitor 가 쓰는 0바이트 자리표시자)만 보존한다.
- **멱등**: 2회 실행 시 `CHANGED=0` (수용 기준 AC-U14-3b). 자산 전체의 `manifest` sha256 을 출력하므로
  실행 간·`cap sync` 산출물 간 대조가 가능하다(실측: 두 도구의 manifest 동일).
- **추적 대상 아님**: `android/.gitignore` 96행이 `app/src/main/assets/public` 을 무시한다 → 커밋할 자산은 없다.
  자산은 언제든 위 한 줄로 재생성된다.
- **금지어 감시**(`docs/07-mobile-ux.md` §14-3 AC-U14-3): 산출물·자산 어디에서도 `홈 화면`·`전체화면`·`한 번만`
  이 0건이어야 한다. `t33_artifact_asset_check.sh` 가 AAB/APK 내부까지 풀어서 검사한다.

### T40 — 웹 변경(방향 택1)을 앱 번들에 재반영 + **SW_VERSION 자동 주입 뒤 바뀐 순서**

T33 이후 웹이 T37(여백)·T38(방향 택1 · `전체` 삭제)·T39(SW 버전 자동 주입)으로 바뀌었지만 앱 번들은
T33 시점에 멈춰 있었다 → **앱은 `전체` 칩과 두 방향이 섞인 옛 목록을 계속 보여줬다**(에뮬 실측, 아래).

⚠️ **`build-release.sh` 를 그대로 쓰면 안 되는 이유(T39 이후)**: 그 스크립트는 1단계에서 `npm run build` 를
**다시** 돌린다. T39 부터 `dist/sw.js` 의 `SW_VERSION` 은 빌드 시각(밀리초)+git SHA 로 **자동 주입**되므로,
자산을 sync 한 뒤 `build-release.sh` 를 돌리면 `dist`(사람이 sync 한 값)와 `assets`(재빌드가 다시 만든 값)의
`SW_VERSION` 이 **갈라진다**. 그래서 재반영은 단계를 나눠 실행한다:

```bash
npm run build                                            # ① dist/ 최신화 (SW_VERSION 자동 주입)
mkdir -p dist/data && cp data/timetable.json dist/data/   # ② 계약 데이터 동봉(빌드가 dist 를 비운다)
node scripts/sync-android-assets.mjs                      # ③ dist → assets (여기서 dist 를 더 만들지 않는다)
node scripts/sync-android-assets.mjs                      #    (2회차 CHANGED=0 = 멱등 확인)
export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/build-tools/36.0.0:$PATH"
./android/gradlew -p android bundleRelease assembleDebug  # ④ AAB/APK 재빌드 (cap sync 없이 — 자산을 덮지 않는다)
bash .session-notes/T40-artifact-check.sh                 # ⑤ AAB/APK 내부 자산 == dist · 서명 · 금지어
```

`cap sync` 를 생략해도 되는 이유: `assets/capacitor.config.json`·`capacitor.plugins.json` 은 이미 있고,
이번 변경은 웹 자산뿐이다(플러그인/설정은 그대로).

**실측(T40 · AVD `meteor-dodge-api35` · 2026-10-12)**: 자산 재동기화 `CHANGED=7 → 0` · manifest `d26448a167bd9328`
· 번들 `index-Ubp09QTp.js`(`index-403hrULs.js` 대체) · AAB 2,897,677B `sha256 442e8cbc…` · APK 4,053,139B
`sha256 49aed6c2…` · `jarsigner -verify` 둘 다 `jar verified.` · `SW_VERSION = '20261012-111305-144-ec56e9d'`
(dist == assets == AAB 내부) · 에뮬: **before**(T33 앱) 칩 3개(`전체 115` 눌림 · 목록 115행에 두 방향 섞임) →
**after**(2차 로드) 칩 2개 · 기본 `터미널 도착` 1개 선택 · 목록 91행 전부 `out`(섞임 0) · `전체` 0건 ·
설치 안내 0건 · logcat FATAL/ANR 0. 증거·도구 원문: `.session-notes/T40-*`.

**되돌리기**: 앱 자산은 추적 대상이 아니라(gitignored) 이전 번들로 되돌리는 커밋이 없다 → 되돌리려면 그 시점
커밋에서 `npm run build` + `sync-android-assets.mjs` + 위 ④를 다시 실행한다(항상 재생성 가능).
`SW_VERSION` 은 손으로 올리지 않는다(자동 주입 — 수동 값은 다음 빌드에서 사라진다).

### 수동 실행 시 툴체인 (스크립트가 자동으로 넣는 값)

```
JAVA_HOME=/usr/libexec/java_home -v 17                                 # Temurin 17.0.20.1
ANDROID_HOME=/opt/homebrew/share/android-commandlinetools              # platform-tools 37.0.1 · platforms;android-36 · build-tools;36.0.0
PATH=$ANDROID_HOME/platform-tools:$ANDROID_HOME/build-tools/36.0.0:$PATH
```

## 설정: 왜 `capacitor.config.ts` 가 아니라 `capacitor.config.json` 인가

카드 지시는 `capacitor.config.ts` 였으나 **이 저장소에서는 로드가 불가능**해 JSON 을 쓴다(실측).

- `@capacitor/cli` 7.6.9 는 `capacitor.config.ts` 를 읽을 때 `require('typescript')` 로 **트랜스파일**한다:
  `ts.transpileModule(...)`, `ts.ModuleKind.CommonJS`.
- 이 저장소의 `typescript` 는 **7.0.2** 이고, 그 CommonJS export 에는 `version`/`versionMajorMinor` 만 있다
  (`node -e "Object.keys(require('typescript'))"` → 실측). 그래서 CLI 가
  `TypeError: Cannot read properties of undefined (reading 'CommonJS')` 로 죽는다.
- CLI 의 탐색 순서는 `.ts → .js → .json` 이다. `.js` 는 `type: module` 저장소에서 ESM 네임스페이스를
  그대로 config 로 써서 `appId` 가 사라지고(소스 확인: `loadExtConfigJS` 는 `.default` 를 벗기지 않는다),
  `.json` 만 안전하다. **같은 맥의 형제 프로젝트 `meteor-dodge` 도 같은 이유로 JSON 을 쓴다**(선례).
- 대안과 판정: `typescript` 를 5.x 로 내리면 `.ts` 를 쓸 수 있지만, 그건 저장소 전체의 컴파일 툴체인을
  바꾸는 일이라 인프라 워커 범위를 넘는다 → 채택하지 않는다.
  **되돌리기**: TS 7 이 programmatic API 를 회복하면 `capacitor.config.json` 을 `capacitor.config.ts`
  로 옮기고 같은 값을 넣은 뒤 `cap sync android` 1회.

## 값 결정과 되돌리기

| 항목 | 값 | 이유 / 되돌리기 |
|---|---|---|
| `appId` | `com.angalle.sunmoonshuttle` | 학교 공식 표기 회피(비공식 앱·상표 리스크). **배포 후 변경 불가** — 되돌리려면 `android/` 삭제 후 재생성, 이미 업로드했다면 새 앱 등록 |
| `appName` | `셔틀버스 Shuttle` | PWA `short_name`(홈 화면 라벨)과 일치 → APK 설치본과 PWA 설치본의 이름이 갈라지지 않는다. 바꾸려면 값 수정 후 `cap sync` |
| `webDir` | `dist` | vite 산출물. `base './'` 라 `https://localhost/` 에서 상대경로 그대로 동작 |
| `server.androidScheme` | `https` | 앱 내부 오리진을 https 로 → **보안 컨텍스트**라서 `sw.js`(SW)와 IndexedDB 캐시(T6)가 실제로 동작. http 로 바꾸면 오프라인 캐시가 조용히 죽는다 |
| `backgroundColor` | 전역 `#ffffff` / `android` `#ffffff00` | **T25 갱신**. 전역값 = 첫 페인트 전 WebView 배경 = `manifest.background_color`(라이트 `#ffffff`). `android.backgroundColor` 는 **투명**(`#RRGGBBAA` = `#ffffff00`)이라 WebView 가 불투명 흰 판을 깔지 않고 그 아래 **실행 테마의 스플래시(흰 배경 + 96dp 로고)** 가 보인다 — 실측: 네이티브 스플래시가 덮는 구간 385ms → 457ms. 되돌리기: `#ffffff` 로 바꾸고 `cap sync` + 재빌드. 한계: 웹 페이지가 자기 `body` 배경(`--color-bg`)을 칠하는 순간부터는 창 배경이 가려진다(§T25 소견) |
| `webContentsDebuggingEnabled` | 미설정 | Capacitor 기본값(디버그 true / 릴리스 false). 릴리스에서 원격 디버깅이 열리지 않게 그대로 둔다 |
| `compileSdk`/`targetSdk` | 36 | `platforms;android-36` 설치돼 있음. Play 신규·업데이트 요건. 되돌리기: `variables.gradle` 두 줄을 35 로 |
| `minSdk` | 24 | Android 7.0+. Play 자동 보호(앱 무결성)의 최소 요구 — Capacitor 기본 23 에서 올림. WebView 는 Play 로 자동 갱신 |
| version | `versionCode 1` / `versionName 1.0.0` | `versionCode` 는 **업로드마다 +1**(재사용 금지). `android/app/build.gradle` 에서 사람이 명시적으로 올린다 |

## JDK 17 제약 (이 맥에 JDK 21 이 없다)

- `@capacitor/android` 7.6.9 와 생성물 `app/capacitor.build.gradle` 은 `JavaVersion.VERSION_21` 을 선언한다.
  JDK 17 로는 `:capacitor-android:compileReleaseJavaWithJavac` 가 `error: invalid source release: 21` 로 실패한다.
- 조치: `android/build.gradle` 의 `subprojects { afterEvaluate { ... compileOptions 17 } }` 로 **안드로이드 모듈만**
  17 로 낮춘다. 라이브러리 소스에 Java 21 문법이 없어 결과 바이트코드 등급은 동일하다(실측: 빌드·설치·실행 성공).
  `app/capacitor.build.gradle` 은 `cap sync` 마다 재생성되므로 **그 파일을 직접 고치면 안 된다**(루트에서 덮어써야 살아남는다).
- 대안: JDK 21 설치(예: `brew install openjdk@21`) 후 `JAVA_HOME` 을 21 로 → 이 블록을 지워도 된다.
  비용은 0원이지만 **시스템 변경이라 별도 승인이 필요**해 이번엔 하지 않았다.
- 되돌리기: JDK 21 을 쓰게 되면 블록 삭제 + `bash android/build-release.sh`.

## 서명

- `android/keystore.properties`(커밋 금지 · `.gitignore`) 가 **있으면** 업로드 키로, **없으면 debug 키**로 서명한다.
  현재 없음 → AAB/APK 모두 `CN=Android Debug` 서명이다. **스토어 제출용이 아니다**(빌드 로그에 경고가 찍힌다).
- 채우는 방법(값은 커밋·로그·문서에 남기지 않는다 — 키 **이름만**):
  `android/keystore.properties` 에 `storeFile` · `storePassword` · `keyAlias` · `keyPassword` 4개 키를 넣는다.
  비밀번호는 비밀 관리 도구에서 주입하고 파일은 절대 커밋하지 않는다. Play 업로드 키는 Play Console 의
  App Signing 사용을 전제로 발급한다(별도 승인 사항).
- `bash android/build-release.sh verify` 가 서명 주체를 함께 찍는다 — `⚠️ debug 키` 가 보이면 업로드하지 않는다.

## Play 첫 업로드 (사람이 하는 단계 — 비밀번호·계정이 필요)

B안(데이터는 Pages 에서 · docs/07 §17)이 들어간 첫 버전을 한 번 올리면, 그 뒤 시간표·학사일정은 재업로드 없이 최신이다.

1. **업로드 키 만들기**(한 번만 · 비밀번호는 직접 정하고 비밀 관리 도구에 보관 — 잃어버리면 Play 지원팀 재설정 필요)
   ```bash
   mkdir -p ~/.android-keys   # 저장소 밖 홈 폴더(커밋 위험 0)
   keytool -genkeypair -v -keystore ~/.android-keys/sunmoon-upload.jks -alias upload \
     -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=sunmoon-shuttle, O=angalle, C=KR"
   ```
   (`keytool` 이 비밀번호를 대화식으로 묻는다 — 명령줄 인자로 넘기지 않는다.
    Claude Code 세션 안의 셸은 프로젝트 밖 쓰기가 막혀 있으니 **Mac 터미널 앱**에서 실행한다)
2. **`android/keystore.properties` 만들기** — `cp android/keystore.properties.example android/keystore.properties` 후
   `storeFile` 을 키의 절대 경로(예: `/Users/<사용자>/.android-keys/sunmoon-upload.jks`)로 바꾸고 `storePassword`·`keyPassword` 를 채운다.
3. **AAB 빌드·확인** — `bash android/build-release.sh` → `서명: 업로드 키 (CN=sunmoon-shuttle …)` 가 찍히는지 확인.
4. **Play Console** → 앱 만들기(패키지 `com.angalle.sunmoonshuttle`) → **Play 앱 서명 사용** → 내부 테스트 트랙에
   `android/app/build/outputs/bundle/release/app-release.aab` 업로드. 스토어 문구·개인정보처리방침 URL 은 `docs/05-store-listing.md`.
5. 다음 업로드부터는 `android/app/build.gradle` 의 `versionCode` 를 **+1** 한 뒤 3~4 반복(재사용 금지).
   지금 값은 `versionCode 1` / `versionName 1.0.0`(v1.0.0 · 2026-11-14) — 아직 한 번도 올리지 않았으므로 첫 업로드는 그대로 쓴다.

## 안드로이드 뒤로가기 동작 (정의)

**뒤로가기 = 앱 종료(홈 화면으로)**. 실측: 앱 실행 중 `adb shell input keyevent 4` → `dumpsys activity activities`
에서 해당 ActivityRecord 가 사라짐(프로세스는 캐시로 잠시 남음).

- 이유: 이 앱은 **단일 화면 SPA** 라 웹 히스토리에 되돌릴 항목이 없다. Capacitor 는 웹 히스토리가 없으면
  Activity 를 finish 한다 → 종료.
- 즉 "무시(no-op)" 가 아니라 **종료** 쪽으로 명시한다. 사용자 확인 대화상자는 두지 않는다
  (되돌릴 상태가 없고, 시간표 앱은 다시 켜는 비용이 작다).
- 나중에 화면 전환(라우팅)을 넣으면 웹 히스토리가 생겨 Capacitor 가 그 화면을 먼저 되돌린다.
  "항상 종료" 로 고정하고 싶으면 `MainActivity.java` 에 BackButton 처리를 추가한다(네이티브 껍데기 수정 = 이 워커 범위).

## 알려진 실패 모드 (실측)

| 증상 | 원인 | 조치 |
|---|---|---|
| 앱에 `데이터를 불러오지 못했습니다 — ./data/timetable.json: HTTP 404` | `dist/data/timetable.json` 없이 `cap sync` | `build-release.sh` 1단계(계약 데이터 동봉)를 거친다. 스크립트는 sync 후 자산 누락을 검사해 실패시킨다 |
| `error: invalid source release: 21` | JDK 21 요구를 JDK 17 로 빌드 | `android/build.gradle` 의 subprojects 블록 유지(삭제 금지) |
| `We recommend using a newer Android Gradle plugin to use compileSdk = 36` | AGP 8.7.2 의 테스트 상한 35 | **경고(빌드 성공)**. 없애려면 AGP↑ = JDK 21 필요. 문서화만 하고 억제하지 않는다 |
| `npx cap ...` 이 보안 게이트에 막힘(`Tirith … package 'cap'`) | 이 실행 환경의 npx 패키지 실행기 검사 | `node_modules/.bin/cap …` 또는 `npm run cap:sync` 를 쓴다 |
| `npm install @capacitor/*` 가 차단(`BLOCKED: Security scan … threat intelligence`) | 게이트의 위협 인텔 조회가 이 환경에서 실패(패키지 문제 아님) | `npm pack <pkg>@<ver>` 로 tarball 을 받아 설치 → `package.json`/`package-lock.json` 스펙만 registry(`^7.6.9`)로 정리(실측 `npm ci --dry-run` 통과) |

---

# T25 — 네이티브 스플래시 · 상태바 · 아이콘 정합 (T24 앱 셸 뒤)

웹 앱 셸·스플래시(T24)가 정해진 뒤, **안드로이드 시작 화면이 웹 스플래시와 같은 색·로고**가 되도록
네이티브 리소스를 맞춘다. 원문·실측: `.session-notes/T25-증거.md`.

## 생성기 하나로 (별도 제작 금지)

```bash
node scripts/generate_android_res.mjs     # 리소스 생성(멱등) — 색은 tokens.css 에서 읽는다
bash android/build-release.sh             # 웹 빌드 → cap sync → AAB
bash scripts/t25_artifact_check.sh        # 산출물(AAB/APK) 안의 리소스가 생성물과 같은가
bash scripts/t25_emulator_smoke.sh        # 에뮬레이터: 스플래시→본문 전환·크래시·오프라인 (작업 후 에뮬 종료)
```

`scripts/generate_android_res.mjs` 는 웹 아이콘 생성기 `scripts/generate_icons.mjs` 의
도형·래스터라이저·PNG 인코더를 **그대로 import** 한다 → 웹 스플래시 로고(`public/icons/icon-192.png`),
안드로이드 스플래시 로고(`drawable-*/splash_logo.png`), 런처 아이콘(`mipmap-*/ic_launcher.png`)이
**같은 그림**이다(192px 판 3개의 sha256 이 동일함을 실측으로 확인). 생성기는 시작할 때
`icon-192.png` 을 같은 프리미티브로 다시 그려 **바이트 동일**을 검사한다.

## 리소스 지도

| 리소스 | 무엇 | 값·근거 |
|---|---|---|
| `drawable/splash.xml` | 실행 테마 배경(=`windowBackground`) | layer-list: `@color/splash_background` + `@drawable/splash_logo`(`gravity=center`). 전체화면 PNG 를 쓰면 화면비가 다른 기기에서 로고가 늘어난다 |
| `drawable-<dpi>/splash_logo.png` | 스플래시 로고 | 96dp(`tokens.css --splash-logo-size`) — mdpi 96 · hdpi 144 · xhdpi 192 · xxhdpi 288 · xxxhdpi 384 |
| `mipmap-<dpi>/ic_launcher.png` · `_round.png` | 레거시(API<26) 런처 | 48dp — 둥근 사각/원 타일 + 흰 버스 글리프 |
| `mipmap-<dpi>/ic_launcher_foreground.png` | 적응형 아이콘 전경 | 108dp 레이어, 글리프는 중앙 **68dp** 상자(안전원 66dp 안) |
| `values/ic_launcher_background.xml` | 적응형 배경색 | `#0B5497` = `tokens.css --color-accent` |
| `values/colors.xml` · `values-night/colors.xml` | 스플래시·상태바 배경 | `#FFFFFF`(=`--color-bg` 라이트) / `#12161B`(다크) |
| `values/bools.xml` · `values-night/bools.xml` | 상태바 아이콘 밝기 | 라이트 → `windowLightStatusBar=true`(어두운 아이콘), 다크 → `false` |
| `values/styles.xml` | `AppTheme.NoActionBarLaunch` | `android:background=@drawable/splash`(API<31) + `windowSplashScreenBackground`·`windowSplashScreenAnimatedIcon`(API31+ 시스템 스플래시) + `statusBarColor`·`windowLightStatusBar` |

⚠️ **XML 주석에 `--` 를 쓰면 aapt2 가 빌드를 실패시킨다**(실측: `주석에서는 "--" 문자열이 허용되지 않습니다`).
생성기 주석에서 토큰 이름을 쓸 때 `--color-accent` 대신 `color-accent 토큰` 처럼 적는다.

## 실측 결과 (에뮬레이터 Android 15 / API 35 · 1080×2400)

```
t=52~457ms   네이티브 스플래시(강조색 타일 + 흰 버스, 중앙 파란픽셀 57.8%)
t=617ms      빈 흰 화면 1프레임(≈160ms)
t=749~950ms  웹 스플래시(96px 로고 + 제목·스피너·문구)
t=1056ms~    본문          Displayed +440ms
logcat FATAL 0 · ANR 0 · 앱 콘솔 오류 0 · 렌더러 크래시 0 / 오프라인 재실행 본문 SSIM 0.999091
```

**소견(웹 계층 필요)**: 네이티브 스플래시와 웹 스플래시 사이에 로고 없는 흰 프레임이 **1장(≈160ms)** 있다.
웹 페이지가 자기 `body` 배경(`--color-bg`)을 JS 스플래시보다 먼저 칠하기 때문이고, 색은 같아서 색 번쩍임은 없다.
네이티브로 제거 불가 → ① `index.html` 인라인 스플래시, 또는 ② `@capacitor/splash-screen` `autoHide:false` +
웹에서 `SplashScreen.hide()` 중 하나가 필요하다(둘 다 웹 계층 변경).

**미검증**: API<31 경로(창 배경이 곧 스플래시)는 이 맥에 API 35 AVD 만 있어 렌더 확인 못 함(리소스 값만 확인).
다크 모드 화면 스크린샷도 없음(값만 확인).
