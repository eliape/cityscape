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
  settlements: number; // nucleation events so far
  travelMs: number; // duration of the last fast-layer solve
  metroRiders: number; // peak-hour trips that use the metro
  metroShare: number; // share of peak-hour trips between zones that use the metro
}

/** Built metro lines with their peak-hour loads, sent after each fast-layer solve. */
export interface NetworkView {
  lines: LineView[];
}

export interface LineView {
  id: number;
  path: number[];
  stations: number[]; // indices into path
  /** Peak-hour passengers per segment (station k → k+1) in each direction: [along, against]. */
  load: [number, number][];
  capacity: number; // pax/h per direction
  boardings: number; // peak-hour boardings at all stations
}

export const SNAPSHOT_FIELDS = ['floor', 'mix', 'rent', 'lnA', 'pressure', 'crowding', 'commute', 'buildCost', 'amenity'] as const;
export type SnapshotField = (typeof SNAPSHOT_FIELDS)[number];
