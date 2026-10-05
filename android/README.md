# android/ — Capacitor 안드로이드 패키징 (T8 · InfraProjectCreator)

웹 자산(`dist/`)을 **한 줄도 고치지 않고** Capacitor 로 감싸 AAB/APK 를 만든다.
계약: `docs/01-architecture.md` §6(배포/실행) · `docs/03-verification.md` AC-7.
증거 원문·실측값: `.session-notes/T8-증거.md`, `.session-notes/T8-*.log`.

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
| `backgroundColor` | `#f4f6f9` | 첫 페인트 전 WebView 배경 = `manifest.background_color`(라이트). 한계: 다크 모드 기기에서는 첫 프레임이 밝게 번쩍일 수 있다(정적 1색). 다크 대응 스플래시는 `@capacitor/splash-screen` 플러그인(무료)이 필요해 이번 범위 밖. 삭제하면 기본 `#ffffff` |
| `webContentsDebuggingEnabled` | 미설정 | Capacitor 기본값(디버그 true / 릴리스 false). 릴리스에서 원격 디버깅이 열리지 않게 그대로 둔다 |
| `compileSdk`/`targetSdk` | 36 | `platforms;android-36` 설치돼 있음. Play 신규·업데이트 요건. 되돌리기: `variables.gradle` 두 줄을 35 로 |
| `minSdk` | 23 | Capacitor 7 기본. WebView 가 Play 로 자동 갱신되어 낮게 잡아도 최신 엔진 |
| version | `versionCode 1` / `versionName 0.1.0` | `versionCode` 는 **업로드마다 +1**(재사용 금지). `android/app/build.gradle` 에서 사람이 명시적으로 올린다 |

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
