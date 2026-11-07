import type { Stats } from '../sim/types';
import type { Speed } from '../worker/simWorker';
import { formatCount, formatDate, formatNumber } from './format';

interface Props {
  stats: Stats | null;
  playing: boolean;
  speed: Speed;
  onTogglePlay(): void;
  onSpeed(s: Speed): void;
}

const SPEEDS: Speed[] = [1, 4, 16];

/** Time controls and the headline numbers. */
export function BottomBar({ stats, playing, speed, onTogglePlay, onSpeed }: Props) {
  return (
    <footer class="bottombar">
      <button class={`play ${playing ? 'on' : ''}`} onClick={onTogglePlay} title="Play / pause (Space)" aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? (
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <rect x="3" y="2" width="3.5" height="12" rx="1" fill="currentColor" />
            <rect x="9.5" y="2" width="3.5" height="12" rx="1" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M4 2.5v11a.5.5 0 0 0 .77.42l8.5-5.5a.5.5 0 0 0 0-.84l-8.5-5.5A.5.5 0 0 0 4 2.5z" fill="currentColor" />
          </svg>
        )}
      </button>
      <div class="speeds" role="radiogroup" aria-label="Speed">
        {SPEEDS.map((s, i) => (
          <button key={s} role="radio" aria-checked={speed === s} class={speed === s ? 'on' : ''} onClick={() => onSpeed(s)} title={`${s}× (${i + 1})`}>
            {s}×
          </button>
        ))}
      </div>
      <div class="readout date">{stats ? formatDate(stats.month) : '—'}</div>
      <div class="readout">
        <span class="label">Population</span>
        <span class="value">{stats ? formatCount(stats.population) : '—'}</span>
      </div>
      <div class="readout">
        <span class="label">Jobs</span>
        <span class="value">{stats ? formatCount(stats.jobs) : '—'}</span>
      </div>
      <div class="readout">
        <span class="label">Mean commute</span>
        <span class="value">{stats ? `${formatNumber(stats.meanCommute, 1)} min` : '—'}</span>
      </div>
    </footer>
  );
}
