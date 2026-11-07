import { useEffect, useRef } from 'preact/hooks';
import uPlot from 'uplot';

interface Props {
  xs: number[]; // years
  ys: number[];
  expanded: boolean;
  color: string;
  format: (v: number) => string;
  /** Bumped whenever xs/ys were appended to in place. */
  version: number;
}

/** A uPlot series: a bare sparkline, or a full chart with axes when expanded. */
export function Sparkline({ xs, ys, expanded, color, format, version }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);

  useEffect(() => {
    const el = host.current!;
    const width = el.clientWidth || 240;
    const axisStroke = getComputedStyle(el).getPropertyValue('--muted').trim() || '#888';
    const gridStroke = getComputedStyle(el).getPropertyValue('--grid').trim() || 'rgba(128,128,128,.2)';
    const opts: uPlot.Options = expanded
      ? {
          width,
          height: 150,
          legend: { show: false },
          cursor: { show: true, points: { size: 6 } },
          scales: { x: { time: false } },
          axes: [
            { stroke: axisStroke, grid: { stroke: gridStroke, width: 1 }, ticks: { show: false }, size: 28, values: (_u, v) => v.map((t) => `y${Math.floor(t) + 1}`) },
            { stroke: axisStroke, grid: { stroke: gridStroke, width: 1 }, ticks: { show: false }, size: 48, values: (_u, v) => v.map(format) },
          ],
          series: [{}, { stroke: color, width: 2, fill: color + '22' }],
        }
      : {
          width,
          height: 34,
          legend: { show: false },
          cursor: { show: false },
          scales: { x: { time: false } },
          axes: [{ show: false }, { show: false }],
          series: [{}, { stroke: color, width: 1.5, fill: color + '1f' }],
        };
    plot.current = new uPlot(opts, [xs, ys], el);
    return () => {
      plot.current?.destroy();
      plot.current = null;
    };
    // Rebuild only when the mode changes; data updates go through setData below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  useEffect(() => {
    plot.current?.setData([xs, ys]);
  }, [xs, ys, version]);

  return <div class="spark" ref={host} />;
}
