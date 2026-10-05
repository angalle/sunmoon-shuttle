/**
 * 외부 계약 타입 재노출 (features/schedule/types).
 *
 * 앱이 읽는 JSON 의 **정본 계약은 `tools/scraper/types.ts`** 다(docs/01 §4 · T2 산출).
 * 여기서 타입을 복사해 두면 파서와 앱이 조용히 어긋나므로, `import type` 으로 **한 곳에서** 가져온다
 * (docs/01 §2: "앱과 같은 파서 모듈 import"). `import type` 은 빌드 시 완전히 지워지므로
 * 번들에 scraper 코드가 들어가지 않는다(런타임 의존성 0 유지 — T0 골격 계약).
 *
 * ⚠️ 런타임 값(DAY_TYPES 등)은 도메인(`src/domain/entities/DayType.ts`)에서 가져온다 —
 *    도메인이 요일 구분의 정본이다(여기서는 타입만).
 */
import type {
  BusRef,
  Contacts,
  DayTable,
  DayType,
  Notice,
  RouteData,
  SemesterPeriod,
  SourceInfo,
  SourcePage,
  Timetable,
  TripRow,
} from '../../../../../../../tools/scraper/types';

export type {
  BusRef,
  Contacts,
  DayTable,
  DayType,
  Notice,
  RouteData,
  SemesterPeriod,
  SourceInfo,
  SourcePage,
  Timetable,
  TripRow,
};
