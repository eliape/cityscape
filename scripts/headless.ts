/**
 * Run the model without a browser and print a yearly summary plus a rent profile through the centre.
 *   npm run headless -- [years] [seed] ['{"beta":0.08}']
 */
import { Simulation } from '../src/sim/simulation';
import { CELLS, N, idx } from '../src/sim/grid';

const years = Number(process.argv[2] ?? 30);
const seed = Number(process.argv[3] ?? 1);
const overrides = JSON.parse(process.argv[4] ?? '{}');
const sim = new Simulation(seed, overrides);

const fmt = (v: number, d = 1) => v.toFixed(d).padStart(8);
console.log('year      pop     jobs  commute   meanlnA   maxS  maxR  settl  travelMs  cells>0.5S');
for (let y = 0; y <= years; y++) {
  if (y > 0) sim.run(12);
  const s = sim.stats();
  let maxS = 0, maxR = 0, built = 0;
  for (let i = 0; i < CELLS; i++) {
    maxS = Math.max(maxS, sim.fields.floor[i]);
    maxR = Math.max(maxR, sim.fields.rent[i]);
    if (sim.fields.floor[i] > 0.5) built++;
  }
  console.log(`${String(y).padStart(4)} ${fmt(s.population, 0)} ${fmt(s.jobs, 0)} ${fmt(s.meanCommute)} ${fmt(s.meanLnA, 2)} ${fmt(maxS, 2)} ${fmt(maxR, 2)} ${fmt(s.settlements, 0)} ${fmt(s.travelMs, 0)} ${fmt(built, 0)}`);
}

// Find the centre of mass of jobs and print a radial rent / density profile.
let cx = 0, cy = 0, tot = 0;
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const j = sim.fields.jobs[idx(x, y)];
  cx += j * x; cy += j * y; tot += j;
}
cx = Math.round(cx / tot); cy = Math.round(cy / tot);
console.log(`\nProfile east of job centre (${cx}, ${cy}):`);
console.log('  dx    rent      rho     jobs  floor   lnAw  commute');
const snap = sim.snapshot();
for (let dx = 0; dx < 64 && cx + dx < N; dx += 4) {
  const i = idx(cx + dx, cy);
  console.log(`${String(dx).padStart(4)} ${fmt(sim.fields.rent[i], 2)} ${fmt(sim.fields.rho[i], 0)} ${fmt(sim.fields.jobs[i], 0)} ${fmt(sim.fields.floor[i], 2)} ${fmt(sim.lnAw[i], 2)} ${fmt(snap.commute[i])}`);
}
