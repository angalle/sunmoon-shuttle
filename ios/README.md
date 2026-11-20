# iOS 앱 (Capacitor 7 · Swift Package Manager)

웹 자산(`dist/`)을 그대로 감싼 iOS 앱이다. Android(`android/`)와 같은 앱 ID `com.angalle.sunmoonshuttle` 을 쓴다.
2026-11-19 추가. CocoaPods 없이 **SPM** 으로 만든다(이 맥에 CocoaPods 가 없다).

## 빌드·실행 (재현)

```bash
npm run build && mkdir -p dist/data && cp data/timetable.json dist/data/
npx cap sync ios
open ios/App/App.xcodeproj        # Xcode 에서 시뮬레이터/기기를 골라 ▶
```

명령줄로 시뮬레이터 빌드만 확인할 때:

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```

첫 빌드는 Capacitor 패키지(capacitor-swift-pm)를 GitHub 에서 받느라 몇 분 걸린다.

## 프로젝트를 다시 만들 때

Capacitor CLI 7.6.x 버그: `cap add ios --packagemanager SPM` 이 옵션 값을 소문자로 바꾼 뒤 `'SPM'` 과 비교해서
SPM 템플릿을 쓰면서도 CocoaPods 설치 여부를 검사하고 실패한다. 검사만 통과시키고 다시 sync 하면 SPM 으로 잡힌다.

```bash
rm -rf ios
CAPACITOR_COCOAPODS_PATH=/usr/bin/true npx cap add ios --packagemanager SPM   # 마지막 "Podfile 없음" 오류는 무시
npx cap sync ios                                                            # CapApp-SPM 을 보고 SPM 으로 동기화
node scripts/generate_ios_res.mjs                                           # 앱 아이콘·스플래시(웹·안드로이드와 같은 그림)
```

그다음 아래 값을 다시 넣는다.

| 위치 | 값 | 이유 |
|---|---|---|
| `Info.plist` `CFBundleDevelopmentRegion` | `ko` | 한국어 앱 |
| `Info.plist` `UIRequiredDeviceCapabilities` | `arm64` | 템플릿의 `armv7` 은 낡은 값 |
| `Info.plist` `ITSAppUsesNonExemptEncryption` | `false` | 자체 암호화 없음(HTTPS 만) → 업로드마다 수출 규정 질문을 건너뛴다 |
| `project.pbxproj` `MARKETING_VERSION` | Android `versionName` 과 같게 | 스토어 표기 버전 |

## 네이버 지도 버튼 (iOS 앱)

`mapOpenMode` 가 `native-app` 을 고른다 → `nmap://route/car?…` 로 이동.
Capacitor iOS 는 앱 밖 주소를 `UIApplication.open` 으로 넘긴다(`WebViewDelegationHandler`).
네이버 지도 앱이 없으면 열기만 조용히 실패하고(경고 없음), 1.5초 뒤 웹 길찾기가 **Safari** 로 열린다.
2026-11-20 시뮬레이터 실측: 학교 → 천안아산역 자동차 12분 · 5.5km, 왼쪽 위 "◀ 셔틀버스 Shuttle" 로 앱 복귀
(`.session-notes/T47-*.png`). 네이버 지도 앱이 설치된 실기기에서는 아직 확인하지 않았다.

## App Store 출시 (사람이 하는 단계 — Apple 계정이 필요)

1. **Xcode 서명**: `App.xcodeproj` → TARGETS `App` → Signing & Capabilities → Team 에서 개발자 계정 선택
   (Automatically manage signing 유지). 번들 ID `com.angalle.sunmoonshuttle` 이 계정에 자동 등록된다.
2. **App Store Connect** (appstoreconnect.apple.com) → 앱 → `+` 새로운 앱
   - 플랫폼 iOS · 이름 `셔틀버스 Shuttle` · 기본 언어 한국어 · 번들 ID 위에서 등록된 것 · SKU 아무 값(예: `sunmoon-shuttle`)
3. **업로드**: Xcode 상단 기기를 `Any iOS Device (arm64)` 로 → Product → Archive → Organizer 에서
   Distribute App → App Store Connect → Upload.
4. **TestFlight**: 처리(10~30분)가 끝나면 내부 테스터(본인)로 기기에서 설치해 확인.
5. **심사 제출 정보** — 문구는 `docs/05-store-listing.md` 에 있다.
   - 개인정보처리방침 URL: `https://angalle.github.io/sunmoon-shuttle/privacy.html`
   - 앱 개인정보(영양 성분표): **데이터를 수집하지 않음**
   - 스크린샷: 6.9" iPhone(1320×2868 또는 1290×2796) 최소 1장 — iPad 지원(`TARGETED_DEVICE_FAMILY = 1,2`)을 유지하면 13" iPad 스크린샷도 필요하다.
   - 카테고리: 여행(보조: 유틸리티)

**심사 위험(미리 알 것)**: 웹을 감싸기만 한 앱은 가이드라인 4.2(최소 기능)로 거절되는 일이 잦고,
학교 이름이 들어간 비공식 앱이라 5.2(지식재산) 확인을 요구받을 수 있다. 오프라인 시간표·다음 출발 강조·
네이버 지도 연결 같은 "앱으로서의 기능"을 심사 메모에 적는다.
