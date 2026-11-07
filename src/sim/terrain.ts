import { CELL_M, CELLS, N, idx } from './grid';
import type { Params } from './params';
import { mulberry32, type Rng } from './rng';

/**
 * Static geography of one map, generated once per seed.
 * Water is a single kind of thing: sea, lakes and rivers all end up in the same `water` mask.
 */
export interface Terrain {
  /** Ground elevation, m above sea level (negative under the sea). */
  elevation: Float32Array;
  /** Height of what you see, m: the water surface on water, the ground elsewhere. */
  surface: Float32Array;
  /** 1 on water (sea, lake or river), 0 on land. */
  water: Uint8Array;
  /** 1 on land, 0 on water: the same mask as a multiplier for the model. */
  land: Float32Array;
}

/** Shortest wavelength of the elevation noise, m: finer detail than this is below the grid's resolution. */
const MIN_WAVELENGTH_M = 2 * CELL_M;
/** A river is only traced while it drains at least this much land, m². */
const RIVER_SOURCE_M2 = 300_000;
/** Mouths closer than this are the same river, m. */
const RIVER_SPACING_M = 1_500;
/** Depressions shallower than this are puddles, not lakes, m. */
const LAKE_MIN_M = 0.5;
/** Fall per cell forced on the filled surface so every cell drains, m. */
const FILL_EPS = 1e-3;

const D8X = [1, -1, 0, 0, 1, 1, -1, -1];
const D8Y = [0, 0, 1, -1, 1, -1, 1, -1];

/**
 * Generate land and water.
 *  1. Elevation: fractal value noise with base wavelength `featureSize` and per-octave gain `coastRoughness`,
 *     plus a tilt of strength `mainland` towards a random side so one side becomes a continent.
 *  2. Sea level is the (1 − landShare) quantile, so `landShare` is exactly the share of land before lakes and rivers.
 *  3. Priority-flood fills depressions so every cell drains to the sea or the map edge. Depressions deeper
 *     than `lakeDepth` stay as lakes.
 *  4. Rivers: the `rivers` mouths with the largest catchments, traced upstream along the main stem.
 *     Width grows with the square root of the catchment, up to `riverWidth` at the mouth.
 */
export function generateTerrain(seed: number, p: Params): Terrain {
  const rng = mulberry32((seed ^ 0x5bd1e995) >>> 0);
  const h = fractalNoise(rng, p.featureSize / CELL_M, p.coastRoughness);

  // Continent tilt along a random direction, in units of the map width.
  const theta = rng() * 2 * Math.PI;
  const cx = Math.cos(theta);
  const cy = Math.sin(theta);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) h[idx(x, y)] += p.mainland * (((x + 0.5 - N / 2) * cx + (y + 0.5 - N / 2) * cy) / N);

  // Sea level from the land share.
  const sorted = Float32Array.from(h).sort();
  const share = Math.min(Math.max(p.landShare, 0), 1);
  const k = Math.round((1 - share) * CELLS);
  const seaLevel = k <= 0 ? sorted[0] - 1e-6 : k >= CELLS ? sorted[CELLS - 1] + 1e-6 : (sorted[k - 1] + sorted[k]) / 2;
  const hMin = sorted[0];
  const hMax = sorted[CELLS - 1];

  const elevation = new Float32Array(CELLS);
  for (let i = 0; i < CELLS; i++)
    elevation[i] = h[i] > seaLevel ? ((h[i] - seaLevel) / Math.max(hMax - seaLevel, 1e-6)) * p.relief : -((seaLevel - h[i]) / Math.max(seaLevel - hMin, 1e-6)) * 0.3 * p.relief;
  // The sea is the low ground connected to the map edge; enclosed low ground is a depression like any other.
  const water = openSea(elevation);

  const { filled, parent, order } = priorityFlood(elevation, water);
  const surface = elevation.slice();
  for (let i = 0; i < CELLS; i++) if (water[i]) surface[i] = 0;

  const sea = water.slice();
  addLakes(elevation, filled, water, surface, p.lakeDepth);
  addRivers(elevation, filled, parent, order, sea, water, surface, p);

  const land = new Float32Array(CELLS);
  for (let i = 0; i < CELLS; i++) land[i] = water[i] ? 0 : 1;
  return { elevation, surface, water, land };
}

/** Cells below sea level that connect to the map edge (4-connected). */
function openSea(elev: Float32Array): Uint8Array {
  const sea = new Uint8Array(CELLS);
  const stack: number[] = [];
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = idx(x, y);
      if ((x === 0 || y === 0 || x === N - 1 || y === N - 1) && elev[i] <= 0 && !sea[i]) {
        sea[i] = 1;
        stack.push(i);
      }
    }
  while (stack.length) {
    const c = stack.pop()!;
    const x = c % N;
    const y = (c / N) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + D8X[d];
      const ny = y + D8Y[d];
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const n = idx(nx, ny);
      if (sea[n] || elev[n] > 0) continue;
      sea[n] = 1;
      stack.push(n);
    }
  }
  return sea;
}

/** Value noise summed over octaves from `wavelength` cells down to MIN_WAVELENGTH_M, normalised to 0..1. */
export function fractalNoise(rng: Rng, wavelength: number, gain: number): Float32Array {
  const out = new Float32Array(CELLS);
  let amp = 1;
  let lambda = Math.max(wavelength, 1);
  const minLambda = MIN_WAVELENGTH_M / CELL_M;
  for (let oct = 0; oct < 12 && lambda >= minLambda; oct++) {
    const g = Math.ceil(N / lambda) + 2;
    const lattice = new Float32Array(g * g);
    for (let j = 0; j < lattice.length; j++) lattice[j] = rng();
    const ox = rng();
    const oy = rng();
    for (let y = 0; y < N; y++) {
      const fy = (y + 0.5) / lambda + oy;
      const y0 = Math.floor(fy);
      const ty = smooth(fy - y0);
      for (let x = 0; x < N; x++) {
        const fx = (x + 0.5) / lambda + ox;
        const x0 = Math.floor(fx);
        const tx = smooth(fx - x0);
        const a = lattice[y0 * g + x0];
        const b = lattice[y0 * g + x0 + 1];
        const c = lattice[(y0 + 1) * g + x0];
        const d = lattice[(y0 + 1) * g + x0 + 1];
        out[idx(x, y)] += amp * ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty);
      }
    }
    amp *= gain;
    lambda /= 2;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < CELLS; i++) {
    lo = Math.min(lo, out[i]);
    hi = Math.max(hi, out[i]);
  }
  const inv = 1 / Math.max(hi - lo, 1e-9);
  for (let i = 0; i < CELLS; i++) out[i] = (out[i] - lo) * inv;
  return out;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Priority-flood (Barnes et al. 2014) from the sea and the map edge. Returns the filled surface,
 * each land cell's downstream neighbour (−1 at an outlet) and land cells in the order they were reached,
 * i.e. downstream before upstream.
 */
export function priorityFlood(elev: Float32Array, water: Uint8Array): { filled: Float32Array; parent: Int32Array; order: Int32Array } {
  const filled = elev.slice();
  const parent = new Int32Array(CELLS).fill(-1);
  const closed = new Uint8Array(CELLS);
  const order = new Int32Array(CELLS);
  let nOrder = 0;
  const heap = new MinHeap(CELLS);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = idx(x, y);
      const edge = x === 0 || y === 0 || x === N - 1 || y === N - 1;
      if (water[i] || edge) {
        closed[i] = 1;
        if (water[i]) filled[i] = Math.min(filled[i], 0);
        heap.push(i, filled[i]);
      }
    }
  }
  while (heap.size > 0) {
    const c = heap.pop();
    if (!water[c]) order[nOrder++] = c;
    const x = c % N;
    const y = (c / N) | 0;
    for (let d = 0; d < 8; d++) {
      const nx = x + D8X[d];
      const ny = y + D8Y[d];
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const n = idx(nx, ny);
      if (closed[n]) continue;
      closed[n] = 1;
      filled[n] = Math.max(elev[n], filled[c] + FILL_EPS);
      parent[n] = c;
      heap.push(n, filled[n]);
    }
  }
  return { filled, parent, order: order.subarray(0, nOrder) };
}

/** Turn filled depressions whose deepest point is at least `minDepth` into lakes, flat at their spill level. */
function addLakes(elev: Float32Array, filled: Float32Array, water: Uint8Array, surface: Float32Array, minDepth: number): void {
  const seen = new Uint8Array(CELLS);
  const stack: number[] = [];
  const comp: number[] = [];
  for (let s = 0; s < CELLS; s++) {
    if (seen[s] || water[s] || filled[s] - elev[s] < LAKE_MIN_M) continue;
    comp.length = 0;
    stack.push(s);
    seen[s] = 1;
    let deepest = 0;
    let level = -Infinity;
    while (stack.length) {
      const c = stack.pop()!;
      comp.push(c);
      deepest = Math.max(deepest, filled[c] - elev[c]);
      level = Math.max(level, filled[c]);
      const x = c % N;
      const y = (c / N) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + D8X[d];
        const ny = y + D8Y[d];
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const n = idx(nx, ny);
        if (seen[n] || water[n] || filled[n] - elev[n] < LAKE_MIN_M) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    if (deepest < minDepth) continue;
    for (const c of comp) {
      water[c] = 1;
      surface[c] = level;
    }
  }
}

/** Carve the largest rivers into the water mask. */
function addRivers(
  elev: Float32Array,
  filled: Float32Array,
  parent: Int32Array,
  order: Int32Array,
  sea: Uint8Array,
  water: Uint8Array,
  surface: Float32Array,
  p: Params,
): void {
  const count = Math.round(p.rivers);
  if (count <= 0) return;
  // Catchment of each land cell, in cells: accumulate upstream to downstream (reverse flood order).
  const acc = new Float32Array(CELLS);
  for (let k = order.length - 1; k >= 0; k--) {
    const c = order[k];
    acc[c] += 1;
    const d = parent[c];
    if (d >= 0) acc[d] += acc[c];
  }
  // Mouths: land cells that drain straight into the sea or off the map. Rivers run on through lakes.
  const mouths: number[] = [];
  for (let k = 0; k < order.length; k++) {
    const c = order[k];
    const d = parent[c];
    if (d < 0 || sea[d]) mouths.push(c);
  }
  mouths.sort((a, b) => acc[b] - acc[a]);

  // Upstream neighbours of each cell, as a linked list over cells.
  const firstChild = new Int32Array(CELLS).fill(-1);
  const nextSibling = new Int32Array(CELLS).fill(-1);
  for (let k = 0; k < order.length; k++) {
    const c = order[k];
    const d = parent[c];
    if (d >= 0) {
      nextSibling[c] = firstChild[d];
      firstChild[d] = c;
    }
  }

  const minAcc = RIVER_SOURCE_M2 / (CELL_M * CELL_M);
  const spacing2 = (RIVER_SPACING_M / CELL_M) ** 2;
  const chosen: number[] = [];
  for (const m of mouths) {
    if (chosen.length >= count || acc[m] < minAcc * 3) break;
    const mx = m % N;
    const my = (m / N) | 0;
    if (chosen.some((o) => (o % N - mx) ** 2 + (((o / N) | 0) - my) ** 2 < spacing2)) continue;
    chosen.push(m);
  }

  const mark = (i: number, level: number) => {
    if (water[i]) return;
    water[i] = 1;
    surface[i] = Math.min(elev[i], level);
  };
  for (const m of chosen) {
    const accMouth = acc[m];
    let c = m;
    while (c >= 0 && acc[c] >= minAcc) {
      const widthCells = (p.riverWidth / CELL_M) * Math.sqrt(acc[c] / accMouth);
      const r = Math.max(0, widthCells / 2 - 0.5);
      const x = c % N;
      const y = (c / N) | 0;
      const ri = Math.ceil(r);
      for (let dy = -ri; dy <= ri; dy++)
        for (let dx = -ri; dx <= ri; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= N || ny >= N || dx * dx + dy * dy > r * r + 1e-6) continue;
          mark(idx(nx, ny), filled[c]);
        }
      // Main stem: the upstream neighbour with the largest catchment.
      let best = -1;
      for (let u = firstChild[c]; u >= 0; u = nextSibling[u]) if (best < 0 || acc[u] > acc[best]) best = u;
      if (best >= 0) {
        // Keep the channel 4-connected across diagonal steps: also flood the lower of the two corner cells.
        const bx = best % N;
        const by = (best / N) | 0;
        if (bx !== x && by !== y) {
          const a = idx(bx, y);
          const b = idx(x, by);
          mark(elev[a] < elev[b] ? a : b, filled[c]);
        }
      }
      c = best;
    }
  }
}

/** Binary min-heap of cell indices keyed by a float. */
class MinHeap {
  private idx: Int32Array;
  private key: Float32Array;
  size = 0;
  constructor(cap: number) {
    this.idx = new Int32Array(cap);
    this.key = new Float32Array(cap);
  }
  push(i: number, k: number): void {
    let n = this.size++;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (this.key[p] <= k) break;
      this.idx[n] = this.idx[p];
      this.key[n] = this.key[p];
      n = p;
    }
    this.idx[n] = i;
    this.key[n] = k;
  }
  pop(): number {
    const top = this.idx[0];
    const lastI = this.idx[--this.size];
    const lastK = this.key[this.size];
    let n = 0;
    for (;;) {
      let c = 2 * n + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.key[c + 1] < this.key[c]) c++;
      if (this.key[c] >= lastK) break;
      this.idx[n] = this.idx[c];
      this.key[n] = this.key[c];
      n = c;
    }
    this.idx[n] = lastI;
    this.key[n] = lastK;
    return top;
  }
}

/** Distance from each land cell to the nearest water, in cells (4-connected steps, capped). */
export function waterDistance(water: Uint8Array, cap = 64): Int32Array {
  const dist = new Int32Array(CELLS).fill(cap);
  const queue = new Int32Array(CELLS);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < CELLS; i++)
    if (water[i]) {
      dist[i] = 0;
      queue[tail++] = i;
    }
  while (head < tail) {
    const c = queue[head++];
    const dc = dist[c] + 1;
    if (dc >= cap) continue;
    const x = c % N;
    const y = (c / N) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + D8X[d];
      const ny = y + D8Y[d];
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const n = idx(nx, ny);
      if (dist[n] <= dc) continue;
      dist[n] = dc;
      queue[tail++] = n;
    }
  }
  return dist;
}

/** Label 4-connected land regions; returns labels (−1 on water) and the size of each label. */
export function landRegions(water: Uint8Array): { label: Int32Array; sizes: number[] } {
  const label = new Int32Array(CELLS).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let s = 0; s < CELLS; s++) {
    if (water[s] || label[s] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    label[s] = id;
    stack.push(s);
    while (stack.length) {
      const c = stack.pop()!;
      size++;
      const x = c % N;
      const y = (c / N) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + D8X[d];
        const ny = y + D8Y[d];
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const n = idx(nx, ny);
        if (water[n] || label[n] >= 0) continue;
        label[n] = id;
        stack.push(n);
      }
    }
    sizes.push(size);
  }
  return { label, sizes };
}
