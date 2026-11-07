/**
 * Spec check for milestone 5: does a metro line pull growth along it?
 * Grows two identical cities for 30 years on an open plain, gives one an east–west line through the
 * job centre (stations every 1 km), and prints population, commute, metro use and the population in a
 * 900 m band along the line every 5 years.
 *   npm run metro-compare -- ['{"metroHeadway":2}']
 */
import { Simulation } from '../src/sim/simulation';
import { railThrough } from '../src/sim/metro';
import { idx, CELLS, N } from '../src/sim/grid';
import { noWater } from '../src/sim/params';
const over = JSON.parse(process.argv[2] ?? '{}');
const mk = () => { const s = new Simulation(1, { ...noWater, ...over }); s.run(30 * 12); return s; };
const a = mk(); const b = mk();
let cy = 0, tot = 0;
for (let i = 0; i < CELLS; i++) { cy += a.fields.jobs[i] * ((i / N) | 0); tot += a.fields.jobs[i]; }
const y = Math.round(cy / tot);
const path = railThrough([idx(10, y), idx(118, y)]);
const st = []; for (let k = 0; k < path.length; k += 10) st.push(k);
b.addLine({ path, stations: st });
const band = (s: Simulation) => { let p = 0; for (let x = 0; x < N; x++) for (let dy = -4; dy <= 4; dy++) p += s.fields.rho[idx(x, y + dy)]; return p; };
for (let yr = 30; yr <= 45; yr += 5) {
  const sa = a.stats(), sb = b.stats();
  console.log(yr, Math.round(sa.population), Math.round(sb.population), sa.meanCommute.toFixed(1), sb.meanCommute.toFixed(1), Math.round(sb.metroRiders), (sb.metroShare * 100).toFixed(1) + '%', 'band', Math.round(band(a)), Math.round(band(b)));
  a.run(60); b.run(60);
}
