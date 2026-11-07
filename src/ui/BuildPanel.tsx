import { pathLength } from '../sim/metro';
import type { LineView } from '../sim/types';
import { formatCount, formatNumber } from './format';
import { METRO_SPACING, summarise, type LineToolState } from './lineTool';

interface Props {
  tool: LineToolState | null;
  lines: LineView[];
  error: string | null;
  onStart(): void;
  onCancel(): void;
  onNext(): void;
  onBack(): void;
  onBuild(): void;
  onRemove(id: number): void;
}

const km = (m: number) => `${formatNumber(m / 1000, 1)} km`;

/** The Build section: the metro tool and the list of built lines. */
export function BuildPanel({ tool, lines, error, onStart, onCancel, onNext, onBack, onBuild, onRemove }: Props) {
  return (
    <div class="build">
      {!tool && (
        <button class="btn mode" onClick={onStart} title="Metro line (M)">
          <span class="mode-dot" /> Metro line
        </button>
      )}
      {tool && <ToolCard tool={tool} onCancel={onCancel} onNext={onNext} onBack={onBack} onBuild={onBuild} />}
      {error && <p class="error">{error}</p>}
      {lines.length > 0 && (
        <ul class="lines">
          {lines.map((l) => {
            const peak = Math.max(0, ...l.load.map(([a, b]) => Math.max(a, b)));
            return (
              <li key={l.id}>
                <span class="line-badge">M{l.id}</span>
                <span class="line-info">
                  {km(pathLength(l.path))} · {l.stations.length} stations
                  <br />
                  <span class="muted">
                    {formatCount(l.boardings)} boardings/h · peak {Math.round((100 * peak) / l.capacity)} % full
                  </span>
                </span>
                <button class="icon" onClick={() => onRemove(l.id)} title="Demolish line" aria-label={`Demolish line M${l.id}`}>
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ToolCard({ tool, onCancel, onNext, onBack, onBuild }: Pick<Props, 'onCancel' | 'onNext' | 'onBack' | 'onBuild'> & { tool: LineToolState }) {
  const s = summarise(tool);
  const rail = tool.phase === 'rail';
  return (
    <div class="tool-card">
      <div class="tool-steps">
        <span class={rail ? 'on' : 'done'}>1 Rail</span>
        <span class={rail ? '' : 'on'}>2 Stations</span>
      </div>
      {rail ? (
        <p class="hint">
          Click to lay the rail. It runs underground, so it can pass under water and hills. <kbd>Enter</kbd> or double-click when done,{' '}
          <kbd>⌫</kbd> undoes a point.
        </p>
      ) : (
        <p class="hint">
          Click on the rail to add or remove a station. Stations need land for their entrance. <kbd>Enter</kbd> builds the line.
        </p>
      )}
      <p class="tool-readout">
        {km(s.lengthM)}
        {!rail && ` · ${s.stationCount} stations`}
      </p>
      {!rail && (s.tooClose > 0 || s.tooFar > 0) && (
        <p class="warn">
          {s.tooClose > 0 && `${s.tooClose} gap${s.tooClose > 1 ? 's' : ''} under ${km(METRO_SPACING[0])}. `}
          {s.tooFar > 0 && `${s.tooFar} gap${s.tooFar > 1 ? 's' : ''} over ${km(METRO_SPACING[1])}.`}
        </p>
      )}
      <div class="row">
        {rail ? (
          <button class="btn primary" onClick={onNext} disabled={tool.points.length < 2}>
            Place stations
          </button>
        ) : (
          <>
            <button class="btn" onClick={onBack}>
              Back
            </button>
            <button class="btn primary" onClick={onBuild} disabled={s.stationCount < 2}>
              Build line
            </button>
          </>
        )}
        <button class="btn" onClick={onCancel} title="Esc">
          Cancel
        </button>
      </div>
    </div>
  );
}
