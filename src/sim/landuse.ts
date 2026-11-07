import { CELL_M, CELL_M2, CELLS, cellsToZones, zonesToCells, ZONES } from './grid';
import { gaussianBlur, laplacian, type Fields } from './fields';
import type { Params } from './params';

/** Scratch buffers reused across steps so a month allocates nothing. */
export interface LandUseScratch {
  lap: Float32Array;
  blur: Float32Array;
  blurTmp: Float32Array;
  bidH: Float32Array;
  bidF: Float32Array;
  zoneRho: Float64Array;
  zoneJobs: Float64Array;
  zoneA: Float64Array;
}

export function createScratch(): LandUseScratch {
  return {
    lap: new Float32Array(CELLS),
    blur: new Float32Array(CELLS),
    blurTmp: new Float32Array(CELLS),
    bidH: new Float32Array(CELLS),
    bidF: new Float32Array(CELLS),
    zoneRho: new Float64Array(ZONES),
    zoneJobs: new Float64Array(ZONES),
    zoneA: new Float64Array(ZONES),
  };
}

/**
 * Logsum accessibility from the cached kernel K_ij = e^{-β c_ij}:
 * A_w(i) = Σ_j J_j K_ij (to jobs, for households), A_f(j) = Σ_i ρ_i K_ij (to workers, for firms).
 * Zone values are interpolated to cells; A is floored at 1 so ln A ≥ 0.
 */
export function accessibility(f: Fields, kernel: Float64Array, s: LandUseScratch, lnAw: Float32Array, lnAf: Float32Array): void {
  cellsToZones(f.rho, s.zoneRho);
  cellsToZones(f.jobs, s.zoneJobs);
  for (let i = 0; i < ZONES; i++) {
    let a = 0;
    const row = i * ZONES;
    for (let j = 0; j < ZONES; j++) a += s.zoneJobs[j] * kernel[row + j];
    s.zoneA[i] = Math.log(Math.max(a, 1));
  }
  zonesToCells(s.zoneA, lnAw);
  for (let j = 0; j < ZONES; j++) {
    let a = 0;
    for (let i = 0; i < ZONES; i++) a += s.zoneRho[i] * kernel[i * ZONES + j];
    s.zoneA[j] = Math.log(Math.max(a, 1));
  }
  zonesToCells(s.zoneA, lnAf);
}

/**
 * City-wide scale terms η ln(Σ J) and η ln(Σ ρ) subtracted from ln A in the bid rents.
 * η = 0 is the plain logsum; η = 1 makes bids depend only on how close the city's jobs (or workers)
 * are, i.e. ln E[e^{-βc}], which bounds the city like a classic open-city model. In between, 1 − η is
 * the return to city scale.
 */
export function scaleTerms(f: Fields, p: Params): [number, number] {
  let r = 0;
  let j = 0;
  for (let i = 0; i < CELLS; i++) {
    r += f.rho[i];
    j += f.jobs[i];
  }
  return [p.scaleNorm * Math.log(Math.max(j, 1)), p.scaleNorm * Math.log(Math.max(r, 1))];
}

/**
 * Labour market: firms bid less when jobs outnumber the workforce (wages rise) and more when labour
 * is plentiful. Returns −θ_L ln(J / (e ρ)), which is added to every firm's bid.
 */
export function labourTerm(f: Fields, p: Params): number {
  let r = 0;
  let j = 0;
  for (let i = 0; i < CELLS; i++) {
    r += f.rho[i];
    j += f.jobs[i];
  }
  if (r < 1 || j < 1) return 0;
  return -p.labourWeight * Math.log(j / (p.employment * r));
}

/**
 * Bid rents B_h = θ_h ln A_w + amenity − ū and B_f = a (G_ℓ * J)^σ + θ_f ln A_f − w̄,
 * with the scale normalisation and labour-market terms above.
 */
export function bidRents(f: Fields, p: Params, lnAw: Float32Array, lnAf: Float32Array, s: LandUseScratch): void {
  // Agglomeration acts on job density (jobs per hectare) smoothed over a range ℓ in metres.
  gaussianBlur(f.jobs, p.agglomRange / CELL_M, s.blur, s.blurTmp);
  const [scaleW, scaleF] = scaleTerms(f, p);
  const labour = labourTerm(f, p);
  for (let i = 0; i < CELLS; i++) {
    s.bidH[i] = p.thetaH * (lnAw[i] - scaleW) + p.amenity + f.amenity[i] + f.terrainAmenity[i] - p.uBar;
    s.bidF[i] = p.agglomA * Math.pow(Math.max(s.blur[i] / CELL_HA, 0), p.agglomSigma) + p.thetaF * (lnAf[i] - scaleF) - p.wBar + labour;
  }
}

/** Floor space a cell's residents and jobs need, as FAR. */
export function floorDemand(rho: number, jobs: number, p: Params): number {
  return (rho * p.floorPerResident + jobs * p.floorPerJob) / CELL_M2;
}

/** Hectares per cell, to express densities per hectare independent of the cell size. */
const CELL_HA = CELL_M2 / 10_000;

/**
 * Supply curve S*(R) = S_max (R/c)^ε / ((R/c)^ε + R₀^ε), where c is the build cost relative to flat dry land:
 * land that costs twice as much to build on needs twice the rent for the same floor space.
 */
export function targetFloor(rent: number, p: Params, cost = 1): number {
  const re = Math.pow(rent / cost, p.epsilon);
  return (p.sMax * re) / (re + Math.pow(p.rent0, p.epsilon));
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * One explicit Euler substep of length dt (months) of
 *   ∂ρ = λ_h ρ (B_h − R) + D_h ∇²ρ
 *   ∂J = λ_f J (B_f − R) + D_f ∇²J
 *   ∂R = κ R (ρ/q_h + J/q_f − S) / S
 *   ∂S = γ (S*(R; c) − S), with c the build cost
 * on land only: water cells hold no one and stay at the agricultural rent and undeveloped floor space.
 * Rent and floor space are updated after ρ and J; all fields are clamped at their floors.
 * Bid rents must be current in `s` (see bidRents). Nucleation sources are applied separately.
 */
export function slowSubstep(f: Fields, p: Params, s: LandUseScratch, dt: number): void {
  const { rho, jobs, rent, floor, land } = f;
  const m = p.maxRate;
  // Diffusion coefficients are in m²/month; the Laplacian is in cell units.
  const dH = p.diffH / CELL_M2;
  const dF = p.diffF / CELL_M2;

  laplacian(rho, s.lap, land);
  for (let i = 0; i < CELLS; i++) {
    const g = clamp(p.lambdaH * (s.bidH[i] - rent[i]), -m, m);
    rho[i] = land[i] * Math.max(0, rho[i] + dt * (g * rho[i] + dH * s.lap[i]));
  }
  laplacian(jobs, s.lap, land);
  for (let i = 0; i < CELLS; i++) {
    const g = clamp(p.lambdaF * (s.bidF[i] - rent[i]), -m, m);
    jobs[i] = land[i] * Math.max(0, jobs[i] + dt * (g * jobs[i] + dF * s.lap[i]));
  }
  for (let i = 0; i < CELLS; i++) {
    // Water is never built on.
    if (land[i] === 0) {
      rent[i] = p.rentFloor;
      floor[i] = p.floorMin;
      continue;
    }
    const S = floor[i];
    const demand = floorDemand(rho[i], jobs[i], p);
    const g = clamp((p.kappa * (demand - S)) / S, -m, m);
    rent[i] = Math.max(p.rentFloor, rent[i] * (1 + dt * g));
    const target = targetFloor(rent[i], p, f.buildCost[i]);
    const rate = target > S ? p.gamma : p.demolition;
    floor[i] = Math.max(p.floorMin, S + dt * rate * (target - S));
  }
}
