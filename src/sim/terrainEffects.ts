import { CELL_M, CELLS, N, idx } from './grid';
import { gaussianBlur } from './fields';
import type { Params } from './params';
import type { Terrain } from './terrain';

/** Build cost given to unbuildable land: high enough that the supply curve builds nothing there. */
export const UNBUILDABLE_COST = 1e3;
/** Neighbourhood that "the surroundings" means for the view amenity, m (Gaussian σ). */
const VIEW_SCALE_M = 1_000;
/** Water further than this has no effect (BFS cap), m. */
const WATER_REACH_M = 3_000;

/** Geometry derived once per map; the model terms below are cheap functions of it and the params. */
export interface TerrainGeometry {
  /** Ground slope, % grade (rise over run × 100). 0 on water. */
  slope: Float32Array;
  /** Distance to the nearest water, m (capped at WATER_REACH_M). 0 on water. */
  waterDist: Float32Array;
  /** Ground height above the surface of that nearest water, m. */
  aboveWater: Float32Array;
  /** Ground height above the smoothed surroundings, m (positive on hills and ridges). */
  prominence: Float32Array;
}

/** Per-cell model inputs from terrain. */
export interface TerrainEffects {
  /** Construction cost relative to flat dry land (≥ 1; UNBUILDABLE_COST where nothing can be built). */
  buildCost: Float32Array;
  /** Wetland share of each cell, 0..1. */
  wetland: Float32Array;
  /** Household amenity from water and views, in bid-rent units. */
  amenity: Float32Array;
}

export function terrainGeometry(t: Terrain): TerrainGeometry {
  const { surface, water } = t;
  const slope = new Float32Array(CELLS);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = idx(x, y);
      if (water[i]) continue;
      // Central differences of the visible surface, so a shore slopes down to the water line, not the sea bed.
      const xl = x > 0 ? x - 1 : x;
      const xr = x < N - 1 ? x + 1 : x;
      const yu = y > 0 ? y - 1 : y;
      const yd = y < N - 1 ? y + 1 : y;
      const gx = (surface[idx(xr, y)] - surface[idx(xl, y)]) / ((xr - xl) * CELL_M);
      const gy = (surface[idx(x, yd)] - surface[idx(x, yu)]) / ((yd - yu) * CELL_M);
      slope[i] = 100 * Math.hypot(gx, gy);
    }

  // Breadth-first search from all water at once, carrying the surface level of the water each cell is nearest to.
  const cap = Math.ceil(WATER_REACH_M / CELL_M);
  const steps = new Int32Array(CELLS).fill(cap);
  const level = new Float32Array(CELLS);
  const queue = new Int32Array(CELLS);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < CELLS; i++)
    if (water[i]) {
      steps[i] = 0;
      level[i] = surface[i];
      queue[tail++] = i;
    }
  while (head < tail) {
    const c = queue[head++];
    const dc = steps[c] + 1;
    if (dc >= cap) continue;
    const x = c % N;
    const y = (c / N) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0);
      const ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const n = idx(nx, ny);
      if (steps[n] <= dc) continue;
      steps[n] = dc;
      level[n] = level[c];
      queue[tail++] = n;
    }
  }
  const waterDist = new Float32Array(CELLS);
  const aboveWater = new Float32Array(CELLS);
  const noWater = tail === 0;
  for (let i = 0; i < CELLS; i++) {
    waterDist[i] = steps[i] * CELL_M;
    aboveWater[i] = noWater || steps[i] >= cap ? Infinity : Math.max(0, surface[i] - level[i]);
  }

  const smooth = gaussianBlur(surface, VIEW_SCALE_M / CELL_M, new Float32Array(CELLS));
  const prominence = new Float32Array(CELLS);
  for (let i = 0; i < CELLS; i++) prominence[i] = water[i] ? 0 : surface[i] - smooth[i];
  return { slope, waterDist, aboveWater, prominence };
}

export function createTerrainEffects(): TerrainEffects {
  return { buildCost: new Float32Array(CELLS).fill(1), wetland: new Float32Array(CELLS), amenity: new Float32Array(CELLS) };
}

/**
 * Model terms from terrain:
 *  - Build cost c = 1 + slopeCost·max(0, grade − slopeFree) + wetlandCost·wetland, and unbuildable above slopeMax.
 *  - Wetland: low, near-water land, 1 at the water line falling linearly to 0 at `wetlandHeight` m above it,
 *    and only within `wetlandReach` m of the water.
 *  - Amenity: waterfront·e^{−d/waterfrontRange} + view·max(0, prominence)/10 m, for households.
 */
export function computeTerrainEffects(g: TerrainGeometry, water: Uint8Array, p: Params, out: TerrainEffects): void {
  const { slope, waterDist, aboveWater, prominence } = g;
  for (let i = 0; i < CELLS; i++) {
    if (water[i]) {
      out.buildCost[i] = UNBUILDABLE_COST;
      out.wetland[i] = 0;
      out.amenity[i] = 0;
      continue;
    }
    const wet =
      p.wetlandHeight > 0 && waterDist[i] <= p.wetlandReach ? Math.max(0, 1 - aboveWater[i] / p.wetlandHeight) : 0;
    out.wetland[i] = wet;
    out.buildCost[i] =
      slope[i] > p.slopeMax ? UNBUILDABLE_COST : 1 + p.slopeCost * Math.max(0, slope[i] - p.slopeFree) + p.wetlandCost * wet;
    const shore = p.waterfrontRange > 0 && Number.isFinite(aboveWater[i]) ? p.waterfrontAmenity * Math.exp(-waterDist[i] / p.waterfrontRange) : 0;
    out.amenity[i] = shore + (p.viewAmenity * Math.max(0, prominence[i])) / 10;
  }
}
