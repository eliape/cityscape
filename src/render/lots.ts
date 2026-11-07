import { CELL_M, N } from '../sim/grid';
import { mulberry32, type Rng } from '../sim/rng';

/**
 * The building layer's own state: a finer grid of lots that develop from the model's smooth fields.
 * It is pure data (no Three.js) so it can be tested headless.
 *
 * Each lot samples floor space S (FAR) and job share at its centre by bilinear interpolation, and turns
 * them into one building with a whole number of floors. Buildings change only through discrete events
 * (construction, redevelopment, demolition) that happen at a rate per simulated month, so the skyline
 * evolves smoothly and never flickers as the fields move a little between snapshots.
 */
export const LOT_M = 50;
export const LN = (N * CELL_M) / LOT_M; // lots per side
export const LOTS = LN * LN;

/** Monthly event rates. */
const BUILD_RATE = 0.12;
const REDEVELOP_RATE = 0.04;
const DEMOLISH_RATE = 0.02;
/** A building is redeveloped once its target is this much taller, and torn down once it is this much smaller. */
const REDEVELOP_RATIO = 1.3;
const DEMOLISH_RATIO = 0.4;
/** Floor space (FAR) below which a lot stays open, before the per-lot jitter. */
const MIN_FAR = 0.05;
const MAX_FLOORS = 60;
/** A standing building survives until S drops below this share of its lot's threshold. */
const KEEP_SHARE = 0.6;

export class LotModel {
  /** Floors of the building on each lot; 0 is an empty lot. */
  readonly floors = new Uint8Array(LOTS);
  /** 1 if the building is mainly jobs, 0 if mainly homes. */
  readonly commercial = new Uint8Array(LOTS);
  /** Static per-lot shape: footprint width and depth as a share of the lot, and its offset inside the lot. */
  readonly width = new Float32Array(LOTS);
  readonly depth = new Float32Array(LOTS);
  readonly offsetX = new Float32Array(LOTS);
  readonly offsetY = new Float32Array(LOTS);
  /** Static per-lot random numbers: development threshold, type dither, height jitter, colour shade. */
  readonly threshold = new Float32Array(LOTS);
  readonly dither = new Float32Array(LOTS);
  readonly heightJitter = new Float32Array(LOTS);
  readonly shade = new Float32Array(LOTS);

  private lastMonth = -1;
  private rng: Rng;

  constructor(seed = 0x5eed) {
    const r = mulberry32(seed);
    for (let i = 0; i < LOTS; i++) {
      this.width[i] = 0.5 + 0.38 * r();
      this.depth[i] = 0.5 + 0.38 * r();
      this.offsetX[i] = (r() - 0.5) * (1 - this.width[i]);
      this.offsetY[i] = (r() - 0.5) * (1 - this.depth[i]);
      this.threshold[i] = MIN_FAR * (0.5 + 3 * r());
      this.dither[i] = r();
      this.heightJitter[i] = 0.75 + 0.5 * r();
      this.shade[i] = r();
    }
    this.rng = mulberry32(seed ^ 0x9e3779b9);
  }

  /**
   * Floors a lot should have at floor space S: FAR divided by the footprint's site coverage.
   * A standing building only counts as unwanted once S falls well below the threshold (hysteresis).
   */
  targetFloors(i: number, far: number, standing = false): number {
    if (far < this.threshold[i] * (standing ? KEEP_SHARE : 1)) return 0;
    const coverage = this.width[i] * this.depth[i];
    return Math.max(1, Math.min(MAX_FLOORS, Math.round((far / coverage) * this.heightJitter[i])));
  }

  /**
   * Advance the lots to a new snapshot. When time goes backwards (a new city) or this is the first
   * snapshot, every lot jumps straight to its target.
   */
  update(month: number, floor: Float32Array, mix: Float32Array): void {
    const dm = month - this.lastMonth;
    const instant = this.lastMonth < 0 || dm < 0;
    this.lastMonth = month;
    if (!instant && dm === 0) return;
    const pBuild = 1 - Math.pow(1 - BUILD_RATE, dm);
    const pRedevelop = 1 - Math.pow(1 - REDEVELOP_RATE, dm);
    const pDemolish = 1 - Math.pow(1 - DEMOLISH_RATE, dm);
    const scale = LOT_M / CELL_M; // cells per lot
    const rng = this.rng;

    for (let ly = 0; ly < LN; ly++) {
      // Lot centre in cell coordinates, relative to cell centres.
      let fy = (ly + 0.5) * scale - 0.5;
      fy = Math.min(Math.max(fy, 0), N - 1);
      const y0 = Math.min(fy | 0, N - 2);
      const ty = fy - y0;
      for (let lx = 0; lx < LN; lx++) {
        let fx = (lx + 0.5) * scale - 0.5;
        fx = Math.min(Math.max(fx, 0), N - 1);
        const x0 = Math.min(fx | 0, N - 2);
        const tx = fx - x0;
        const a = y0 * N + x0;
        const far = bilerp(floor, a, tx, ty);
        const i = ly * LN + lx;
        const cur = this.floors[i];
        const target = this.targetFloors(i, far, cur > 0 && !instant);

        let next = cur;
        if (instant) next = target;
        else if (cur === 0) {
          if (target > 0 && rng() < pBuild) next = target;
        } else if (target >= cur * REDEVELOP_RATIO + 1) {
          if (rng() < pRedevelop) next = target;
        } else if (target <= cur * DEMOLISH_RATIO) {
          if (rng() < pDemolish) next = target;
        }
        if (next !== cur || instant) {
          this.floors[i] = next;
          // The type is fixed when a building goes up; dithering keeps the local share of each type right.
          if (next > 0) this.commercial[i] = this.dither[i] < bilerp(mix, a, tx, ty) ? 1 : 0;
        }
      }
    }
  }

  /** Number of standing buildings. */
  count(): number {
    let n = 0;
    for (let i = 0; i < LOTS; i++) if (this.floors[i] > 0) n++;
    return n;
  }

  /** Total built floor space in FAR-lot units, for checks against the model. */
  builtFar(): number {
    let s = 0;
    for (let i = 0; i < LOTS; i++) s += this.floors[i] * this.width[i] * this.depth[i];
    return s;
  }
}

function bilerp(f: Float32Array, a: number, tx: number, ty: number): number {
  return (f[a] * (1 - tx) + f[a + 1] * tx) * (1 - ty) + (f[a + N] * (1 - tx) + f[a + N + 1] * tx) * ty;
}
