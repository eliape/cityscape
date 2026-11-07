import { describe, expect, it } from 'vitest';
import { CELLS, N, ZONES, cellZone, idx } from '../src/sim/grid';
import { pathLength, railBetween, railThrough, validateLine } from '../src/sim/metro';
import { noWater } from '../src/sim/params';
import { Simulation } from '../src/sim/simulation';

const fast = { fwIterations: 4, ...noWater };

/** A straight east–west line along row y with stations every `spacing` cells. */
function straightLine(x0: number, x1: number, y: number, spacing: number) {
  const path = railThrough([idx(x0, y), idx(x1, y)]);
  const stations: number[] = [];
  for (let k = 0; k < path.length; k += spacing) stations.push(k);
  if (stations[stations.length - 1] !== path.length - 1) stations.push(path.length - 1);
  return { path, stations };
}

describe('metro geometry', () => {
  it('draws a continuous 8-connected rail between two cells', () => {
    const a = idx(3, 4);
    const b = idx(20, 11);
    const r = railBetween(a, b);
    expect(r[0]).toBe(a);
    expect(r[r.length - 1]).toBe(b);
    expect(r.length).toBe(18); // max(|dx|, |dy|) + 1
    for (let k = 1; k < r.length; k++) {
      expect(Math.abs((r[k] % N) - (r[k - 1] % N))).toBeLessThanOrEqual(1);
      expect(Math.abs(((r[k] / N) | 0) - ((r[k - 1] / N) | 0))).toBeLessThanOrEqual(1);
    }
    // 7 diagonal steps and 10 straight ones.
    expect(pathLength(r)).toBeCloseTo(7 * 100 * Math.SQRT2 + 10 * 100, 6);
  });

  it('lets the rail cross water but keeps stations on land', () => {
    const water = new Uint8Array(CELLS);
    for (let y = 0; y < N; y++) for (let x = 40; x < 60; x++) water[idx(x, y)] = 1;
    const line = straightLine(20, 80, 64, 10);
    // Stations at x = 40 and 50 fall in the water.
    expect(validateLine(line, water)).toMatch(/land/);
    const ok = { path: line.path, stations: [0, line.path.length - 1] };
    expect(validateLine(ok, water)).toBeNull();
  });

  it('rejects broken rails and too few stations', () => {
    const water = new Uint8Array(CELLS);
    expect(validateLine({ path: [idx(1, 1), idx(3, 1)], stations: [0, 1] }, water)).toMatch(/continuous/);
    expect(validateLine({ path: railThrough([idx(1, 1), idx(9, 1)]), stations: [0] }, water)).toMatch(/two stations/);
    expect(validateLine({ path: railThrough([idx(1, 1), idx(9, 1)]), stations: [4, 2] }, water)).toMatch(/order/);
  });
});

describe('metro in the travel model', () => {
  it('cuts the cost between the zones it links', () => {
    const sim = new Simulation(3, fast);
    // Row 68 runs through zone centres, so the end stations sit next to the centroids.
    const a = cellZone[idx(12, 68)];
    const b = cellZone[idx(116, 68)];
    const before = sim.travel.cost[a * ZONES + b];
    sim.addLine(straightLine(12, 116, 68, 10));
    const after = sim.travel.cost[a * ZONES + b];
    // 10.4 km: ~35 min by street; by metro ~18 min riding plus access, a short walk and the wait.
    expect(after).toBeLessThan(before - 8);
    expect(after).toBeGreaterThan((10.4 / 35) * 60);
    sim.removeLine(sim.lines[0].id);
    expect(sim.travel.cost[a * ZONES + b]).toBeCloseTo(before, 6);
  });

  it('carries riders, raises access along the line and keeps Frank–Wolfe descending', { timeout: 120_000 }, () => {
    const sim = new Simulation(1, fast);
    sim.run(20 * 12);
    // Job centre row.
    let cy = 0;
    let tot = 0;
    for (let i = 0; i < CELLS; i++) {
      cy += sim.fields.jobs[i] * ((i / N) | 0);
      tot += sim.fields.jobs[i];
    }
    const y = Math.round(cy / tot);
    const far = idx(110, y);
    const lnBefore = sim.lnAw[far];
    sim.addLine(straightLine(18, 110, y, 8));
    sim.refresh();
    const s = sim.stats();
    expect(s.metroRiders).toBeGreaterThan(100);
    expect(s.metroShare).toBeGreaterThan(0);
    expect(sim.lnAw[far]).toBeGreaterThan(lnBefore);
    const view = sim.networkView();
    expect(view.lines).toHaveLength(1);
    expect(view.lines[0].load.some(([f, b]) => f + b > 0)).toBe(true);
    expect(view.lines[0].boardings).toBeGreaterThanOrEqual(s.metroRiders - 1e-6);
    const obj = sim.travel.objective;
    expect(obj[obj.length - 1]).toBeLessThanOrEqual(obj[0] + 1e-6 * Math.abs(obj[0]));
  });

  it('lets lines tunnel under water', () => {
    const sim = new Simulation(4);
    const { water } = sim.terrain;
    // Find a row with land, then water, then land again.
    for (let y = 8; y < N - 8; y += 4) {
      let start = -1;
      let wet = false;
      for (let x = 0; x < N; x++) {
        const w = water[idx(x, y)];
        if (!w && !wet) start = x;
        else if (w && start >= 0) wet = true;
        else if (!w && wet) {
          const line = { path: railThrough([idx(start, y), idx(x, y)]), stations: [0, x - start] };
          expect(validateLine(line, water)).toBeNull();
          sim.addLine(line);
          expect(sim.lines).toHaveLength(1);
          return;
        }
      }
    }
    throw new Error('no water crossing on this map');
  });

  it('clears lines when a new city starts', () => {
    const sim = new Simulation(2, fast);
    sim.addLine(straightLine(30, 90, 64, 10));
    sim.reset(2);
    expect(sim.lines).toHaveLength(0);
  });
});
