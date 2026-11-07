import { describe, expect, it } from 'vitest';
import { CELLS, N, idx } from '../src/sim/grid';
import { mulberry32 } from '../src/sim/rng';
import { LOTS, LotModel } from '../src/render/lots';

/** A smooth blob of floor space (FAR) and a job share that rises toward its centre. */
function fields(peak: number) {
  const floor = new Float32Array(CELLS);
  const mix = new Float32Array(CELLS);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const r2 = ((x - 64) ** 2 + (y - 64) ** 2) / 15 ** 2;
      floor[idx(x, y)] = peak * Math.exp(-r2);
      mix[idx(x, y)] = Math.exp(-r2 * 3);
    }
  return { floor, mix };
}

describe('building lots', () => {
  it('builds straight to target on the first snapshot', () => {
    const lots = new LotModel();
    const { floor, mix } = fields(3);
    lots.update(0, floor, mix);
    expect(lots.count()).toBeGreaterThan(500);
    // Taller in the middle than at the edge of the blob.
    const centre = 128 * 256 + 128;
    expect(lots.floors[centre]).toBeGreaterThan(3);
    expect(lots.floors[0]).toBe(0);
    // The centre is mostly offices, the edge mostly homes.
    let inner = 0, innerC = 0, outer = 0, outerC = 0;
    for (let i = 0; i < LOTS; i++) {
      if (!lots.floors[i]) continue;
      const x = (i % 256) - 128, y = Math.floor(i / 256) - 128;
      const r = Math.hypot(x, y);
      if (r < 8) (inner++, (innerC += lots.commercial[i]));
      else if (r > 30) (outer++, (outerC += lots.commercial[i]));
    }
    expect(innerC / inner).toBeGreaterThan(0.6);
    expect(outerC / outer).toBeLessThan(0.2);
  });

  it('does not flicker when the fields wobble a little', () => {
    const lots = new LotModel();
    const base = fields(3);
    lots.update(0, base.floor, base.mix);
    const before = lots.floors.slice();
    const rng = mulberry32(9);
    const noisy = new Float32Array(CELLS);
    for (let month = 1; month <= 120; month++) {
      for (let i = 0; i < CELLS; i++) noisy[i] = base.floor[i] * (0.95 + 0.1 * rng());
      lots.update(month, noisy, base.mix);
    }
    let changed = 0;
    for (let i = 0; i < LOTS; i++) if (lots.floors[i] !== before[i] && before[i] > 0) changed++;
    // Only lots right at the development threshold may still fill in; built ones stay as they are.
    expect(changed).toBe(0);
  });

  it('catches up gradually when the city densifies, and jumps on a new city', () => {
    const lots = new LotModel();
    const small = fields(1);
    lots.update(0, small.floor, small.mix);
    const far0 = lots.builtFar();
    const big = fields(4);
    lots.update(1, big.floor, big.mix);
    const far1 = lots.builtFar();
    for (let m = 2; m <= 120; m++) lots.update(m, big.floor, big.mix);
    const far120 = lots.builtFar();
    expect(far1 - far0).toBeLessThan((far120 - far0) * 0.2); // one month changes little
    expect(far120).toBeGreaterThan(far0 * 2); // ten years later it has densified
    // Time going backwards is a new city: rebuild at once.
    lots.update(0, small.floor, small.mix);
    expect(lots.builtFar()).toBeCloseTo(far0, 3);
  });
});
