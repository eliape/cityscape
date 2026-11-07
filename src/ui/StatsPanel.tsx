import { useState } from 'preact/hooks';
import { Sparkline } from './Sparkline';
import { formatCount, formatNumber } from './format';

export interface History {
  years: number[];
  population: number[];
  commute: number[];
  lnA: number[];
  version: number;
}

export function emptyHistory(): History {
  return { years: [], population: [], commute: [], lnA: [], version: 0 };
}

const SERIES = [
  { key: 'population', label: 'Population', color: '#d9822b', fmt: formatCount },
  { key: 'commute', label: 'Mean commute (min)', color: '#3b82c4', fmt: (v: number) => formatNumber(v, 1) },
  { key: 'lnA', label: 'Mean ln A (welfare)', color: '#3a9e6f', fmt: (v: number) => formatNumber(v, 2) },
] as const;

/** Sparklines that expand to full uPlot charts on click. */
export function StatsPanel({ history }: { history: History }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div class="stats">
      {SERIES.map((s) => {
        const ys = history[s.key];
        const last = ys.length ? ys[ys.length - 1] : NaN;
        const open = expanded === s.key;
        return (
          <button key={s.key} class={`stat ${open ? 'open' : ''}`} onClick={() => setExpanded(open ? null : s.key)} aria-expanded={open}>
            <div class="stat-head">
              <span>{s.label}</span>
              <span class="stat-value">{Number.isFinite(last) ? s.fmt(last) : '—'}</span>
            </div>
            <Sparkline xs={history.years} ys={ys} expanded={open} color={s.color} format={s.fmt} version={history.version} />
          </button>
        );
      })}
    </div>
  );
}
