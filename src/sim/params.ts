/**
 * Model parameters, all in physical units so they do not depend on the grid's cell size.
 *  - time: one slow step = one month; travel costs in minutes
 *  - lengths in metres, areas in m², rates per km²
 *  - floor space S: floor area ratio (FAR) of each cell
 *  - rent R and bid rents B: a dimensionless rent index (≈ 1 for a small town centre)
 * Internally ρ and J are stored as persons per cell; see grid.ts for the cell size.
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
  // ── Transit: metro ──
  metroSpeed: number; // average running speed between stations, km/h
  metroCapacity: number; // pax/h per direction
  metroHeadway: number; // minutes between trains; boarding waits half of it
  metroAccess: number; // minutes from street to platform and back (stairs, escalators)
  metroCatchment: number; // zones whose centre is within this distance of a station can walk to it, m
  transferPenalty: number; // minutes added to each change between lines
  // ── Slow layer: households ──
  scaleNorm: number; // η: share of ln(city size) removed from ln A in bids (0 = plain logsum)
  thetaH: number; // weight of ln A_w in household bid rent
  amenity: number; // uniform amenity level
  amenityNoise: number; // std. dev. of seeded amenity noise
  uBar: number; // utility outside the city
  lambdaH: number; // relocation speed of households, 1/month per unit B−R
  diffH: number; // household diffusion, m²/month
  floorPerResident: number; // m² of floor space per resident
  // ── Slow layer: firms ──
  agglomA: number; // agglomeration strength a
  agglomSigma: number; // agglomeration exponent σ
  agglomRange: number; // agglomeration range ℓ, m (density measured in jobs per hectare)
  thetaF: number; // weight of ln A_f in firm bid rent
  wBar: number; // outside wage / reservation level
  employment: number; // jobs per resident at labour-market balance
  labourWeight: number; // θ_L: how strongly firm bids react to labour shortage
  lambdaF: number;
  diffF: number; // firm diffusion, m²/month
  floorPerJob: number; // m² of floor space per job
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
  nu0: number; // base settlement rate per km² of empty land per month
  mu: number; // sensitivity to B − R
  seedResidents: number; // people in a new settlement
  seedJobs: number; // jobs in a new settlement
  // ── Terrain (applied on reset) ──
  landShare: number; // share of the map above sea level, before lakes and rivers
  featureSize: number; // wavelength of the largest landforms, m: small = many islands, large = one landmass
  coastRoughness: number; // gain per noise octave: higher = more ragged coasts and more small islands
  mainland: number; // tilt towards a random side: 0 = no preferred side, 1 = a continent on one side
  relief: number; // height of the highest point, m
  rivers: number; // number of rivers traced from the largest catchments
  riverWidth: number; // river width at the mouth, m
  lakeDepth: number; // depressions at least this deep become lakes, m
  // ── Terrain effects (live) ──
  slopeFree: number; // grade below which slope adds no build cost, %
  slopeCost: number; // extra build cost per % grade above slopeFree, as a share of flat-land cost
  slopeMax: number; // grade above which land is unbuildable, %
  wetlandHeight: number; // land less than this high above nearby water is (partly) wetland, m
  wetlandReach: number; // wetland only within this distance of water, m
  wetlandCost: number; // extra build cost on full wetland, as a share of flat-land cost
  waterfrontAmenity: number; // household amenity at the water's edge, bid-rent units
  waterfrontRange: number; // decay length of the waterfront amenity, m
  viewAmenity: number; // household amenity per 10 m of height above the surroundings, bid-rent units
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

  metroSpeed: 35,
  metroCapacity: 30_000,
  metroHeadway: 3,
  metroAccess: 1,
  metroCatchment: 800,
  transferPenalty: 4,

  scaleNorm: 1,
  thetaH: 0.5,
  amenity: 0,
  amenityNoise: 0.15,
  uBar: -1.8,
  lambdaH: 0.08,
  diffH: 600,
  floorPerResident: 55.5,

  agglomA: 0.1,
  agglomSigma: 0.35,
  agglomRange: 400,
  thetaF: 0.4,
  wBar: -1.0,
  employment: 0.5,
  labourWeight: 1,
  lambdaF: 0.08,
  diffF: 400,
  floorPerJob: 31.25,

  kappa: 0.02,
  gamma: 0.03,
  demolition: 0.004,
  sMax: 10,
  rent0: 2.5,
  epsilon: 2,
  rentFloor: 0.05,
  floorMin: 0.01,
  maxRate: 0.1,

  nu0: 2e-4,
  mu: 2,
  seedResidents: 60,
  seedJobs: 25,

  landShare: 0.75,
  featureSize: 5000,
  coastRoughness: 0.5,
  mainland: 0.6,
  relief: 120,
  rivers: 2,
  riverWidth: 300,
  lakeDepth: 10,

  slopeFree: 2,
  slopeCost: 0.15,
  slopeMax: 15,
  wetlandHeight: 2,
  wetlandReach: 500,
  wetlandCost: 1,
  waterfrontAmenity: 0.2,
  waterfrontRange: 300,
  viewAmenity: 0.05,

  substeps: 2,
  travelInterval: 12,
};

/** Terrain settings that give a map with no water at all: the flat plain of the original model. */
export const noWater: Partial<Params> = { landShare: 1, rivers: 0, lakeDepth: 1e9 };

/** Terrain effect settings that switch every terrain term off: flat-land costs everywhere and no terrain amenity. */
export const noTerrainEffects: Partial<Params> = { slopeCost: 0, slopeMax: 1e9, wetlandCost: 0, waterfrontAmenity: 0, viewAmenity: 0 };

export type ParamName = keyof Params;

export interface ParamMeta {
  group: 'Travel' | 'Transit' | 'Households' | 'Firms' | 'Land market' | 'Nucleation' | 'Terrain' | 'Terrain effects' | 'Run';
  min: number;
  max: number;
  step: number;
  label: string;
  /** Changing it invalidates the travel equilibrium. */
  travel?: boolean;
  /** Changing it means recomputing the terrain effects (build cost, terrain amenity). */
  terrainEffect?: boolean;
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

  metroSpeed: { group: 'Transit', min: 15, max: 60, step: 1, label: 'Metro speed (km/h)', travel: true },
  metroCapacity: { group: 'Transit', min: 5000, max: 60000, step: 1000, label: 'Metro capacity (pax/h/dir)', travel: true },
  metroHeadway: { group: 'Transit', min: 1, max: 20, step: 0.5, label: 'Metro headway (min)', travel: true },
  metroAccess: { group: 'Transit', min: 0, max: 10, step: 0.5, label: 'Metro station access (min)', travel: true },
  metroCatchment: { group: 'Transit', min: 400, max: 2000, step: 50, label: 'Station catchment (m)', travel: true },
  transferPenalty: { group: 'Transit', min: 0, max: 20, step: 0.5, label: 'Transfer penalty (min)', travel: true },

  scaleNorm: { group: 'Households', min: 0, max: 1, step: 0.01, label: 'η scale normalisation' },
  thetaH: { group: 'Households', min: 0, max: 2, step: 0.01, label: 'θ_h access weight' },
  amenity: { group: 'Households', min: -2, max: 2, step: 0.05, label: 'Amenity' },
  amenityNoise: { group: 'Households', min: 0, max: 1, step: 0.01, label: 'Amenity noise (on reset)' },
  uBar: { group: 'Households', min: -5, max: 5, step: 0.05, label: 'ū outside utility' },
  lambdaH: { group: 'Households', min: 0, max: 0.5, step: 0.005, label: 'λ_h relocation speed' },
  diffH: { group: 'Households', min: 0, max: 2400, step: 10, label: 'D_h diffusion (m²/month)' },
  floorPerResident: { group: 'Households', min: 15, max: 200, step: 0.5, label: 'Floor per resident (m²)' },

  agglomA: { group: 'Firms', min: 0, max: 1, step: 0.01, label: 'a agglomeration' },
  agglomSigma: { group: 'Firms', min: 0, max: 1, step: 0.01, label: 'σ agglomeration exp.' },
  agglomRange: { group: 'Firms', min: 0, max: 1600, step: 25, label: 'ℓ agglomeration range (m)' },
  thetaF: { group: 'Firms', min: 0, max: 2, step: 0.01, label: 'θ_f access weight' },
  wBar: { group: 'Firms', min: -5, max: 5, step: 0.05, label: 'w̄ outside wage' },
  employment: { group: 'Firms', min: 0.1, max: 1, step: 0.01, label: 'Jobs per resident' },
  labourWeight: { group: 'Firms', min: 0, max: 5, step: 0.05, label: 'θ_L labour-market weight' },
  lambdaF: { group: 'Firms', min: 0, max: 0.5, step: 0.005, label: 'λ_f relocation speed' },
  diffF: { group: 'Firms', min: 0, max: 2400, step: 10, label: 'D_f diffusion (m²/month)' },
  floorPerJob: { group: 'Firms', min: 10, max: 200, step: 0.5, label: 'Floor per job (m²)' },

  kappa: { group: 'Land market', min: 0, max: 0.3, step: 0.005, label: 'κ rent speed' },
  gamma: { group: 'Land market', min: 0, max: 0.3, step: 0.005, label: 'γ construction speed' },
  demolition: { group: 'Land market', min: 0, max: 0.1, step: 0.001, label: 'Demolition speed' },
  sMax: { group: 'Land market', min: 1, max: 30, step: 0.5, label: 'S_max (FAR)' },
  rent0: { group: 'Land market', min: 0.1, max: 10, step: 0.1, label: 'R₀ half-supply rent' },
  epsilon: { group: 'Land market', min: 0.5, max: 6, step: 0.1, label: 'ε supply elasticity' },
  rentFloor: { group: 'Land market', min: 0.001, max: 1, step: 0.001, label: 'Agricultural rent' },
  floorMin: { group: 'Land market', min: 0.001, max: 0.2, step: 0.001, label: 'Undeveloped floor space' },
  maxRate: { group: 'Land market', min: 0.05, max: 1, step: 0.05, label: 'Max relative rate' },

  nu0: { group: 'Nucleation', min: 0, max: 1e-2, step: 1e-5, label: 'ν₀ base rate (per km² per month)' },
  mu: { group: 'Nucleation', min: 0, max: 6, step: 0.1, label: 'μ sensitivity' },
  seedResidents: { group: 'Nucleation', min: 0, max: 500, step: 5, label: 'Seed residents' },
  seedJobs: { group: 'Nucleation', min: 0, max: 500, step: 5, label: 'Seed jobs' },

  landShare: { group: 'Terrain', min: 0.1, max: 1, step: 0.01, label: 'Land share (on reset)' },
  featureSize: { group: 'Terrain', min: 500, max: 20000, step: 100, label: 'Landform size (m, on reset)' },
  coastRoughness: { group: 'Terrain', min: 0, max: 0.8, step: 0.01, label: 'Coast roughness (on reset)' },
  mainland: { group: 'Terrain', min: 0, max: 2, step: 0.05, label: 'Mainland tilt (on reset)' },
  relief: { group: 'Terrain', min: 0, max: 500, step: 5, label: 'Highest point (m, on reset)' },
  rivers: { group: 'Terrain', min: 0, max: 8, step: 1, label: 'Rivers (on reset)' },
  riverWidth: { group: 'Terrain', min: 100, max: 800, step: 10, label: 'River width at mouth (m, on reset)' },
  lakeDepth: { group: 'Terrain', min: 1, max: 100, step: 1, label: 'Min. lake depth (m, on reset)' },

  slopeFree: { group: 'Terrain effects', min: 0, max: 20, step: 0.5, label: 'Free grade (%)', terrainEffect: true },
  slopeCost: { group: 'Terrain effects', min: 0, max: 1, step: 0.01, label: 'Slope cost (+share per % grade)', terrainEffect: true },
  slopeMax: { group: 'Terrain effects', min: 1, max: 40, step: 0.5, label: 'Max buildable grade (%)', terrainEffect: true },
  wetlandHeight: { group: 'Terrain effects', min: 0, max: 10, step: 0.1, label: 'Wetland height above water (m)', terrainEffect: true },
  wetlandReach: { group: 'Terrain effects', min: 0, max: 2000, step: 50, label: 'Wetland reach from water (m)', terrainEffect: true },
  wetlandCost: { group: 'Terrain effects', min: 0, max: 5, step: 0.05, label: 'Wetland cost (+share)', terrainEffect: true },
  waterfrontAmenity: { group: 'Terrain effects', min: 0, max: 1, step: 0.01, label: 'Waterfront amenity', terrainEffect: true },
  waterfrontRange: { group: 'Terrain effects', min: 0, max: 2000, step: 25, label: 'Waterfront range (m)', terrainEffect: true },
  viewAmenity: { group: 'Terrain effects', min: 0, max: 0.5, step: 0.005, label: 'View amenity (per 10 m above surroundings)', terrainEffect: true },

  substeps: { group: 'Run', min: 1, max: 8, step: 1, label: 'Euler substeps' },
  travelInterval: { group: 'Run', min: 1, max: 60, step: 1, label: 'Months between travel solves' },
};
