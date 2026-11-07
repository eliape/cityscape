import { describe, expect, it } from 'vitest';
import { CELLS, N, idx } from '../src/sim/grid';
import { defaultParams, noWater, type Params } from '../src/sim/params';
import { generateTerrain, landRegions } from '../src/sim/terrain';
import { Simulation } from '../src/sim/simulation';

const params = (over: Partial<Params> = {}): Params => ({ ...defaultParams, ...over });
const waterShare = (w: Uint8Array) => w.reduce((s, v) => s + v, 0) / CELLS;

describe('terrain', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    const a = generateTerrain(3, params());
    const b = generateTerrain(3, params());
    const c = generateTerrain(4, params());
    expect(a.water).toEqual(b.water);
    expect(a.elevation).toEqual(b.elevation);
    expect(a.water).not.toEqual(c.water);
  });

  it('puts the sea level at the land share', () => {
    for (const landShare of [0.3, 0.6, 0.9]) {
      const t = generateTerrain(1, params({ landShare, rivers: 0, lakeDepth: 1e9 }));
      // Enclosed low ground counts as land, so the sea can only be smaller than 1 − share.
      expect(waterShare(t.water)).toBeLessThanOrEqual(1 - landShare + 1e-3);
      expect(waterShare(t.water)).toBeGreaterThan((1 - landShare) * 0.7);
    }
  });

  it('has no water at all with the noWater settings', () => {
    const t = generateTerrain(1, params(noWater));
    expect(waterShare(t.water)).toBe(0);
  });

  it('breaks low land into many islands with small landforms and one landmass with large ones', () => {
    const arch = landRegions(generateTerrain(1, params({ landShare: 0.35, featureSize: 2000, mainland: 0, rivers: 0 })).water).sizes;
    const main = landRegions(generateTerrain(1, params({ landShare: 0.85, featureSize: 8000, mainland: 1, rivers: 0 })).water).sizes;
    const largest = (s: number[]) => Math.max(...s) / s.reduce((a, b) => a + b, 0);
    expect(arch.filter((s) => s >= 20).length).toBeGreaterThan(4);
    expect(largest(main)).toBeGreaterThan(0.9);
  });

  it('adds rivers that connect to the sea or the map edge', () => {
    const p = params({ landShare: 0.85, featureSize: 8000, mainland: 1, lakeDepth: 1e9 });
    const dry = generateTerrain(2, { ...p, rivers: 0 });
    const wet = generateTerrain(2, { ...p, rivers: 3 });
    const added = waterShare(wet.water) - waterShare(dry.water);
    expect(added).toBeGreaterThan(0.002);
    // Every river cell reaches the sea or the edge through water (4-connected).
    const reach = new Uint8Array(CELLS);
    const stack: number[] = [];
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = idx(x, y);
        if (wet.water[i] && (dry.water[i] || x === 0 || y === 0 || x === N - 1 || y === N - 1)) {
          reach[i] = 1;
          stack.push(i);
        }
      }
    while (stack.length) {
      const c = stack.pop()!;
      const x = c % N;
      const y = (c / N) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const n = idx(nx, ny);
        if (wet.water[n] && !reach[n]) {
          reach[n] = 1;
          stack.push(n);
        }
      }
    }
    for (let i = 0; i < CELLS; i++) if (wet.water[i]) expect(reach[i]).toBe(1);
  });
});

describe('water in the model', () => {
  it('starts the village on land and never builds on water', () => {
    const sim = new Simulation(1, { fwIterations: 4, landShare: 0.5, featureSize: 3000 });
    const { rho, jobs, floor, land } = sim.fields;
    let pop0 = 0;
    for (let i = 0; i < CELLS; i++) pop0 += rho[i];
    expect(pop0).toBeGreaterThan(1000);
    sim.run(60);
    let water = 0;
    for (let i = 0; i < CELLS; i++) {
      if (land[i]) continue;
      water++;
      expect(rho[i]).toBe(0);
      expect(jobs[i]).toBe(0);
      expect(floor[i]).toBeCloseTo(defaultParams.floorMin, 6);
    }
    expect(water).toBeGreaterThan(CELLS * 0.2);
  });
});
