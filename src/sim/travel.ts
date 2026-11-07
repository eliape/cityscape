import { ZONES, ZONE_KM } from './grid';
import { linkIntegral, linkTimes, type Network } from './network';
import type { Params } from './params';

/**
 * Fast layer: combined trip distribution and assignment (Evans 1976), solved by Frank–Wolfe.
 *
 * Minimises  Z(x, T) = Σ_a ∫₀^{x_a} t_a + (1/β) Σ_ij T_ij (ln T_ij − 1)
 * subject to Σ_j T_ij = O_i, Σ_i T_ij = D_j and link flows x consistent with T.
 * Each iteration builds shortest-path costs, a doubly constrained gravity matrix on those costs
 * (balancing a_i, b_j), loads it all-or-nothing, and line-searches between the two states.
 */
export interface TravelResult {
  /** Generalised cost c_ij in minutes, row-major ZONES × ZONES. */
  cost: Float64Array;
  /** e^{-β c_ij}, cached so accessibility can be recomputed monthly without a re-solve. */
  kernel: Float64Array;
  /** Peak-hour trips T_ij. */
  trips: Float64Array;
  /** Arc flows and congested times. */
  flow: Float64Array;
  time: Float64Array;
  /** Mean generalised cost of trips leaving each zone (minutes); free-flow cost to the nearest job for empty zones. */
  zoneCommute: Float64Array;
  meanCommute: number;
  /** Objective value after each iteration (should fall). */
  objective: number[];
  /** Relative gap after each iteration. */
  gap: number[];
  totalTrips: number;
}

// ── Shortest paths ──────────────────────────────────────────────────────────────

/** Indexed binary min-heap with decrease-key, over node ids 0..n−1. */
class IndexedHeap {
  readonly heap: Int32Array;
  readonly pos: Int32Array; // position of node in heap, −1 if absent
  readonly key: Float64Array;
  size = 0;
  constructor(n: number) {
    this.heap = new Int32Array(n);
    this.pos = new Int32Array(n).fill(-1);
    this.key = new Float64Array(n);
  }
  /** Insert or lower the key of node v. */
  update(v: number, k: number): void {
    const { heap, pos, key } = this;
    let i = pos[v];
    if (i < 0) i = this.size++;
    key[v] = k;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const u = heap[p];
      if (key[u] <= k) break;
      heap[i] = u;
      pos[u] = i;
      i = p;
    }
    heap[i] = v;
    pos[v] = i;
  }
  pop(): number {
    const { heap, pos, key } = this;
    const top = heap[0];
    pos[top] = -1;
    const last = heap[--this.size];
    if (this.size > 0) {
      const k = key[last];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= this.size) break;
        if (c + 1 < this.size && key[heap[c + 1]] < key[heap[c]]) c++;
        if (key[heap[c]] >= k) break;
        heap[i] = heap[c];
        pos[heap[i]] = i;
        i = c;
      }
      heap[i] = last;
      pos[last] = i;
    }
    return top;
  }
}

export interface Trees {
  /** predArc[o * nodes + n]: arc into n on the shortest path from origin o (−1 at the root). */
  predArc: Int32Array;
  /** order[o * nodes + k]: k-th node settled from origin o. */
  order: Int32Array;
  settled: Int32Array; // nodes settled per origin
}

export function shortestPaths(net: Network, time: Float64Array, cost: Float64Array, trees: Trees, intra: number): void {
  const n = net.nodes;
  const dist = new Float64Array(n);
  const heap = new IndexedHeap(n);
  const { adjStart, adjArc, to } = net;
  const { predArc, order } = trees;
  for (let o = 0; o < ZONES; o++) {
    dist.fill(Infinity);
    const base = o * n;
    predArc.fill(-1, base, base + n);
    dist[o] = 0;
    heap.update(o, 0);
    let k = 0;
    while (heap.size > 0) {
      const u = heap.pop();
      order[base + k++] = u;
      const du = dist[u];
      for (let e = adjStart[u], end = adjStart[u + 1]; e < end; e++) {
        const a = adjArc[e];
        const v = to[a];
        const nd = du + time[a];
        if (nd < dist[v]) {
          dist[v] = nd;
          predArc[base + v] = a;
          heap.update(v, nd);
        }
      }
    }
    trees.settled[o] = k;
    const row = o * ZONES;
    for (let d = 0; d < ZONES; d++) cost[row + d] = dist[d];
    cost[row + o] = intra;
  }
}

/** Load a trip matrix onto the shortest-path trees (all-or-nothing). Intrazonal trips stay off the network. */
export function allOrNothing(net: Network, trips: Float64Array, trees: Trees, out: Float64Array): Float64Array {
  out.fill(0);
  const n = net.nodes;
  const load = new Float64Array(n);
  for (let o = 0; o < ZONES; o++) {
    load.fill(0);
    const row = o * ZONES;
    let any = false;
    for (let d = 0; d < ZONES; d++) {
      if (d === o) continue;
      const t = trips[row + d];
      if (t > 0) {
        load[d] = t;
        any = true;
      }
    }
    if (!any) continue;
    const base = o * n;
    // Walk the settle order backwards: every node passes its load to its predecessor.
    for (let k = trees.settled[o] - 1; k > 0; k--) {
      const v = trees.order[base + k];
      const l = load[v];
      if (l === 0) continue;
      const a = trees.predArc[base + v];
      out[a] += l;
      load[net.from[a]] += l;
    }
  }
  return out;
}

// ── Gravity model ───────────────────────────────────────────────────────────────

/**
 * Doubly constrained gravity: T_ij = a_i O_i b_j D_j K_ij with Σ_j T_ij = O_i and Σ_i T_ij = D_j.
 * Requires Σ O = Σ D. Returns the max relative constraint error.
 */
export function gravity(
  origins: Float64Array,
  dests: Float64Array,
  kernel: Float64Array,
  out: Float64Array,
  iterations = 100,
  tol = 1e-6,
  /** Balancing factors b_j; pass the previous solve's to warm-start. */
  b: Float64Array = new Float64Array(ZONES).fill(1),
): number {
  const a = new Float64Array(ZONES);
  let err = Infinity;
  const total = origins.reduce((s, v) => s + v, 0);
  if (total <= 0) {
    out.fill(0);
    return 0;
  }
  for (let it = 0; it < iterations && err > tol; it++) {
    for (let i = 0; i < ZONES; i++) {
      if (origins[i] <= 0) {
        a[i] = 0;
        continue;
      }
      let s = 0;
      const row = i * ZONES;
      for (let j = 0; j < ZONES; j++) if (b[j] > 0) s += b[j] * dests[j] * kernel[row + j];
      a[i] = s > 0 ? 1 / s : 0;
    }
    err = 0;
    for (let j = 0; j < ZONES; j++) {
      if (dests[j] <= 0) {
        b[j] = 0;
        continue;
      }
      let s = 0;
      for (let i = 0; i < ZONES; i++) if (a[i] > 0) s += a[i] * origins[i] * kernel[i * ZONES + j];
      const nb = s > 0 ? 1 / s : 0;
      err = Math.max(err, Math.abs(nb - b[j]) / Math.max(nb, 1e-300));
      b[j] = nb;
    }
  }
  for (let i = 0; i < ZONES; i++) {
    const row = i * ZONES;
    const ai = a[i] * origins[i];
    if (ai === 0) {
      out.fill(0, row, row + ZONES);
      continue;
    }
    for (let j = 0; j < ZONES; j++) out[row + j] = ai * b[j] * dests[j] * kernel[row + j];
  }
  return err;
}

export function expKernel(cost: Float64Array, beta: number, out: Float64Array): Float64Array {
  for (let i = 0; i < cost.length; i++) out[i] = Math.exp(-beta * cost[i]);
  return out;
}

function entropyTerm(T: Float64Array): number {
  let s = 0;
  for (let i = 0; i < T.length; i++) {
    const t = T[i];
    if (t > 0) s += t * (Math.log(t) - 1);
  }
  return s;
}

// ── Frank–Wolfe ─────────────────────────────────────────────────────────────────

export function intrazonalCost(p: Params): number {
  const km = ZONE_KM / 2; // mean trip length inside an 800 m zone, roughly
  return Math.min((km / p.walkSpeed) * 60, p.streetAccess + (km / p.streetSpeed) * 60);
}

/**
 * Solve the combined model.
 * @param origins peak-hour trip productions per zone
 * @param dests attractions per zone (rescaled internally so Σ D = Σ O)
 */
export function solveTravel(net: Network, origins: Float64Array, destsIn: Float64Array, p: Params): TravelResult {
  const P = ZONES * ZONES;
  const totalO = origins.reduce((s, v) => s + v, 0);
  const totalD = destsIn.reduce((s, v) => s + v, 0);
  const dests = new Float64Array(ZONES);
  if (totalD > 0) for (let j = 0; j < ZONES; j++) dests[j] = (destsIn[j] * totalO) / totalD;

  const trees: Trees = {
    predArc: new Int32Array(ZONES * net.nodes),
    order: new Int32Array(ZONES * net.nodes),
    settled: new Int32Array(ZONES),
  };
  const intra = intrazonalCost(p);
  const cost = new Float64Array(P);
  const kernel = new Float64Array(P);
  const T = new Float64Array(P);
  const Tstar = new Float64Array(P);
  const x = new Float64Array(net.arcs);
  const y = new Float64Array(net.arcs);
  const time = new Float64Array(net.arcs);
  const objective: number[] = [];
  const gap: number[] = [];
  const invBeta = 1 / p.beta;
  const bal = new Float64Array(ZONES).fill(1);

  const objectiveOf = (flow: Float64Array, trips: Float64Array) => linkIntegral(net, flow, p) + invBeta * entropyTerm(trips);

  // Initial state: free-flow costs.
  linkTimes(net, x, p, time);
  shortestPaths(net, time, cost, trees, intra);
  expKernel(cost, p.beta, kernel);
  gravity(origins, dests, kernel, T, 100, 1e-5, bal);
  allOrNothing(net, T, trees, x);

  const iterations = Math.max(1, Math.round(p.fwIterations));
  for (let it = 0; it < iterations; it++) {
    linkTimes(net, x, p, time);
    shortestPaths(net, time, cost, trees, intra);
    expKernel(cost, p.beta, kernel);
    gravity(origins, dests, kernel, Tstar, 30, 1e-4, bal);
    allOrNothing(net, Tstar, trees, y);

    // First and second directional derivatives of Z along (y − x, T* − T) at step λ.
    const derivs = (lambda: number): [number, number] => {
      let g = 0;
      let h = 0;
      for (let a = 0; a < net.arcs; a++) {
        const d = y[a] - x[a];
        if (d === 0) continue;
        const t0 = net.freeTime[a];
        const cap = net.capacity[a];
        if (cap > 0) {
          const r = (x[a] + lambda * d) / cap;
          const rk1 = Math.pow(Math.max(r, 0), p.bprPower - 1);
          g += t0 * (1 + p.bprAlpha * rk1 * r) * d;
          h += ((t0 * p.bprAlpha * p.bprPower * rk1) / cap) * d * d;
        } else g += t0 * d;
      }
      for (let k = 0; k < P; k++) {
        const d = Tstar[k] - T[k];
        if (d === 0) continue;
        const tl = Math.max(T[k] + lambda * d, 1e-300);
        g += invBeta * d * Math.log(tl);
        h += (invBeta * d * d) / tl;
      }
      return [g, h];
    };

    const [d0] = derivs(0);
    const z0 = objectiveOf(x, T);
    gap.push(Math.abs(d0) / Math.max(Math.abs(z0), 1e-9));
    // Z is convex in λ: safeguarded Newton on Z'(λ) = 0 inside a shrinking bracket.
    let lambda: number;
    if (d0 >= 0) lambda = 0;
    else {
      const [d1] = derivs(1);
      if (d1 <= 0) lambda = 1;
      else {
        let lo = 0;
        let hi = 1;
        lambda = 0.5;
        for (let k = 0; k < 8; k++) {
          const [g, h] = derivs(lambda);
          if (g < 0) lo = lambda;
          else hi = lambda;
          if (Math.abs(g) < 1e-9 * Math.abs(d0)) break;
          const newton = h > 0 ? lambda - g / h : NaN;
          lambda = newton > lo && newton < hi ? newton : 0.5 * (lo + hi);
          if (hi - lo < 1e-4) break;
        }
      }
    }
    for (let a = 0; a < net.arcs; a++) x[a] += lambda * (y[a] - x[a]);
    for (let k = 0; k < P; k++) T[k] += lambda * (Tstar[k] - T[k]);
    objective.push(objectiveOf(x, T));
  }

  // Final costs consistent with the final flows.
  linkTimes(net, x, p, time);
  shortestPaths(net, time, cost, trees, intra);
  expKernel(cost, p.beta, kernel);

  const zoneCommute = new Float64Array(ZONES);
  let sumTC = 0;
  let sumT = 0;
  for (let i = 0; i < ZONES; i++) {
    let s = 0;
    let st = 0;
    const row = i * ZONES;
    for (let j = 0; j < ZONES; j++) {
      s += T[row + j] * cost[row + j];
      st += T[row + j];
    }
    sumTC += s;
    sumT += st;
    if (st > 1e-9) zoneCommute[i] = s / st;
    else {
      // No trips leave this zone: use the cost to the destinations weighted by jobs.
      let w = 0;
      let wc = 0;
      for (let j = 0; j < ZONES; j++) {
        const k = dests[j] * kernel[row + j];
        w += k;
        wc += k * cost[row + j];
      }
      zoneCommute[i] = w > 0 ? wc / w : intra;
    }
  }

  return {
    cost,
    kernel,
    trips: T,
    flow: x,
    time,
    zoneCommute,
    meanCommute: sumT > 0 ? sumTC / sumT : 0,
    objective,
    gap,
    totalTrips: totalO,
  };
}
