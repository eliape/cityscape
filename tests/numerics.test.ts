import { describe, expect, it } from 'vitest';
import { gaussianBlur, laplacian, sum } from '../src/sim/fields';
import { CELLS, N, NZ, ZONES, cellsToZones, idx, zidx, zonesToCells } from '../src/sim/grid';
import { buildNetwork, linkTimes } from '../src/sim/network';
import { defaultParams } from '../src/sim/params';
import { mulberry32 } from '../src/sim/rng';
import { allOrNothing, expKernel, gravity, intrazonalCost, shortestPaths, solveTravel, type Trees } from '../src/sim/travel';

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const xs = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(xs);
    expect(Array.from({ length: 5 }, c)).not.toEqual(xs);
    for (const x of xs) expect(x).toBeGreaterThanOrEqual(0), expect(x).toBeLessThan(1);
  });
});

describe('fields', () => {
  it('diffusion with no-flux edges conserves mass', () => {
    const rng = mulberry32(1);
    const f = new Float32Array(CELLS).map(() => rng() * 100);
    f[idx(0, 0)] = 5000; // a spike in the corner exercises the boundary
    const lap = new Float32Array(CELLS);
    const before = sum(f);
    for (let k = 0; k < 50; k++) {
      laplacian(f, lap);
      for (let i = 0; i < CELLS; i++) f[i] += 0.2 * lap[i];
    }
    expect(Math.abs(sum(f) - before) / before).toBeLessThan(1e-5);
  });

  it('Gaussian blur keeps the total of an interior blob', () => {
    const f = new Float32Array(CELLS);
    f[idx(64, 64)] = 1000;
    const out = gaussianBlur(f, 3, new Float32Array(CELLS));
    expect(sum(out)).toBeCloseTo(1000, 1);
    expect(out[idx(64, 64)]).toBeGreaterThan(out[idx(70, 64)]);
  });

  it('zones aggregate and interpolate consistently', () => {
    const f = new Float32Array(CELLS).fill(2);
    const z = cellsToZones(f);
    expect(z[0]).toBe(128);
    const back = zonesToCells(new Float64Array(ZONES).fill(3), new Float32Array(CELLS));
    expect(back.every((v) => Math.abs(v - 3) < 1e-6)).toBe(true);
  });
});

describe('travel', () => {
  const p = { ...defaultParams };
  const net = buildNetwork(p);
  const trees: Trees = {
    predArc: new Int32Array(ZONES * net.nodes),
    order: new Int32Array(ZONES * net.nodes),
    settled: new Int32Array(ZONES),
  };

  it('shortest paths match straight-line street travel at free flow', () => {
    const time = linkTimes(net, new Float64Array(net.arcs), p, new Float64Array(net.arcs));
    const cost = new Float64Array(ZONES * ZONES);
    shortestPaths(net, time, cost, trees, intrazonalCost(p));
    // Ten zones east along a row: 8 km on the street plus access, or walking if that is cheaper.
    const km = 10 * 0.8;
    const expected = Math.min((km / p.walkSpeed) * 60, p.streetAccess + (km / p.streetSpeed) * 60);
    expect(cost[zidx(0, 0) * ZONES + zidx(10, 0)]).toBeCloseTo(expected, 6);
    // Symmetric network gives symmetric costs.
    expect(cost[zidx(3, 4) * ZONES + zidx(12, 9)]).toBeCloseTo(cost[zidx(12, 9) * ZONES + zidx(3, 4)], 6);
  });

  it('gravity balancing meets both margins', () => {
    const rng = mulberry32(7);
    const O = new Float64Array(ZONES).map(() => rng() * 100);
    const D = new Float64Array(ZONES).map(() => rng() * 100);
    const s = O.reduce((a, b) => a + b) / D.reduce((a, b) => a + b);
    for (let j = 0; j < ZONES; j++) D[j] *= s;
    const time = linkTimes(net, new Float64Array(net.arcs), p, new Float64Array(net.arcs));
    const cost = new Float64Array(ZONES * ZONES);
    shortestPaths(net, time, cost, trees, intrazonalCost(p));
    const K = expKernel(cost, p.beta, new Float64Array(ZONES * ZONES));
    const T = new Float64Array(ZONES * ZONES);
    gravity(O, D, K, T, 500, 1e-10);
    for (let i = 0; i < ZONES; i += 17) {
      let row = 0;
      let col = 0;
      for (let j = 0; j < ZONES; j++) {
        row += T[i * ZONES + j];
        col += T[j * ZONES + i];
      }
      expect(row).toBeCloseTo(O[i], 4);
      expect(col).toBeCloseTo(D[i], 4);
    }
  });

  it('all-or-nothing loading conserves trips leaving each origin', () => {
    const time = linkTimes(net, new Float64Array(net.arcs), p, new Float64Array(net.arcs));
    const cost = new Float64Array(ZONES * ZONES);
    shortestPaths(net, time, cost, trees, intrazonalCost(p));
    const T = new Float64Array(ZONES * ZONES);
    T[zidx(2, 2) * ZONES + zidx(9, 2)] = 100;
    const flow = allOrNothing(net, T, trees, new Float64Array(net.arcs));
    // Flow out of the origin node equals the trip count.
    let out = 0;
    for (let a = 0; a < net.arcs; a++) if (net.from[a] === zidx(2, 2)) out += flow[a];
    expect(out).toBeCloseTo(100, 6);
  });

  it('Frank–Wolfe lowers the objective and closes the gap', () => {
    const rng = mulberry32(3);
    const O = new Float64Array(ZONES);
    const D = new Float64Array(ZONES);
    // A congested monocentric city: workers everywhere, jobs in the middle.
    for (let zy = 0; zy < NZ; zy++)
      for (let zx = 0; zx < NZ; zx++) {
        const r = Math.hypot(zx - 7.5, zy - 7.5);
        O[zidx(zx, zy)] = 3000 * Math.exp(-r / 4) * (0.8 + 0.4 * rng());
        D[zidx(zx, zy)] = 8000 * Math.exp(-r / 1.5);
      }
    const res = solveTravel(net, O, D, { ...p, fwIterations: 15 });
    for (let k = 1; k < res.objective.length; k++) expect(res.objective[k]).toBeLessThanOrEqual(res.objective[k - 1] + 1e-6 * Math.abs(res.objective[k - 1]));
    expect(res.gap[res.gap.length - 1]).toBeLessThan(res.gap[0] * 0.2);
    // Trips are conserved.
    expect(res.trips.reduce((a, b) => a + b)).toBeCloseTo(O.reduce((a, b) => a + b), 0);
    // Congestion makes the centre slower than free flow.
    const free = linkTimes(net, new Float64Array(net.arcs), p, new Float64Array(net.arcs));
    let slower = 0;
    for (let a = 0; a < net.arcs; a++) if (res.time[a] > free[a] * 1.5) slower++;
    expect(slower).toBeGreaterThan(0);
    expect(N).toBe(128);
  });
});
