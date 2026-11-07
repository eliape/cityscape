import type { ComponentChildren } from 'preact';
import { OVERLAYS, type Legend, type OverlayId } from '../render/overlays';
import { formatNumber } from './format';
import { StatsPanel, type History } from './StatsPanel';

interface Props {
  collapsed: boolean;
  onCollapse(c: boolean): void;
  overlay: OverlayId;
  onOverlay(id: OverlayId): void;
  legend: Legend | null;
  flatten: boolean;
  onFlatten(on: boolean): void;
  seed: number;
  onSeed(seed: number): void;
  onReset(): void;
  history: History;
  tuning: boolean;
  tuningOpen: boolean;
  onTuning(open: boolean): void;
  build: ComponentChildren;
}

function Section({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section class="section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function LegendBar({ legend }: { legend: Legend }) {
  const fmt = (v: number) => formatNumber(v, legend.digits) + (legend.unit ? ` ${legend.unit}` : '');
  return (
    <div class="legend">
      <div class={`ramp ${legend.kind}`} />
      <div class="legend-labels">
        <span>{fmt(legend.min)}</span>
        {legend.kind === 'diverging' && <span>{fmt((legend.min + legend.max) / 2)}</span>}
        <span>{fmt(legend.max)}</span>
      </div>
    </div>
  );
}

const Icon = {
  layers: (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path d="M10 2 2 6l8 4 8-4-8-4zm-8 8 8 4 8-4M2 14l8 4 8-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
    </svg>
  ),
  chart: (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path d="M3 16h14M5 13l3-4 3 2 4-6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  ),
  rail: (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path d="M3 15c3-8 11-8 14-10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      <circle cx="4.5" cy="12.5" r="2" fill="var(--panel)" stroke="currentColor" stroke-width="1.5" />
      <circle cx="14" cy="6.5" r="2" fill="var(--panel)" stroke="currentColor" stroke-width="1.5" />
    </svg>
  ),
  chevron: (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <path d="M12.5 5 7.5 10l5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  ),
};

/** View, build, simulation and stats. */
export function SidePanel(props: Props) {
  const { collapsed, onCollapse } = props;
  if (collapsed) {
    return (
      <aside class="sidepanel collapsed">
        <button class="icon" onClick={() => onCollapse(false)} title="Show panel" aria-label="Show panel">
          <span class="flip">{Icon.chevron}</span>
        </button>
        <button class="icon" onClick={() => onCollapse(false)} title="View">
          {Icon.layers}
        </button>
        <button class="icon" onClick={() => onCollapse(false)} title="Build">
          {Icon.rail}
        </button>
        <button class="icon" onClick={() => onCollapse(false)} title="Stats">
          {Icon.chart}
        </button>
      </aside>
    );
  }
  const active = OVERLAYS.find((o) => o.id === props.overlay)!;
  return (
    <aside class="sidepanel">
      <header class="panel-head">
        <h1>Transit City</h1>
        <button class="icon" onClick={() => onCollapse(true)} title="Collapse panel" aria-label="Collapse panel">
          {Icon.chevron}
        </button>
      </header>

      <Section title="View">
        <div class="radios" role="radiogroup" aria-label="Map view">
          {OVERLAYS.map((o) => (
            <label key={o.id} class={`radio ${props.overlay === o.id ? 'on' : ''}`}>
              <input type="radio" name="overlay" checked={props.overlay === o.id} onChange={() => props.onOverlay(o.id)} />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
        <p class="hint">{active.hint}</p>
        {props.legend && <LegendBar legend={props.legend} />}
        <label class="toggle">
          <input type="checkbox" checked={props.flatten} onChange={(e) => props.onFlatten((e.target as HTMLInputElement).checked)} />
          <span>Flatten buildings</span>
        </label>
      </Section>

      <Section title="Build">{props.build}</Section>

      <Section title="Simulation">
        <div class="row">
          <label class="seed">
            <span>Seed</span>
            <input
              type="number"
              min={0}
              value={props.seed}
              onChange={(e) => props.onSeed(Math.max(0, Math.floor(Number((e.target as HTMLInputElement).value)) || 0))}
            />
          </label>
          <button class="btn" onClick={props.onReset}>
            New city
          </button>
        </div>
        {props.tuning && (
          <label class="toggle">
            <input type="checkbox" checked={props.tuningOpen} onChange={(e) => props.onTuning((e.target as HTMLInputElement).checked)} />
            <span>Tune model parameters</span>
          </label>
        )}
      </Section>

      <Section title="Stats">
        <StatsPanel history={props.history} />
      </Section>

      <p class="keys">
        <kbd>Space</kbd> play/pause · <kbd>1</kbd>
        <kbd>2</kbd>
        <kbd>3</kbd> speed · <kbd>O</kbd> overlays · <kbd>M</kbd> metro
      </p>
    </aside>
  );
}
