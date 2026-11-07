/** Grid geometry: 128 × 128 cells of 100 m, grouped into 16 × 16 travel zones of 8 × 8 cells. */
export const N = 128;
export const CELLS = N * N;
export const CELL_M = 100;
export const CELL_KM = CELL_M / 1000;
export const CELL_M2 = CELL_M * CELL_M;
export const CELL_KM2 = CELL_KM * CELL_KM;

export const ZONE_CELLS = 8;
export const NZ = N / ZONE_CELLS; // 16
export const ZONES = NZ * NZ; // 256
export const ZONE_KM = ZONE_CELLS * CELL_KM; // 0.8

export const idx = (x: number, y: number): number => y * N + x;
export const zidx = (zx: number, zy: number): number => zy * NZ + zx;

/** Zone that contains each cell. */
export const cellZone: Int32Array = (() => {
  const z = new Int32Array(CELLS);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) z[idx(x, y)] = zidx((x / ZONE_CELLS) | 0, (y / ZONE_CELLS) | 0);
  return z;
})();

/** Sum a cell field into zones. */
export function cellsToZones(field: Float32Array, out: Float64Array = new Float64Array(ZONES)): Float64Array {
  out.fill(0);
  for (let i = 0; i < CELLS; i++) out[cellZone[i]] += field[i];
  return out;
}

/**
 * Bilinear interpolation of a zone field (values at zone centres) back to cells.
 * Clamps at the outer half-zone so edges take the nearest centre's value.
 */
export function zonesToCells(zone: ArrayLike<number>, out: Float32Array): Float32Array {
  for (let y = 0; y < N; y++) {
    let fy = (y + 0.5) / ZONE_CELLS - 0.5;
    fy = Math.min(Math.max(fy, 0), NZ - 1);
    const y0 = Math.min(fy | 0, NZ - 2);
    const ty = fy - y0;
    for (let x = 0; x < N; x++) {
      let fx = (x + 0.5) / ZONE_CELLS - 0.5;
      fx = Math.min(Math.max(fx, 0), NZ - 1);
      const x0 = Math.min(fx | 0, NZ - 2);
      const tx = fx - x0;
      const a = zone[zidx(x0, y0)];
      const b = zone[zidx(x0 + 1, y0)];
      const c = zone[zidx(x0, y0 + 1)];
      const d = zone[zidx(x0 + 1, y0 + 1)];
      out[idx(x, y)] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
  }
  return out;
}
