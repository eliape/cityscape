import { CELLS } from './grid';
import type { Fields } from './fields';
import { agglomeration } from './landuse';
import type { Params } from './params';

/**
 * Economic output. Output per job is the base output y₀ raised by agglomeration,
 *   y(x) = y₀ · exp(a (G_ℓ * J)^σ),
 * i.e. the agglomeration term of the firm bid rent read as a log productivity gain: a job in a dense
 * cluster produces more than the same job on its own. The bid's access term (θ_f ln A_f) is left out,
 * since it pays for reaching workers rather than adding output. Output only reports on the model and
 * feeds nothing back into it.
 *
 * `blurredJobs` is G_ℓ * J per cell, as bidRents leaves it in the scratch buffers.
 * Fills `out` (optional) with output per cell in $/year and returns the city total.
 */
export function cityOutput(f: Fields, blurredJobs: Float32Array, p: Params, out?: Float32Array): number {
  const y0 = p.outputPerJob * 1000;
  let total = 0;
  for (let i = 0; i < CELLS; i++) {
    const y = f.jobs[i] > 0 ? f.jobs[i] * y0 * Math.exp(agglomeration(blurredJobs[i], p)) : 0;
    if (out) out[i] = y;
    total += y;
  }
  return total;
}
