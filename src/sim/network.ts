import { NZ, ZONES, ZONE_KM, zidx } from './grid';
import type { Params } from './params';

/**
 * The travel graph over zones. Layer 0 is walking (zone centroids, where trips start and end),
 * layer 1 is the street. Transit layers will be added here in a later milestone; each layer is a
 * copy of the zone nodes joined to the walk layer by access/egress arcs.
 */
export const ArcKind = { Walk: 0, Street: 1, Access: 2 } as const;
export type ArcKind = (typeof ArcKind)[keyof typeof ArcKind];

export interface Network {
  nodes: number;
  arcs: number;
  from: Int32Array;
  to: Int32Array;
  kind: Uint8Array;
  freeTime: Float64Array; // minutes at zero flow
  capacity: Float64Array; // pax/h; 0 means uncongested
  /** CSR adjacency: outgoing arcs of node n are adjStart[n]..adjStart[n+1]-1 in adjArc. */
  adjStart: Int32Array;
  adjArc: Int32Array;
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

export function buildNetwork(p: Params): Network {
  const from: number[] = [];
  const to: number[] = [];
  const kind: number[] = [];
  const freeTime: number[] = [];
  const capacity: number[] = [];
  const add = (a: number, b: number, k: ArcKind, t: number, cap: number) => {
    from.push(a);
    to.push(b);
    kind.push(k);
    freeTime.push(t);
    capacity.push(cap);
  };

  const STREET = ZONES; // offset of street-layer nodes
  for (let zy = 0; zy < NZ; zy++) {
    for (let zx = 0; zx < NZ; zx++) {
      const a = zidx(zx, zy);
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = zx + dx;
        const ny = zy + dy;
        if (nx < 0 || ny < 0 || nx >= NZ || ny >= NZ) continue;
        const b = zidx(nx, ny);
        const km = ZONE_KM * Math.hypot(dx, dy);
        add(a, b, ArcKind.Walk, (km / p.walkSpeed) * 60, 0);
        // Diagonal street links carry less (two half-streets), so scale capacity by 1/√2.
        add(STREET + a, STREET + b, ArcKind.Street, (km / p.streetSpeed) * 60, p.streetCapacity / Math.hypot(dx, dy));
      }
      add(a, STREET + a, ArcKind.Access, p.streetAccess / 2, 0);
      add(STREET + a, a, ArcKind.Access, p.streetAccess / 2, 0);
    }
  }

  const nodes = 2 * ZONES;
  const arcs = from.length;
  const adjStart = new Int32Array(nodes + 1);
  for (let i = 0; i < arcs; i++) adjStart[from[i] + 1]++;
  for (let n = 0; n < nodes; n++) adjStart[n + 1] += adjStart[n];
  const fill = adjStart.slice(0, nodes);
  const adjArc = new Int32Array(arcs);
  for (let i = 0; i < arcs; i++) adjArc[fill[from[i]]++] = i;

  return {
    nodes,
    arcs,
    from: Int32Array.from(from),
    to: Int32Array.from(to),
    kind: Uint8Array.from(kind),
    freeTime: Float64Array.from(freeTime),
    capacity: Float64Array.from(capacity),
    adjStart,
    adjArc,
  };
}

/** BPR link cost t(f) = t0 (1 + α (f/Cap)^k). */
export function linkTimes(net: Network, flow: Float64Array, p: Params, out: Float64Array): Float64Array {
  for (let a = 0; a < net.arcs; a++) {
    const cap = net.capacity[a];
    out[a] = cap > 0 ? net.freeTime[a] * (1 + p.bprAlpha * Math.pow(flow[a] / cap, p.bprPower)) : net.freeTime[a];
  }
  return out;
}

/** ∫₀^f t(x) dx for the Beckmann part of the objective. */
export function linkIntegral(net: Network, flow: Float64Array, p: Params): number {
  let s = 0;
  for (let a = 0; a < net.arcs; a++) {
    const t0 = net.freeTime[a];
    const cap = net.capacity[a];
    const f = flow[a];
    if (cap > 0) s += t0 * (f + (p.bprAlpha * cap * Math.pow(f / cap, p.bprPower + 1)) / (p.bprPower + 1));
    else s += t0 * f;
  }
  return s;
}
