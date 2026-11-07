import { describe, expect, it } from 'vitest';
import { CELL_KM2, CELL_M, CELLS } from '../src/sim/grid';
import { createFields, gaussianBlur } from '../src/sim/fields';
import { cityOutput } from '../src/sim/output';
import { defaultParams, noTerrainEffects, noWater } from '../src/sim/params';
import { Simulation } from '../src/sim/simulation';

const p = defaultParams;

function outputOf(jobs: (i: number) => number): { total: number; perCell: Float32Array } {
  const f = createFields();
  for (let i = 0; i < CELLS; i++) f.jobs[i] = jobs(i);
  const blur = gaussianBlur(f.jobs, p.agglomRange / CELL_M, new Float32Array(CELLS));
  const perCell = new Float32Array(CELLS);
  return { total: cityOutput(f, blur, p, perCell), perCell };
}

describe('output', () => {
  it('is base output per job when there is no agglomeration', () => {
    const f = createFields();
    f.jobs.fill(10);
    const total = cityOutput(f, new Float32Array(CELLS), p);
    expect(total).toBeCloseTo(10 * CELLS * p.outputPerJob * 1000, -3);
  });

  it('is higher per job when the same jobs are clustered', () => {
    const n = 20_000;
    const spread = outputOf(() => n / CELLS);
    const clustered = outputOf((i) => (i === CELLS / 2 + 64 ? n : 0));
    expect(clustered.total / n).toBeGreaterThan(spread.total / n);
    expect(spread.total / n).toBeGreaterThan(p.outputPerJob * 1000);
  });

  it('reports a growing city with output per job above the base', { timeout: 60_000 }, () => {
    const sim = new Simulation(1, { fwIterations: 4, ...noWater, ...noTerrainEffects });
    const y0 = sim.stats().output;
    sim.run(5 * 12);
    const s = sim.stats();
    expect(s.output).toBeGreaterThan(y0);
    expect(s.output / s.jobs).toBeGreaterThan(p.outputPerJob * 1000);
    // The overlay field adds up to the total.
    const snap = sim.snapshot();
    let sum = 0;
    for (let i = 0; i < CELLS; i++) sum += snap.output[i] * CELL_KM2 * 1e6;
    expect(sum / s.output).toBeCloseTo(1, 4);
  });
});
