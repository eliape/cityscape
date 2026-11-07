import { CELL_KM2, CELL_M, CELLS, N, cellsToZones, idx, zonesToCells, ZONES } from './grid';
import { createFields, gaussianBlur, type Fields } from './fields';
import { accessibility, bidRents, createScratch, floorDemand, slowSubstep, type LandUseScratch } from './landuse';
import { buildNetwork, type Network } from './network';
import { nucleate } from './nucleation';
import { defaultParams, paramMeta, type ParamName, type Params } from './params';
import { gaussian, mulberry32, type Rng } from './rng';
import { solveTravel, type TravelResult } from './travel';
import type { Snapshot, Stats } from './types';

/** Correlation length of the amenity noise, m. */
const AMENITY_SCALE_M = 600;
/** Seed village: Gaussian radius (m), peak densities per km², and the spread of its offset from the centre (m). */
const VILLAGE_RADIUS_M = 250;
const VILLAGE_RESIDENTS_KM2 = 25_000;
const VILLAGE_JOBS_KM2 = 16_000;
const VILLAGE_OFFSET_M = 800;

/**
 * The whole model: owns all state and advances it one month at a time.
 * Pure TypeScript with no DOM access, so it runs in the worker, in tests and headless.
 */
export class Simulation {
  params: Params;
  seed: number;
  month = 0;
  fields: Fields = createFields();
  lnAw = new Float32Array(CELLS);
  lnAf = new Float32Array(CELLS);
  travel!: TravelResult;
  settlements = 0;
  travelMs = 0;

  private net!: Network;
  private rng!: Rng;
  private scratch: LandUseScratch = createScratch();
  private commuteCells = new Float32Array(CELLS);
  private travelDirty = true;
  private networkDirty = true;

  constructor(seed = 1, params: Partial<Params> = {}) {
    this.params = { ...defaultParams, ...params };
    this.seed = seed;
    this.reset(seed);
  }

  /** Start over from a seed village. Same seed and params give the same city. */
  reset(seed = this.seed): void {
    const p = this.params;
    this.seed = seed;
    this.month = 0;
    this.settlements = 0;
    this.rng = mulberry32(seed);
    this.fields = createFields();
    const f = this.fields;

    // Amenity: smooth seeded noise so the city is not perfectly symmetric.
    const noise = new Float32Array(CELLS);
    for (let i = 0; i < CELLS; i++) noise[i] = gaussian(this.rng);
    gaussianBlur(noise, AMENITY_SCALE_M / CELL_M, f.amenity);
    let sd = 0;
    for (let i = 0; i < CELLS; i++) sd += f.amenity[i] * f.amenity[i];
    sd = Math.sqrt(sd / CELLS) || 1;
    for (let i = 0; i < CELLS; i++) f.amenity[i] *= p.amenityNoise / sd;

    // Seed village near the centre.
    const off = VILLAGE_OFFSET_M / CELL_M;
    const cx = N / 2 + (this.rng() - 0.5) * off;
    const cy = N / 2 + (this.rng() - 0.5) * off;
    const rad = VILLAGE_RADIUS_M / CELL_M;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = idx(x, y);
        const r2 = ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) / (rad * rad);
        const w = r2 < 9 ? Math.exp(-r2) : 0;
        f.rho[i] = VILLAGE_RESIDENTS_KM2 * CELL_KM2 * w;
        f.jobs[i] = VILLAGE_JOBS_KM2 * CELL_KM2 * w;
        f.floor[i] = Math.max(p.floorMin, floorDemand(f.rho[i], f.jobs[i], p));
        f.rent[i] = p.rentFloor;
      }
    }
    this.networkDirty = true;
    this.travelDirty = true;
    this.solveTravelNow();
    // Start the village at its bid rents, so it neither booms nor collapses in the first months.
    accessibility(f, this.travel.kernel, this.scratch, this.lnAw, this.lnAf);
    bidRents(f, p, this.lnAw, this.lnAf, this.scratch);
    for (let i = 0; i < CELLS; i++) {
      if (f.rho[i] + f.jobs[i] < 1) continue;
      f.rent[i] = Math.max(p.rentFloor, Math.min(this.scratch.bidH[i], invertSupply(f.floor[i], p)));
    }
  }

  setParam(name: ParamName, value: number): void {
    this.params[name] = value;
    if (paramMeta[name].travel) {
      this.travelDirty = true;
      this.networkDirty = true;
    }
  }

  /** Re-solve the fast layer now (after the network or a travel parameter changes). */
  solveTravelNow(): void {
    const t0 = performance.now();
    if (this.networkDirty) this.net = buildNetwork(this.params);
    this.networkDirty = false;
    const p = this.params;
    const zRho = cellsToZones(this.fields.rho);
    const zJobs = cellsToZones(this.fields.jobs);
    const origins = new Float64Array(ZONES);
    for (let i = 0; i < ZONES; i++) origins[i] = zRho[i] * p.peakShare;
    this.travel = solveTravel(this.net, origins, zJobs, p);
    zonesToCells(this.travel.zoneCommute, this.commuteCells);
    this.travelDirty = false;
    this.travelMs = performance.now() - t0;
  }

  /** Advance one month. */
  step(): void {
    const p = this.params;
    if (this.travelDirty || (this.month > 0 && this.month % Math.max(1, Math.round(p.travelInterval)) === 0)) this.solveTravelNow();
    const n = Math.max(1, Math.round(p.substeps));
    const dt = 1 / n;
    for (let k = 0; k < n; k++) {
      accessibility(this.fields, this.travel.kernel, this.scratch, this.lnAw, this.lnAf);
      bidRents(this.fields, p, this.lnAw, this.lnAf, this.scratch);
      slowSubstep(this.fields, p, this.scratch, dt);
    }
    this.settlements += nucleate(this.fields, p, this.scratch.bidH, this.rng);
    this.month++;
    accessibility(this.fields, this.travel.kernel, this.scratch, this.lnAw, this.lnAf);
    bidRents(this.fields, p, this.lnAw, this.lnAf, this.scratch);
  }

  /** Recompute travel (if a travel parameter changed), accessibility and bids without advancing time. */
  refresh(): void {
    if (this.travelDirty) this.solveTravelNow();
    accessibility(this.fields, this.travel.kernel, this.scratch, this.lnAw, this.lnAf);
    bidRents(this.fields, this.params, this.lnAw, this.lnAf, this.scratch);
  }

  run(months: number): void {
    for (let m = 0; m < months; m++) this.step();
  }

  stats(): Stats {
    const { rho, jobs } = this.fields;
    let pop = 0;
    let nj = 0;
    let wl = 0;
    for (let i = 0; i < CELLS; i++) {
      pop += rho[i];
      nj += jobs[i];
      wl += rho[i] * this.lnAw[i];
    }
    return {
      month: this.month,
      population: pop,
      jobs: nj,
      meanCommute: this.travel.meanCommute,
      meanLnA: pop > 0 ? wl / pop : 0,
      settlements: this.settlements,
      travelMs: this.travelMs,
    };
  }

  /** Fresh arrays, safe to transfer to another thread. */
  snapshot(): Snapshot {
    const p = this.params;
    const { rho, jobs, rent, floor } = this.fields;
    const s = this.scratch;
    const mix = new Float32Array(CELLS);
    const pressure = new Float32Array(CELLS);
    const crowding = new Float32Array(CELLS);
    for (let i = 0; i < CELLS; i++) {
      const tot = rho[i] + jobs[i];
      mix[i] = tot > 1e-6 ? jobs[i] / tot : 0.5;
      pressure[i] = Math.max(s.bidH[i], s.bidF[i]) - rent[i];
      // Undeveloped, empty land is neither crowded nor under-used: show it as balanced.
      crowding[i] = tot < 1 && floor[i] <= p.floorMin * 1.01 ? 1 : floorDemand(rho[i], jobs[i], p) / floor[i];
    }
    return {
      month: this.month,
      floor: floor.slice(),
      mix,
      rent: rent.slice(),
      lnA: this.lnAw.slice(),
      pressure,
      crowding,
      commute: this.commuteCells.slice(),
    };
  }
}

/** Rent at which S*(R) equals S (inverse of the supply curve), for consistent initial conditions. */
export function invertSupply(S: number, p: Params): number {
  const s = Math.min(S / p.sMax, 0.999);
  if (s <= 0) return 0;
  return p.rent0 * Math.pow(s / (1 - s), 1 / p.epsilon);
}

