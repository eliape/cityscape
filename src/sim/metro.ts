import { CELL_M, N, ZONE_CELLS } from './grid';

/**
 * A metro line: an underground rail drawn cell by cell, with stations placed on it.
 * Underground, so the rail ignores water and terrain; stations need dry land for their entrances.
 */
export interface MetroLine {
  id: number;
  /** Cells along the rail, each one 8-adjacent to the next. A rail may cross itself. */
  path: number[];
  /** Station positions as indices into `path`, strictly increasing. */
  stations: number[];
}

/** What the player sends to build a line; the simulation assigns the id. */
export type MetroLineInput = Omit<MetroLine, 'id'>;

/** Length of the step between two 8-adjacent cells, m. */
export function stepLength(a: number, b: number): number {
  const dx = Math.abs((a % N) - (b % N));
  const dy = Math.abs(((a / N) | 0) - ((b / N) | 0));
  return dx + dy === 2 ? CELL_M * Math.SQRT2 : CELL_M;
}

/** Rail length between two positions on a path, m. */
export function pathLength(path: readonly number[], from = 0, to = path.length - 1): number {
  let m = 0;
  for (let k = from; k < to; k++) m += stepLength(path[k], path[k + 1]);
  return m;
}

/**
 * The cells of a straight 8-connected rail from cell a to cell b (both included):
 * diagonal steps first along the shared part, spread evenly, like Bresenham.
 */
export function railBetween(a: number, b: number): number[] {
  let x0 = a % N;
  let y0 = (a / N) | 0;
  const x1 = b % N;
  const y1 = (b / N) | 0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const out = [a];
  while (x0 !== x1 || y0 !== y1) {
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
    out.push(y0 * N + x0);
  }
  return out;
}

/** Join clicked rail points into one continuous path. */
export function railThrough(points: readonly number[]): number[] {
  if (points.length === 0) return [];
  const path = [points[0]];
  for (let k = 1; k < points.length; k++) {
    if (points[k] === points[k - 1]) continue;
    path.push(...railBetween(points[k - 1], points[k]).slice(1));
  }
  return path;
}

/** Why a line cannot be built, or null when it can. */
export function validateLine(line: MetroLineInput, water: Uint8Array): string | null {
  const { path, stations } = line;
  if (path.length < 2) return 'The rail needs at least two cells';
  for (const c of path) if (!Number.isInteger(c) || c < 0 || c >= N * N) return 'The rail leaves the map';
  for (let k = 1; k < path.length; k++) {
    const dx = Math.abs((path[k] % N) - (path[k - 1] % N));
    const dy = Math.abs(((path[k] / N) | 0) - ((path[k - 1] / N) | 0));
    if (dx > 1 || dy > 1 || dx + dy === 0) return 'The rail must be continuous';
  }
  if (stations.length < 2) return 'Place at least two stations';
  for (let s = 0; s < stations.length; s++) {
    const k = stations[s];
    if (!Number.isInteger(k) || k < 0 || k >= path.length) return 'Stations must be on the rail';
    if (s > 0 && k <= stations[s - 1]) return 'Stations must be in order along the rail';
    if (water[path[k]]) return 'A station needs land for its entrance';
  }
  return null;
}

/** Cell coordinates of a station's position, in zone units (zone centres at 0.5, 1.5, …). */
export function cellInZones(cell: number): [number, number] {
  return [((cell % N) + 0.5) / ZONE_CELLS, (((cell / N) | 0) + 0.5) / ZONE_CELLS];
}
