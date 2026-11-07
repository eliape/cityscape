import { CELL_KM2, CELL_M, CELLS, N, cellsToZones, idx, zonesToCells, ZONES } from './grid';
import { createFields, gaussianBlur, type Fields } from './fields';
import { accessibility, bidRents, createScratch, floorDemand, slowSubstep, type LandUseScratch } from './landuse';
import { ArcKind, buildNetwork, type Network } from './network';
import { validateLine, type MetroLine, type MetroLineInput } from './metro';
import { nucleate } from './nucleation';
import { defaultParams, paramMeta, type ParamName, type Params } from './params';
import { gaussian, mulberry32, type Rng } from './rng';
import { generateTerrain, landRegions, waterDistance, type Terrain } from './terrain';
import { solveTravel, type TravelResult } from './travel';
import type { NetworkView, Snapshot, Stats } from './types';

/** Correlation length of the amenity noise, m. */
const AMENITY_SCALE_M = 600;
/** Seed village: Gaussian radius (m), peak densities per km², and the spread of its offset from the centre (m). */
const VILLAGE_RADIUS_M = 250;
const VILLAGE_RESIDENTS_KM2 = 25_000;
const VILLAGE_JOBS_KM2 = 16_000;
const VILLAGE_OFFSET_M = 800;
/** The village centre keeps at least this much land around it where it can, m. */
const VILLAGE_SHORE_M = 400;

/**
 * The whole model: owns all state and advances it one month at a time.
 * Pure TypeScript with no DOM access, so it runs in the worker, in tests and headless.
 */
export class Simulation {
  params: Params;
  seed: number;
  month = 0;
  fields: Fields = createFields();
  terrain!: Terrain;
  lnAw = new Float32Array(CELLS);
  lnAf = new Float32Array(CELLS);
  travel!: TravelResult;
  settlements = 0;
  travelMs = 0;
  /** Built metro lines. */
  lines: MetroLine[] = [];
  /** Counts fast-layer solves, so callers can tell when line loads changed. */
  solves = 0;
  private nextLineId = 1;

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
    // A new map: lines drawn on the old one no longer fit.
    this.lines = [];
    this.rng = mulberry32(seed);
    this.fields = createFields();
    const f = this.fields;
    this.terrain = generateTerrain(seed, p);
    f.land.set(this.terrain.land);

    // Amenity: smooth seeded noise so the city is not perfectly symmetric.
    const noise = new Float32Array(CELLS);
    for (let i = 0; i < CELLS; i++) noise[i] = gaussian(this.rng);
    gaussianBlur(noise, AMENITY_SCALE_M / CELL_M, f.amenity);
    let sd = 0;
    for (let i = 0; i < CELLS; i++) sd += f.amenity[i] * f.amenity[i];
    sd = Math.sqrt(sd / CELLS) || 1;
    for (let i = 0; i < CELLS; i++) f.amenity[i] *= p.amenityNoise / sd;

    // Seed village near the centre, on land.
    const off = VILLAGE_OFFSET_M / CELL_M;
    const [cx, cy] = this.villageSite(N / 2 + (this.rng() - 0.5) * off, N / 2 + (this.rng() - 0.5) * off);
    const rad = VILLAGE_RADIUS_M / CELL_M;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = idx(x, y);
        const r2 = ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) / (rad * rad);
        const w = r2 < 9 ? f.land[i] * Math.exp(-r2) : 0;
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

  /**
   * The land cell nearest to (x, y) on the largest landmass, preferring cells at least VILLAGE_SHORE_M
   * from water. Returns cell-centre coordinates; (x, y) itself when there is no water at all.
   */
  private villageSite(x: number, y: number): [number, number] {
    const { water } = this.terrain;
    const { label, sizes } = landRegions(water);
    if (sizes.length === 0) return [x, y];
    const main = sizes.indexOf(Math.max(...sizes));
    const dist = waterDistance(water);
    const shore = Math.round(VILLAGE_SHORE_M / CELL_M);
    let best = -1;
    let bestD = Infinity;
    let bestInland = false;
    for (let i = 0; i < CELLS; i++) {
      if (label[i] !== main) continue;
      const inland = dist[i] >= shore;
      const d = (i % N + 0.5 - x) ** 2 + (((i / N) | 0) + 0.5 - y) ** 2;
      if ((inland && !bestInland) || (inland === bestInland && d < bestD)) {
        best = i;
        bestD = d;
        bestInland = inland;
      }
    }
    const here = idx(Math.floor(x), Math.floor(y));
    if (label[here] === main && dist[here] >= shore) return [x, y];
    return [(best % N) + 0.5, ((best / N) | 0) + 0.5];
  }

  setParam(name: ParamName, value: number): void {
    this.params[name] = value;
    if (paramMeta[name].travel) {
      this.travelDirty = true;
      this.networkDirty = true;
    }
  }

  /** Build a metro line and re-solve the fast layer. Throws with the reason when the line is invalid. */
  addLine(input: MetroLineInput): number {
    const line: MetroLine = { id: this.nextLineId++, path: [...input.path], stations: [...input.stations] };
    const err = validateLine(line, this.terrain.water);
    if (err) throw new Error(err);
    this.lines.push(line);
    this.networkDirty = true;
    this.solveTravelNow();
    return line.id;
  }

  removeLine(id: number): void {
    const n = this.lines.length;
    this.lines = this.lines.filter((l) => l.id !== id);
    if (this.lines.length === n) return;
    this.networkDirty = true;
    this.solveTravelNow();
  }

  /** Re-solve the fast layer now (after the network or a travel parameter changes). */
  solveTravelNow(): void {
    const t0 = performance.now();
    if (this.networkDirty) this.net = buildNetwork(this.params, this.lines);
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
    this.solves++;
  }

  /** Lines and their loads from the last solve. */
  networkView(): NetworkView {
    const { net, travel } = this;
    const lines = this.lines.map((l) => ({
      id: l.id,
      path: [...l.path],
      stations: [...l.stations],
      load: Array.from({ length: l.stations.length - 1 }, () => [0, 0] as [number, number]),
      capacity: this.params.metroCapacity,
      boardings: 0,
    }));
    for (let a = 0; a < net.arcs; a++) {
      const l = net.arcLine[a];
      if (l >= 0) lines[l].load[net.arcSeg[a]][net.arcDir[a]] = travel.flow[a];
    }
    // Boardings: the line of a board or transfer arc is the line of the platform it leads to.
    const lineOfNode = new Int32Array(net.nodes).fill(-1);
    for (let a = 0; a < net.arcs; a++) if (net.arcLine[a] >= 0) lineOfNode[net.from[a]] = net.arcLine[a];
    for (let a = 0; a < net.arcs; a++) {
      const k = net.kind[a];
      if (k !== ArcKind.Board && k !== ArcKind.Transfer) continue;
      const l = lineOfNode[net.to[a]];
      if (l >= 0) lines[l].boardings += travel.flow[a];
    }
    return { lines };
  }

  /** Peak-hour trips that board the metro from the street (transfers not counted twice). */
  private metroRiders(): number {
    const { net, travel } = this;
    let s = 0;
    for (let a = 0; a < net.arcs; a++) if (net.kind[a] === ArcKind.Board) s += travel.flow[a];
    return s;
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
    const riders = this.metroRiders();
    const T = this.travel.trips;
    let interzonal = 0;
    for (let k = 0; k < T.length; k++) if (k % (ZONES + 1) !== 0) interzonal += T[k];
    return {
      month: this.month,
      population: pop,
      jobs: nj,
      meanCommute: this.travel.meanCommute,
      meanLnA: pop > 0 ? wl / pop : 0,
      settlements: this.settlements,
      travelMs: this.travelMs,
      metroRiders: riders,
      metroShare: interzonal > 0 ? riders / interzonal : 0,
    };
  }

  /** Fresh arrays, safe to transfer to another thread. */
  snapshot(): Snapshot {
    const p = this.params;
    const f = this.fields;
    const { rho, jobs, rent, floor } = f;
    const s = this.scratch;
    const mix = new Float32Array(CELLS);
    const pressure = new Float32Array(CELLS);
    const crowding = new Float32Array(CELLS);
    for (let i = 0; i < CELLS; i++) {
      const tot = rho[i] + jobs[i];
      mix[i] = tot > 1e-6 ? jobs[i] / tot : 0.5;
      pressure[i] = f.land[i] ? Math.max(s.bidH[i], s.bidF[i]) - rent[i] : 0;
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

