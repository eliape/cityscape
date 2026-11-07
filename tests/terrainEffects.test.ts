import { describe, expect, it } from 'vitest';
import { CELLS } from '../src/sim/grid';
import { targetFloor } from '../src/sim/landuse';
import { defaultParams, noTerrainEffects } from '../src/sim/params';
import { Simulation } from '../src/sim/simulation';
import { UNBUILDABLE_COST } from '../src/sim/terrainEffects';

const fast = { fwIterations: 2 };

describe('terrain effects', () => {
  it('makes water unbuildable and land at least as costly as flat dry land', () => {
    const sim = new Simulation(1, fast);
    const { buildCost } = sim.fields;
    const { water } = sim.terrain;
    let costly = 0;
    for (let i = 0; i < CELLS; i++) {
      if (water[i]) expect(buildCost[i]).toBe(UNBUILDABLE_COST);
      else {
        expect(buildCost[i]).toBeGreaterThanOrEqual(1);
        if (buildCost[i] > 1.5) costly++;
      }
    }
    expect(costly).toBeGreaterThan(0);
  });

  it('charges more on steeper ground and blocks ground above the max grade', () => {
    const sim = new Simulation(1, { ...fast, wetlandCost: 0 });
    const { slope } = sim.geometry;
    const { buildCost } = sim.fields;
    const p = sim.params;
    for (let i = 0; i < CELLS; i++) {
      if (sim.terrain.water[i]) continue;
      const expected = slope[i] > p.slopeMax ? UNBUILDABLE_COST : 1 + p.slopeCost * Math.max(0, slope[i] - p.slopeFree);
      expect(buildCost[i]).toBeCloseTo(expected, 4);
    }
    sim.setParam('slopeMax', 3);
    let blocked = 0;
    for (let i = 0; i < CELLS; i++) if (!sim.terrain.water[i] && buildCost[i] === UNBUILDABLE_COST) blocked++;
    expect(blocked).toBeGreaterThan(0);
  });

  it('puts wetland only on low land near water', () => {
    const sim = new Simulation(1, fast);
    const { wetland } = sim.effects;
    const { waterDist, aboveWater } = sim.geometry;
    const p = sim.params;
    let wet = 0;
    for (let i = 0; i < CELLS; i++) {
      if (wetland[i] > 0) {
        wet++;
        expect(waterDist[i]).toBeLessThanOrEqual(p.wetlandReach);
        expect(aboveWater[i]).toBeLessThan(p.wetlandHeight);
      }
    }
    expect(wet).toBeGreaterThan(0);
  });

  it('gives waterfront land more amenity than land far from water', () => {
    const sim = new Simulation(1, { ...fast, viewAmenity: 0 });
    const { waterDist } = sim.geometry;
    const a = sim.fields.terrainAmenity;
    let near = 0, nNear = 0, far = 0, nFar = 0;
    for (let i = 0; i < CELLS; i++) {
      if (sim.terrain.water[i]) continue;
      if (waterDist[i] <= 100) (near += a[i]), nNear++;
      else if (waterDist[i] >= 1500) (far += a[i]), nFar++;
    }
    expect(near / nNear).toBeGreaterThan(far / nFar + 0.1);
  });

  it('switches off completely with noTerrainEffects', () => {
    const sim = new Simulation(1, { ...fast, ...noTerrainEffects });
    for (let i = 0; i < CELLS; i++) {
      if (sim.terrain.water[i]) continue;
      expect(sim.fields.buildCost[i]).toBe(1);
      expect(sim.fields.terrainAmenity[i]).toBe(0);
    }
  });

  it('needs c times the rent for the same floor space at build cost c', () => {
    const p = defaultParams;
    expect(targetFloor(3, p, 2)).toBeCloseTo(targetFloor(1.5, p), 6);
    expect(targetFloor(3, p, UNBUILDABLE_COST)).toBeLessThan(1e-3);
  });

  it('builds less on costly land than the same city without terrain costs', { timeout: 120_000 }, () => {
    const run = (extra: object) => {
      const sim = new Simulation(1, { fwIterations: 4, waterfrontAmenity: 0, viewAmenity: 0, ...extra });
      sim.run(10 * 12);
      return sim;
    };
    const on = run({});
    const off = run({ slopeCost: 0, slopeMax: 1e9, wetlandCost: 0 });
    // Floor space on the costliest land, as a share of all floor space.
    const share = (sim: Simulation) => {
      let costly = 0, all = 0;
      for (let i = 0; i < CELLS; i++) {
        if (on.terrain.water[i]) continue;
        all += sim.fields.floor[i];
        if (on.fields.buildCost[i] > 1.6) costly += sim.fields.floor[i];
      }
      return costly / all;
    };
    expect(share(on)).toBeLessThan(share(off));
  });
});
