import { describe, expect, it } from 'vitest';
import { CELLS, N, idx } from '../src/sim/grid';
import { defaultParams, noWater } from '../src/sim/params';
import { Simulation } from '../src/sim/simulation';

// Fewer Frank–Wolfe iterations keep the long runs quick; the dynamics are the same.
// The shape checks below are about the model on an open plain, so they run without water.
const fast = { fwIterations: 4, ...noWater };

describe('slow layer', () => {
  it('is deterministic for a seed', () => {
    const a = new Simulation(5, fast);
    const b = new Simulation(5, fast);
    a.run(24);
    b.run(24);
    expect(a.fields.rho).toEqual(b.fields.rho);
    expect(a.fields.rent).toEqual(b.fields.rent);
  });

  it('keeps every field finite and above its floor', () => {
    const sim = new Simulation(2, fast);
    sim.run(60);
    const { rho, jobs, rent, floor } = sim.fields;
    for (let i = 0; i < CELLS; i++) {
      expect(Number.isFinite(rho[i]) && rho[i] >= 0).toBe(true);
      expect(Number.isFinite(jobs[i]) && jobs[i] >= 0).toBe(true);
      expect(rent[i]).toBeGreaterThanOrEqual(defaultParams.rentFloor - 1e-6);
      expect(floor[i]).toBeGreaterThanOrEqual(defaultParams.floorMin - 1e-6);
    }
  });

  it('grows a monocentric city with a falling rent gradient', { timeout: 120_000 }, () => {
    const sim = new Simulation(1, fast);
    sim.run(25 * 12);
    const s = sim.stats();
    expect(s.population).toBeGreaterThan(100_000);
    expect(s.jobs / s.population).toBeGreaterThan(0.2);
    expect(s.jobs / s.population).toBeLessThan(1);

    // Centre of jobs.
    let cx = 0;
    let cy = 0;
    let tot = 0;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const j = sim.fields.jobs[idx(x, y)];
        cx += j * x;
        cy += j * y;
        tot += j;
      }
    cx /= tot;
    cy /= tot;
    // Mean rent in rings around the centre falls outward.
    const rings = [0, 0, 0, 0];
    const counts = [0, 0, 0, 0];
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const r = Math.hypot(x - cx, y - cy);
        const k = r < 10 ? 0 : r < 25 ? 1 : r < 40 ? 2 : r < 55 ? 3 : -1;
        if (k < 0) continue;
        rings[k] += sim.fields.rent[idx(x, y)];
        counts[k]++;
      }
    const mean = rings.map((v, k) => v / counts[k]);
    for (let k = 1; k < mean.length; k++) expect(mean[k]).toBeLessThan(mean[k - 1]);
    expect(mean[0]).toBeGreaterThan(5 * defaultParams.rentFloor);
  });

  it('growth stalls as the city outgrows its travel network', { timeout: 120_000 }, () => {
    const sim = new Simulation(1, fast);
    sim.run(10 * 12);
    const p10 = sim.stats().population;
    sim.run(10 * 12);
    const p20 = sim.stats().population;
    sim.run(20 * 12);
    const p40 = sim.stats().population;
    const early = (p20 - p10) / p10;
    const late = (p40 - p20) / p20;
    expect(early).toBeGreaterThan(0.5);
    expect(late).toBeLessThan(early / 2);
  });
});
