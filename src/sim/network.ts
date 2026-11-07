import { CELL_M, N, NZ, ZONES, ZONE_KM, zidx } from './grid';
import { cellInZones, pathLength, type MetroLine } from './metro';
import type { Params } from './params';

/**
 * The travel graph over zones. Layer 0 is walking (zone centroids, where trips start and end),
 * layer 1 is the street. After them come metro platforms: one node per line and station, joined to
 * the walk layer by board/alight arcs, to the next station by ride arcs, and to other lines' platforms
 * at the same station by transfer arcs.
 */
export const ArcKind = { Walk: 0, Street: 1, Access: 2, Board: 3, Alight: 4, Ride: 5, Transfer: 6 } as const;
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
  /** For ride arcs: index of the line in the list passed to buildNetwork, else −1. */
  arcLine: Int32Array;
  /** For ride arcs: segment k runs between stations k and k+1; direction 0 is along the rail, 1 against. */
  arcSeg: Int32Array;
  arcDir: Uint8Array;
}

/** Platforms of different lines whose stations are at most this far apart are joined by transfers, m. */
const TRANSFER_RANGE_M = 250;

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

export function buildNetwork(p: Params, lines: readonly MetroLine[] = []): Network {
  const from: number[] = [];
  const to: number[] = [];
  const kind: number[] = [];
  const freeTime: number[] = [];
  const capacity: number[] = [];
  const arcLine: number[] = [];
  const arcSeg: number[] = [];
  const arcDir: number[] = [];
  const add = (a: number, b: number, k: ArcKind, t: number, cap: number, line = -1, seg = -1, dir = 0) => {
    from.push(a);
    to.push(b);
    kind.push(k);
    freeTime.push(t);
    capacity.push(cap);
    arcLine.push(line);
    arcSeg.push(seg);
    arcDir.push(dir);
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

  const nodes = 2 * ZONES + addMetro(p, lines, add);
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
    arcLine: Int32Array.from(arcLine),
    arcSeg: Int32Array.from(arcSeg),
    arcDir: Uint8Array.from(arcDir),
  };
}

type AddArc = (a: number, b: number, k: ArcKind, t: number, cap: number, line?: number, seg?: number, dir?: number) => void;

/** Add the metro layer's arcs; returns the number of platform nodes. */
function addMetro(p: Params, lines: readonly MetroLine[], add: AddArc): number {
  const first = 2 * ZONES;
  const minutes = (m: number, kmh: number) => (m / 1000 / kmh) * 60;
  const wait = p.metroHeadway / 2;
  const reach = Math.ceil(p.metroCatchment / (ZONE_KM * 1000)) + 1;
  // Platforms in line order: line l, station s → node first + offset[l] + s.
  const platforms: { node: number; line: number; cell: number }[] = [];
  lines.forEach((line, l) => {
    const base = first + platforms.length;
    for (let s = 0; s < line.stations.length; s++) {
      const cell = line.path[line.stations[s]];
      const node = base + s;
      platforms.push({ node, line: l, cell });
      // Board and alight from walk-layer zones within the catchment (always the station's own zone).
      const [sx, sy] = cellInZones(cell);
      const zx0 = Math.floor(sx);
      const zy0 = Math.floor(sy);
      for (let zy = zy0 - reach; zy <= zy0 + reach; zy++) {
        for (let zx = zx0 - reach; zx <= zx0 + reach; zx++) {
          if (zx < 0 || zy < 0 || zx >= NZ || zy >= NZ) continue;
          const m = Math.hypot(zx + 0.5 - sx, zy + 0.5 - sy) * ZONE_KM * 1000;
          if (m > p.metroCatchment && (zx !== zx0 || zy !== zy0)) continue;
          const z = zidx(zx, zy);
          const walk = minutes(m, p.walkSpeed) + p.metroAccess;
          add(z, node, ArcKind.Board, walk + wait, 0);
          add(node, z, ArcKind.Alight, walk, 0);
        }
      }
    }
    for (let s = 0; s + 1 < line.stations.length; s++) {
      const t = minutes(pathLength(line.path, line.stations[s], line.stations[s + 1]), p.metroSpeed);
      add(base + s, base + s + 1, ArcKind.Ride, t, p.metroCapacity, l, s, 0);
      add(base + s + 1, base + s, ArcKind.Ride, t, p.metroCapacity, l, s, 1);
    }
  });
  // Transfers between lines at the same station: walk between platforms, a penalty and half a headway.
  for (const a of platforms) {
    for (const b of platforms) {
      if (a.line === b.line) continue;
      const m = Math.hypot((a.cell % N) - (b.cell % N), ((a.cell / N) | 0) - ((b.cell / N) | 0)) * CELL_M;
      if (m > TRANSFER_RANGE_M) continue;
      add(a.node, b.node, ArcKind.Transfer, minutes(m, p.walkSpeed) + p.transferPenalty + wait, 0);
    }
  }
  return platforms.length;
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
