/**
 * 앱 내부 뷰모델 (features/schedule/types) — 외부 JSON 계약(`contract.ts`)을 화면이 쓰기 좋게 정리한 형태.
 *
 * 원칙
 * - **요일·시각 계산은 여기서 하지 않는다.** 계산은 도메인 함수(`nextDepartures` 등)만 한다.
 * - 외부 계약에만 있는 필드(`status`·`suspendedReason`·`offDays`·원문 헤더 `columns`)는
 *   **표시용으로 보존**한다(F2b 운행 중단 · F2 가변 열).
 * - 도메인이 아는 형태(`Schedule`)는 `schedule` 필드로 함께 들고 다닌다(브리지는 `data/normalize.ts` 한 곳).
 */
import type { DayType } from '../../../../../../domain/entities/DayType';
import type { Schedule } from '../../../../../../domain/entities/Schedule';
import type { Notice, SemesterPeriod, TripRow } from './contract';

/** 한 요일의 표(원문 헤더 + 행). 요일별로 열 구성이 다르다(docs/01 §4 가변 열). */
export interface DayTableView {
  readonly dayType: DayType;
  /** 원본 헤더 원문(공백 정규화) — 이 순서대로 열을 렌더한다 */
  readonly columns: readonly string[];
  /** `columns` 와 같은 순서의 JSON 키 */
  readonly keys: readonly string[];
  readonly rows: readonly TripRow[];
}

export interface SourcePageView {
  readonly routeId: string;
  readonly dayType: DayType;
  readonly url: string;
  readonly sourceUpdatedAt: string;
}

export interface SourceView {
  readonly url: string;
  readonly sourceUpdatedAt: string;
  readonly fetchedAt: string;
  readonly contentHash: string;
  readonly pages: readonly SourcePageView[];
}

export interface RouteView {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly status: 'active' | 'suspended';
  /** 운행 중단 사유(원본 문구) — `status='suspended'` 일 때 */
  readonly suspendedReason: string | null;
  /** 원본에 페이지가 없는 요일(예: 온양 주말) */
  readonly offDays: readonly DayType[];
  /** 요일별 표. `null` = 그 요일 데이터 없음(원본에 페이지 없음/운행 중단) */
  readonly byDay: Readonly<Record<DayType, DayTableView | null>>;
}

export interface TimetableModel {
  readonly schemaVersion: number;
  readonly semester: SemesterPeriod;
  readonly holidayPeriod: SemesterPeriod | null;
  readonly dayTypes: readonly DayType[];
  readonly routes: readonly RouteView[];
  /** 원본 안내문(정규화 전 — `date` 없는 문구 포함, F7) */
  readonly notices: readonly Notice[];
  readonly busRefs: readonly { readonly line: string; readonly stop: string; readonly to: string }[];
  readonly contacts: { readonly team: string; readonly tel: string } | null;
  readonly source: SourceView;
  /** 도메인 함수 입력. 외부 계약 → 도메인 모델 정규화 결과(`data/normalize.ts`) */
  readonly schedule: Schedule;
}
