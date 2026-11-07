/** The only data that crosses from the worker to the main thread. */
export interface Snapshot {
  month: number;
  floor: Float32Array; // S
  mix: Float32Array; // job share J / (ρ + J)
  rent: Float32Array; // R
  lnA: Float32Array; // ln A_w
  pressure: Float32Array; // B − R, with B = max(B_h, B_f)
  crowding: Float32Array; // floor-space demand / S
  commute: Float32Array; // mean generalised cost from each cell, minutes
  buildCost: Float32Array; // construction cost relative to flat dry land (water: unbuildable)
  amenity: Float32Array; // household amenity: seeded noise plus water and views
  output: Float32Array; // economic output density, $M per km² per year
}

/** Static geography for the renderer, sent once per new map. */
export interface TerrainView {
  surface: Float32Array; // m above sea level: water surface on water, ground elsewhere
  water: Uint8Array; // 1 on water
}

export interface Stats {
  month: number;
  population: number;
  jobs: number;
  meanCommute: number; // minutes, trip-weighted
  meanLnA: number; // population-weighted ln A_w
  output: number; // economic output of all jobs, $ per year (see output.ts)
  settlements: number; // nucleation events so far
  travelMs: number; // duration of the last fast-layer solve
}

export const SNAPSHOT_FIELDS = ['floor', 'mix', 'rent', 'lnA', 'pressure', 'crowding', 'commute', 'buildCost', 'amenity', 'output'] as const;
export type SnapshotField = (typeof SNAPSHOT_FIELDS)[number];
