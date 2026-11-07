/**
 * Model parameters. Units:
 *  - time: one slow step = one month; travel costs in minutes
 *  - rho, jobs: persons per 100 m cell
 *  - floor space S: multiples of one cell's ground area (S = 1 is FAR 1, 10,000 m²)
 *  - rent R and bid rents B: a dimensionless rent index (≈ 1 for a small town centre)
 */
export interface Params {
  // ── Fast layer: travel ──
  beta: number; // cost sensitivity, 1/min
  walkSpeed: number; // km/h
  streetSpeed: number; // free-flow street speed v0, km/h
  streetAccess: number; // minutes to get on and off the street (parking, waiting)
  streetCapacity: number; // pax/h per zone link and direction
  bprAlpha: number;
  bprPower: number;
  peakShare: number; // share of residents travelling in the peak hour
  fwIterations: number; // Frank–Wolfe iterations
  // ── Slow layer: households ──
  scaleNorm: number; // η: share of ln(city size) removed from ln A in bids (0 = plain logsum)
  thetaH: number; // weight of ln A_w in household bid rent
  amenity: number; // uniform amenity level
  amenityNoise: number; // std. dev. of seeded amenity noise
  uBar: number; // utility outside the city
  lambdaH: number; // relocation speed of households, 1/month per unit B−R
  diffH: number; // household diffusion, cells²/month
  qH: number; // residents per unit floor space
  // ── Slow layer: firms ──
  agglomA: number; // agglomeration strength a
  agglomSigma: number; // agglomeration exponent σ
  agglomRange: number; // agglomeration range ℓ, cells
  thetaF: number; // weight of ln A_f in firm bid rent
  wBar: number; // outside wage / reservation level
  employment: number; // jobs per resident at labour-market balance
  labourWeight: number; // θ_L: how strongly firm bids react to labour shortage
  lambdaF: number;
  diffF: number;
  qF: number; // jobs per unit floor space
  // ── Land market ──
  kappa: number; // rent adjustment speed, 1/month
  gamma: number; // construction speed, 1/month
  demolition: number; // demolition speed when S > S*, 1/month
  sMax: number; // maximum floor space (FAR)
  rent0: number; // rent at which S* is half of S_max
  epsilon: number; // supply elasticity
  rentFloor: number; // agricultural rent
  floorMin: number; // floor space of undeveloped land
  maxRate: number; // cap on relative change per month (numerical guard)
  // ── Nucleation ──
  nu0: number; // base settlement rate per empty cell per month
  mu: number; // sensitivity to B − R
  seedResidents: number;
  seedJobs: number;
  // ── Run ──
  substeps: number; // Euler substeps per month
  travelInterval: number; // months between fast-layer solves
}

export const defaultParams: Params = {
  beta: 0.15,
  walkSpeed: 4.5,
  streetSpeed: 20,
  streetAccess: 4,
  streetCapacity: 2500,
  bprAlpha: 0.6,
  bprPower: 4,
  peakShare: 0.12,
  fwIterations: 10,

  scaleNorm: 1,
  thetaH: 0.5,
  amenity: 0,
  amenityNoise: 0.15,
  uBar: -1.8,
  lambdaH: 0.08,
  diffH: 0.06,
  qH: 180,

  agglomA: 0.1,
  agglomSigma: 0.35,
  agglomRange: 4,
  thetaF: 0.4,
  wBar: -1.0,
  employment: 0.5,
  labourWeight: 1,
  lambdaF: 0.08,
  diffF: 0.04,
  qF: 320,

  kappa: 0.02,
  gamma: 0.03,
  demolition: 0.004,
  sMax: 10,
  rent0: 2.5,
  epsilon: 2,
  rentFloor: 0.05,
  floorMin: 0.01,
  maxRate: 0.1,

  nu0: 2e-6,
  mu: 2,
  seedResidents: 60,
  seedJobs: 25,

  substeps: 2,
  travelInterval: 12,
};

export type ParamName = keyof Params;

export interface ParamMeta {
  group: 'Travel' | 'Households' | 'Firms' | 'Land market' | 'Nucleation' | 'Run';
  min: number;
  max: number;
  step: number;
  label: string;
  /** Changing it invalidates the travel equilibrium. */
  travel?: boolean;
}

export const paramMeta: Record<ParamName, ParamMeta> = {
  beta: { group: 'Travel', min: 0.01, max: 0.3, step: 0.005, label: 'β cost sensitivity (1/min)', travel: true },
  walkSpeed: { group: 'Travel', min: 2, max: 8, step: 0.1, label: 'Walk speed (km/h)', travel: true },
  streetSpeed: { group: 'Travel', min: 5, max: 60, step: 1, label: 'Street speed v₀ (km/h)', travel: true },
  streetAccess: { group: 'Travel', min: 0, max: 20, step: 0.5, label: 'Street access (min)', travel: true },
  streetCapacity: { group: 'Travel', min: 200, max: 10000, step: 100, label: 'Street capacity (pax/h)', travel: true },
  bprAlpha: { group: 'Travel', min: 0, max: 2, step: 0.05, label: 'BPR α', travel: true },
  bprPower: { group: 'Travel', min: 1, max: 8, step: 0.5, label: 'BPR k', travel: true },
  peakShare: { group: 'Travel', min: 0.01, max: 0.5, step: 0.01, label: 'Peak-hour share', travel: true },
  fwIterations: { group: 'Travel', min: 1, max: 40, step: 1, label: 'Frank–Wolfe iterations', travel: true },

  scaleNorm: { group: 'Households', min: 0, max: 1, step: 0.01, label: 'η scale normalisation' },
  thetaH: { group: 'Households', min: 0, max: 2, step: 0.01, label: 'θ_h access weight' },
  amenity: { group: 'Households', min: -2, max: 2, step: 0.05, label: 'Amenity' },
  amenityNoise: { group: 'Households', min: 0, max: 1, step: 0.01, label: 'Amenity noise (on reset)' },
  uBar: { group: 'Households', min: -5, max: 5, step: 0.05, label: 'ū outside utility' },
  lambdaH: { group: 'Households', min: 0, max: 0.5, step: 0.005, label: 'λ_h relocation speed' },
  diffH: { group: 'Households', min: 0, max: 0.24, step: 0.005, label: 'D_h diffusion' },
  qH: { group: 'Households', min: 20, max: 600, step: 5, label: 'q_h residents / floor' },

  agglomA: { group: 'Firms', min: 0, max: 1, step: 0.01, label: 'a agglomeration' },
  agglomSigma: { group: 'Firms', min: 0, max: 1, step: 0.01, label: 'σ agglomeration exp.' },
  agglomRange: { group: 'Firms', min: 0, max: 16, step: 0.5, label: 'ℓ range (cells)' },
  thetaF: { group: 'Firms', min: 0, max: 2, step: 0.01, label: 'θ_f access weight' },
  wBar: { group: 'Firms', min: -5, max: 5, step: 0.05, label: 'w̄ outside wage' },
  employment: { group: 'Firms', min: 0.1, max: 1, step: 0.01, label: 'Jobs per resident' },
  labourWeight: { group: 'Firms', min: 0, max: 5, step: 0.05, label: 'θ_L labour-market weight' },
  lambdaF: { group: 'Firms', min: 0, max: 0.5, step: 0.005, label: 'λ_f relocation speed' },
  diffF: { group: 'Firms', min: 0, max: 0.24, step: 0.005, label: 'D_f diffusion' },
  qF: { group: 'Firms', min: 20, max: 1000, step: 5, label: 'q_f jobs / floor' },

  kappa: { group: 'Land market', min: 0, max: 0.3, step: 0.005, label: 'κ rent speed' },
  gamma: { group: 'Land market', min: 0, max: 0.3, step: 0.005, label: 'γ construction speed' },
  demolition: { group: 'Land market', min: 0, max: 0.1, step: 0.001, label: 'Demolition speed' },
  sMax: { group: 'Land market', min: 1, max: 30, step: 0.5, label: 'S_max (FAR)' },
  rent0: { group: 'Land market', min: 0.1, max: 10, step: 0.1, label: 'R₀ half-supply rent' },
  epsilon: { group: 'Land market', min: 0.5, max: 6, step: 0.1, label: 'ε supply elasticity' },
  rentFloor: { group: 'Land market', min: 0.001, max: 1, step: 0.001, label: 'Agricultural rent' },
  floorMin: { group: 'Land market', min: 0.001, max: 0.2, step: 0.001, label: 'Undeveloped floor space' },
  maxRate: { group: 'Land market', min: 0.05, max: 1, step: 0.05, label: 'Max relative rate' },

  nu0: { group: 'Nucleation', min: 0, max: 1e-4, step: 1e-7, label: 'ν₀ base rate' },
  mu: { group: 'Nucleation', min: 0, max: 6, step: 0.1, label: 'μ sensitivity' },
  seedResidents: { group: 'Nucleation', min: 0, max: 500, step: 5, label: 'Seed residents' },
  seedJobs: { group: 'Nucleation', min: 0, max: 500, step: 5, label: 'Seed jobs' },

  substeps: { group: 'Run', min: 1, max: 8, step: 1, label: 'Euler substeps' },
  travelInterval: { group: 'Run', min: 1, max: 60, step: 1, label: 'Months between travel solves' },
};
