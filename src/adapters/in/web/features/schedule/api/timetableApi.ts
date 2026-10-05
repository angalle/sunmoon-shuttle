/**
 * 시간표 데이터 로딩 (features/schedule/api) — 화면 코드는 fetch 를 직접 부르지 않는다(스킬 §5).
 *
 * 데이터 URL 은 `docs/01 §6` 대로 Pages 가 앱 번들과 함께 서빙하는 `data/timetable.json` 이다.
 * `vite.config.ts` 의 `base: './'` 때문에 **상대 경로**로 요청해야 하위 경로 배포에서도 맞는다.
 */
import { parseTimetable, TimetableDataError } from '../data/normalize';
import type { TimetableModel } from '../types/model';

/** 앱이 읽는 계약 데이터 경로(상대) */
export const TIMETABLE_PATH = './data/timetable.json';

export type FetchLike = (input: string) => Promise<Response>;

const defaultFetch: FetchLike = (input) => fetch(input);

/** 계약 JSON 을 받아 뷰모델로 파싱한다. 실패는 원인을 담은 `TimetableDataError` 로 올린다. */
export async function fetchTimetableModel(
  fetchImpl: FetchLike = defaultFetch,
  path: string = TIMETABLE_PATH,
): Promise<TimetableModel> {
  let response: Response;
  try {
    response = await fetchImpl(path);
  } catch (error) {
    throw new TimetableDataError(path, `네트워크 요청 실패: ${messageOf(error)}`);
  }
  if (!response.ok) {
    throw new TimetableDataError(path, `HTTP ${String(response.status)} ${response.statusText}`);
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch (error) {
    throw new TimetableDataError(path, `JSON 파싱 실패: ${messageOf(error)}`);
  }
  return parseTimetable(raw);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
