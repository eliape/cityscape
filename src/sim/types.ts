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
}

export interface Stats {
  month: number;
  population: number;
  jobs: number;
  meanCommute: number; // minutes, trip-weighted
  meanLnA: number; // population-weighted ln A_w
  settlements: number; // nucleation events so far
  travelMs: number; // duration of the last fast-layer solve
}

export const SNAPSHOT_FIELDS = ['floor', 'mix', 'rent', 'lnA', 'pressure', 'crowding', 'commute'] as const;
export type SnapshotField = (typeof SNAPSHOT_FIELDS)[number];
