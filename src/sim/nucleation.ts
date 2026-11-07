import { CELLS } from './grid';
import type { Fields } from './fields';
import type { Params } from './params';
import type { Rng } from './rng';

/** Below this many people a cell counts as empty and can nucleate. */
export const EMPTY_THRESHOLD = 1;

/**
 * Poisson settlement seeding: each empty cell seeds with rate ν(x) = ν₀ exp(μ (B(x) − R(x))) per month.
 * Uses the household bid rent as B. Returns the number of new settlements.
 */
export function nucleate(f: Fields, p: Params, bidH: Float32Array, rng: Rng, dt = 1): number {
  if (p.nu0 <= 0) return 0;
  let seeded = 0;
  for (let i = 0; i < CELLS; i++) {
    if (f.rho[i] + f.jobs[i] >= EMPTY_THRESHOLD) continue;
    const rate = p.nu0 * Math.exp(Math.min(p.mu * (bidH[i] - f.rent[i]), 30));
    const prob = 1 - Math.exp(-rate * dt);
    if (rng() < prob) {
      f.rho[i] += p.seedResidents;
      f.jobs[i] += p.seedJobs;
      seeded++;
    }
  }
  return seeded;
}
