/**
 * 화면 상태 (features/schedule/store) — DOM 을 모르는 순수 상태 기계(테스트 가능).
 *
 * - 서버(데이터) 상태와 UI 상태를 함께 들고 있되, **파생값은 selectors 가 계산**한다.
 * - 타이머는 여기서 만들지 않는다("60초마다 갱신"은 화면 계층 조립 지점 소관).
 */
import type { DayType } from '../../../../../../domain/entities/DayType';
import type { TimetableModel } from '../types/model';

export type ScheduleStatus = 'loading' | 'ready' | 'error';

export interface ScheduleState {
  readonly status: ScheduleStatus;
  readonly model: TimetableModel | null;
  /** 사용자에게 보여줄 오류 원인(빈 화면 금지 — F8) */
  readonly errorMessage: string | null;
  readonly dayType: DayType;
  readonly routeId: string | null;
  /** 주입된 clock 에서 읽은 현재 시각(ms). 60초마다 화면 계층이 갱신한다. */
  readonly nowMs: number;
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
  public setModel(model: TimetableModel): void {
    const routeId = this.resolveRouteId(model, this.state.dayType, this.state.routeId);
    this.patch({ status: 'ready', model, errorMessage: null, routeId });
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
