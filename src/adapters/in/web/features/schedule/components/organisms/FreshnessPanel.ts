/**
 * 유기체: 신선도 패널 (features/schedule/components/organisms) — F5.
 * 원본 페이지의 "최근 업데이트"(sourceUpdatedAt)와 **우리 반영 시각**(fetchedAt)을 함께 보여주고,
 * 48시간을 넘긴 값에는 경고 문구를 붙인다(색만으로 전달 금지 — 문구 동반).
 */
import { el } from '../../../../shared/lib/dom';
import { badge } from '../../../../shared/ui/atoms/Badge';
import type { FreshnessView } from '../../store/selectors';
import { UI_TEXT } from '../../types/texts';

export interface FreshnessPanelProps {
  readonly view: FreshnessView;
  readonly headingId: string;
}

export function freshnessPanel(props: FreshnessPanelProps): HTMLElement {
  const rows = props.view.rows.map((row) =>
    el('div', { class: 'shuttle-meta__row', dataset: { testid: 'freshness-row', stale: String(row.stale) } }, [
      el('dt', { class: 'shuttle-meta__key', text: row.label }),
      el('dd', { class: 'shuttle-meta__value' }, [
        el('span', { text: `${row.value} · ${row.age}` }),
        row.stale ? badge({ text: '48시간 초과', tone: 'warn' }) : null,
      ]),
    ]),
  );

  const warnings =
    props.view.warnings.length === 0
      ? null
      : el(
          'div',
          { class: 'shuttle-banner shuttle-banner--warn', attrs: { role: 'status' }, dataset: { testid: 'freshness-warning' } },
          [el('ul', { class: 'shuttle-list' }, props.view.warnings.map((warning) => el('li', { text: warning })))],
        );

  const pages =
    props.view.pages.length === 0
      ? null
      : el('details', { class: 'shuttle-details' }, [
          el('summary', { text: UI_TEXT.freshnessPageDetail }),
          el(
            'ul',
            { class: 'shuttle-list', dataset: { testid: 'source-pages' } },
            props.view.pages.map((page) =>
              el('li', {}, [
                el('a', {
                  attrs: { href: page.url, target: '_blank', rel: 'noopener noreferrer' },
                  text: `${page.routeId} · ${page.dayLabel}`,
                }),
                el('span', { text: ` — ${page.sourceUpdatedAt} (${page.age})` }),
              ]),
            ),
          ),
        ]);

  return el(
    'section',
    { class: 'shuttle-card', attrs: { 'aria-labelledby': props.headingId }, dataset: { testid: 'freshness-panel' } },
    [
      el('h2', { class: 'shuttle-card__title', attrs: { id: props.headingId }, text: UI_TEXT.freshnessTitle }),
      el('dl', { class: 'shuttle-meta' }, rows),
      warnings,
      pages,
    ],
  );
}
