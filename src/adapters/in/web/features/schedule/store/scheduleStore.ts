/**
 * 화면 상태 (features/schedule/store) — DOM 을 모르는 순수 상태 기계(테스트 가능).
 *
 * - 서버(데이터) 상태와 UI 상태를 함께 들고 있되, **파생값은 selectors 가 계산**한다.
 * - 타이머는 여기서 만들지 않는다("60초마다 갱신"은 화면 계층 조립 지점 소관).
 */
import type { DayType } from '../../../../../../domain/entities/DayType';
import type { TimetableModel } from '../types/model';

export type ScheduleStatus = 'loading' | 'ready' | 'error';

/** 데이터 출처 — 캐시로 폴백했는지 화면이 알아야 오프라인 안내를 띄운다(AC-5·AC-6). */
export type ScheduleDataSource = 'network' | 'cache' | 'cache-expired';

export interface ScheduleState {
  readonly status: ScheduleStatus;
  readonly model: TimetableModel | null;
  /** 사용자에게 보여줄 오류 원인(빈 화면 금지 — F8) */
  readonly errorMessage: string | null;
  /** 마지막 성공 로딩의 출처. 아직 로딩 전이면 null */
  readonly dataSource: ScheduleDataSource | null;
  /** 캐시로 폴백했을 때의 캐시 나이(ms) — 화면이 "언제 받은 데이터인지" 알린다 */
  readonly cacheAgeMs: number | null;
  /** 캐시로 폴백한 원인(네트워크 실패 메시지) — 오프라인 안내 문구에 쓴다 */
  readonly offlineReason: string | null;
  readonly dayType: DayType;
  readonly routeId: string | null;
  /** 주입된 clock 에서 읽은 현재 시각(ms). 60초마다 화면 계층이 갱신한다. */
  readonly nowMs: number;
}

/** `setModel` 부가 정보 — 캐시 폴백일 때만 값이 들어온다(네트워크 성공은 기본값). */
export interface ModelLoadMeta {
  readonly dataSource?: ScheduleDataSource | undefined;
  readonly cacheAgeMs?: number | null | undefined;
  readonly offlineReason?: string | null | undefined;
}

export type StateListener = (state: ScheduleState) => void;

export class ScheduleStore {
  private state: ScheduleState;
  private readonly listeners = new Set<StateListener>();

  public constructor(initial: ScheduleState) {
    this.state = initial;
  }

  public getState(): ScheduleState {
    return this.state;
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public setLoading(): void {
    this.patch({ status: 'loading', errorMessage: null });
  }

  public setError(errorMessage: string): void {
    this.patch({ status: 'error', errorMessage });
  }

  /** 데이터 로드 성공. 이전 선택이 없거나 이 요일에 표가 없으면 유효한 노선으로 맞춘다. */
  public setModel(model: TimetableModel, meta: ModelLoadMeta = {}): void {
    const routeId = this.resolveRouteId(model, this.state.dayType, this.state.routeId);
    const dataSource = meta.dataSource ?? 'network';
    this.patch({
      status: 'ready',
      model,
      errorMessage: null,
      routeId,
      dataSource,
      cacheAgeMs: dataSource === 'network' ? null : (meta.cacheAgeMs ?? null),
      // 네트워크 성공이면 오프라인 안내를 지운다(캐시 폴백일 때만 원인을 남긴다).
      offlineReason: dataSource === 'network' ? null : (meta.offlineReason ?? null),
    });
  }

  /** 요일 탭 선택 — 그 요일 표가 없는 노선이면 표가 있는 노선으로 옮긴다. */
  public selectDay(dayType: DayType): void {
    const routeId =
      this.state.model === null
        ? this.state.routeId
        : this.resolveRouteId(this.state.model, dayType, this.state.routeId);
    this.patch({ dayType, routeId });
  }

  public selectRoute(routeId: string): void {
    this.patch({ routeId });
  }

  /** 현재 시각 갱신(60초 틱). 값이 같으면 알리지 않는다. */
  public tick(nowMs: number): void {
    if (nowMs === this.state.nowMs) return;
    this.patch({ nowMs });
  }

  private resolveRouteId(model: TimetableModel, dayType: DayType, preferred: string | null): string | null {
    const isUsable = (routeId: string): boolean => {
      const route = model.routes.find((candidate) => candidate.id === routeId);
      if (route === undefined) return false;
      if (route.status === 'suspended') return false;
      return route.byDay[dayType] !== null;
    };
    if (preferred !== null && isUsable(preferred)) return preferred;
    const usable = model.routes.find((route) => isUsable(route.id));
    if (usable !== undefined) return usable.id;
    // 그 요일에 표가 있는 노선이 하나도 없으면(예: 전 노선 운행 중단) 첫 노선을 유지한다.
    return model.routes.at(0)?.id ?? null;
  }

  private patch(partial: Partial<ScheduleState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener(this.state);
  }
}
