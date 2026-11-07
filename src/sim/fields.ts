import { CELLS, N } from './grid';

/** All per-cell state of the slow layer. Units are documented in params.ts. */
export interface Fields {
  rho: Float32Array; // residents per cell
  jobs: Float32Array; // jobs per cell
  rent: Float32Array; // rent index per unit floor space
  floor: Float32Array; // built floor space (1 = one cell of ground at FAR 1)
  amenity: Float32Array; // static amenity, seeded noise
  land: Float32Array; // 1 on land, 0 on water (see terrain.ts)
}

export function createFields(): Fields {
  return {
    rho: new Float32Array(CELLS),
    jobs: new Float32Array(CELLS),
    rent: new Float32Array(CELLS),
    floor: new Float32Array(CELLS),
    amenity: new Float32Array(CELLS),
    land: new Float32Array(CELLS).fill(1),
  };
}

/**
 * 5-point Laplacian with no-flux (Neumann) boundaries, in cell units.
 * Mirrored edges mean a diffusion step conserves the field's sum. With a mask, cells where the mask is 0
 * (water) are treated like the map edge: nothing diffuses into or out of them.
 */
export function laplacian(f: Float32Array, out: Float32Array, mask?: Float32Array): Float32Array {
  for (let y = 0; y < N; y++) {
    const row = y * N;
    const up = (y > 0 ? y - 1 : y) * N;
    const dn = (y < N - 1 ? y + 1 : y) * N;
    for (let x = 0; x < N; x++) {
      const i = row + x;
      const c = f[i];
      const li = row + (x > 0 ? x - 1 : x);
      const ri = row + (x < N - 1 ? x + 1 : x);
      const ui = up + x;
      const di = dn + x;
      if (!mask) {
        out[i] = f[li] + f[ri] + f[ui] + f[di] - 4 * c;
      } else if (mask[i] === 0) {
        out[i] = 0;
      } else {
        out[i] = (mask[li] ? f[li] - c : 0) + (mask[ri] ? f[ri] - c : 0) + (mask[ui] ? f[ui] - c : 0) + (mask[di] ? f[di] - c : 0);
      }
    }
  }
  return out;
}

/** 1D Gaussian kernel normalised to sum 1, radius 3σ. */
export function gaussianKernel(sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(3 * sigma));
  const k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + r] = v;
    s += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  return k;
}

/** Separable Gaussian blur G_ℓ * f with clamped edges. */
export function gaussianBlur(f: Float32Array, sigma: number, out: Float32Array, tmp: Float32Array = new Float32Array(CELLS)): Float32Array {
  if (sigma <= 0) {
    out.set(f);
    return out;
  }
  const k = gaussianKernel(sigma);
  const r = (k.length - 1) / 2;
  for (let y = 0; y < N; y++) {
    const row = y * N;
    for (let x = 0; x < N; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) {
        const xx = Math.min(N - 1, Math.max(0, x + i));
        s += k[i + r] * f[row + xx];
      }
      tmp[row + x] = s;
    }
  }
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) {
        const yy = Math.min(N - 1, Math.max(0, y + i));
        s += k[i + r] * tmp[yy * N + x];
      }
      out[y * N + x] = s;
    }
  }
  return out;
}

export function sum(f: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < f.length; i++) s += f[i];
  return s;
}

export function assertCells(f: Float32Array): void {
  if (f.length !== CELLS) throw new Error(`field has ${f.length} cells, expected ${CELLS}`);
}
