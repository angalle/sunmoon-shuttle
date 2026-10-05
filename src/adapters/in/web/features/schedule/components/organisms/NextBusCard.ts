/**
 * 유기체: 다음 버스 카드 (features/schedule/components/organisms) — T5 의 핵심.
 *
 * 표시 규칙(카드 지시 ③ · 수용 기준 매핑표)
 * ① 다음 N개(기본 3) + 남은 시간 — 도메인 `nextDepartures` 반환을 **그대로** 쓴다.
 * ② `내일 08:05` 같은 다음 운행일 표시(dayLabel + departure).
 * ③ 운행 없음이면 **사유(원본 안내문 원문)를 먼저** 보여준다.
 * ④ `unknown-route`·`empty-schedule` 등도 사용자 문구로 표시(빈 화면·크래시 금지).
 * 색만으로 상태를 전달하지 않는다 — 모든 배지에 문구가 있고, 상태는 `data-status` 로도 남긴다(검증용).
 */
import { el, srOnly } from '../../../../shared/lib/dom';
import type { NextBusTone, NextBusView } from '../../store/selectors';
import { UI_TEXT } from '../../types/texts';
import { nextBusList } from '../molecules/NextBusList';

export interface NextBusCardProps {
  readonly view: NextBusView;
  readonly routeName: string;
  readonly dayLabel: string;
  readonly headingId: string;
}

export function nextBusCard(props: NextBusCardProps): HTMLElement {
  const { view } = props;
  const rest = view.departures.filter((departure) => !departure.isFirst);

  return el(
    'section',
    {
      class: 'shuttle-card',
      attrs: { 'aria-labelledby': props.headingId },
      dataset: { testid: 'next-bus-card', status: view.domainStatus, tone: view.tone },
    },
    [
      el('h2', { class: 'shuttle-card__title', attrs: { id: props.headingId }, text: UI_TEXT.nextBusTitle }),
      el('p', {
        class: 'shuttle-header__subtitle',
        text: `${props.routeName} · ${props.dayLabel}`,
      }),
      // ③ 사유(원본 문구)를 먼저
      view.reason === null
        ? null
        : el('p', { class: 'shuttle-card__reason', dataset: { testid: 'next-bus-reason' } }, [
            el('strong', { text: '원본 안내: ' }),
            view.reason,
          ]),
      el(
        'div',
        {
          class: 'shuttle-hero',
          attrs: { role: 'status', 'aria-live': 'polite' },
          dataset: { testid: 'next-bus-live' },
        },
        [
          el('p', { class: 'shuttle-hero__label', text: toneLabel(view.tone) }),
          el('p', { class: 'shuttle-hero__time', dataset: { testid: 'next-bus-time' }, text: view.title }),
          view.subtitle === null ? null : el('p', { class: 'shuttle-hero__remaining', text: view.subtitle }),
        ],
      ),
      view.detail === null ? null : el('p', { class: 'shuttle-header__subtitle', text: view.detail }),
      rest.length === 0
        ? null
        : el('div', {}, [el('h3', { class: 'shuttle-card__title', text: UI_TEXT.nextBusListTitle }), nextBusList({ title: UI_TEXT.nextBusListTitle, departures: rest })]),
      view.warnings.length === 0
        ? null
        : el(
            'div',
            { class: 'shuttle-banner shuttle-banner--warn', attrs: { role: 'status' }, dataset: { testid: 'next-bus-warnings' } },
            [
              el('p', {}, [el('strong', { text: UI_TEXT.nextBusWarningsTitle })]),
              el('p', { text: UI_TEXT.nextBusWarningsDetail }),
              el('ul', { class: 'shuttle-list' }, view.warnings.map((warning) => el('li', { text: warning }))),
            ],
          ),
      view.departures.length === 0 ? srOnly('안내할 회차 없음') : null,
    ],
  );
}

function toneLabel(tone: NextBusTone): string {
  if (tone === 'ok') return '가장 가까운 출발';
  if (tone === 'warn') return '확인 필요';
  if (tone === 'danger') return '안내 불가';
  return '안내';
}
