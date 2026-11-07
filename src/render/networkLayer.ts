import * as THREE from 'three';
import { N } from '../sim/grid';
import type { LineView, NetworkView, TerrainView } from '../sim/types';
import { TERRAIN_UNITS_PER_M } from './scale';

/** Draft line being drawn with the line tool. */
export interface Draft {
  path: number[];
  stations: number[]; // indices into path
  /** Where the cursor would add the next rail point or station, if anywhere. */
  ghostRail: number[]; // cells from the last rail point to the cursor
  ghostStation: number | null; // cell
}

/** Lines float a little above the ground; they are underground, so they draw on top of everything. */
const LIFT = 0.35;
const BASE_WIDTH = 0.45;
const MAX_EXTRA_WIDTH = 1.6;
const DRAFT_WIDTH = 0.6;
const STATION_RADIUS = 0.75;

const LOW = new THREE.Color('#2f9e6b');
const MID = new THREE.Color('#e3b23c');
const HIGH = new THREE.Color('#c8352b');
const TAIL = new THREE.Color('#8a8f98');
const DRAFT = new THREE.Color('#d9822b');
const STATION_FILL = new THREE.Color('#ffffff');
const STATION_RING = new THREE.Color('#1d2025');

/** Colour by load / capacity: green when empty, yellow at 0.6, red from 0.9. */
export function loadColor(ratio: number, out = new THREE.Color()): THREE.Color {
  if (ratio >= 0.9) return out.copy(HIGH);
  if (ratio <= 0.6) return out.copy(LOW).lerp(MID, Math.max(ratio, 0) / 0.6);
  return out.copy(MID).lerp(HIGH, (ratio - 0.6) / 0.3);
}

/** Collects flat quads and discs with per-vertex colour into one geometry. */
class Builder {
  pos: number[] = [];
  col: number[] = [];
  constructor(private height: (cell: number) => number) {}

  point(cell: number): THREE.Vector3 {
    return new THREE.Vector3((cell % N) - (N - 1) / 2, this.height(cell) + LIFT, ((cell / N) | 0) - (N - 1) / 2);
  }

  private tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.Color): void {
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let k = 0; k < 3; k++) this.col.push(color.r, color.g, color.b);
  }

  /** A ribbon through cells; each step is a quad stretched by half a width at both ends so joints close. */
  ribbon(cells: readonly number[], width: number, color: THREE.Color, lift = 0): void {
    for (let k = 1; k < cells.length; k++) {
      const a = this.point(cells[k - 1]);
      const b = this.point(cells[k]);
      a.y += lift;
      b.y += lift;
      const d = b.clone().sub(a);
      d.y = 0;
      d.normalize();
      const h = width / 2;
      const side = new THREE.Vector3(-d.z, 0, d.x).multiplyScalar(h);
      const a0 = a.clone().addScaledVector(d, -h);
      const b0 = b.clone().addScaledVector(d, h);
      const p1 = a0.clone().add(side);
      const p2 = a0.clone().sub(side);
      const p3 = b0.clone().sub(side);
      const p4 = b0.clone().add(side);
      this.tri(p1, p3, p2, color);
      this.tri(p1, p4, p3, color);
    }
  }

  disc(cell: number, radius: number, color: THREE.Color, lift: number): void {
    const c = this.point(cell);
    c.y += lift;
    const n = 20;
    for (let k = 0; k < n; k++) {
      const t0 = (k / n) * Math.PI * 2;
      const t1 = ((k + 1) / n) * Math.PI * 2;
      const p0 = new THREE.Vector3(c.x + Math.cos(t0) * radius, c.y, c.z + Math.sin(t0) * radius);
      const p1 = new THREE.Vector3(c.x + Math.cos(t1) * radius, c.y, c.z + Math.sin(t1) * radius);
      this.tri(c, p1, p0, color);
    }
  }

  station(cell: number, scale = 1): void {
    this.disc(cell, STATION_RADIUS * scale, STATION_RING, 0.02);
    this.disc(cell, STATION_RADIUS * 0.62 * scale, STATION_FILL, 0.04);
  }

  into(geo: THREE.BufferGeometry): void {
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.computeBoundingSphere();
  }
}

/**
 * The transit network on top of the map: built lines (width ∝ peak flow, colour = load / capacity)
 * and the line tool's draft. Metro runs underground, so the layer ignores depth and is never hidden.
 */
export class NetworkLayer {
  readonly group = new THREE.Group();
  private built: THREE.Mesh;
  private draft: THREE.Mesh;
  private surface = new Float32Array(N * N);
  private lines: LineView[] = [];

  constructor() {
    const material = () =>
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: true });
    this.built = new THREE.Mesh(new THREE.BufferGeometry(), material());
    this.draft = new THREE.Mesh(new THREE.BufferGeometry(), material());
    this.built.renderOrder = 10;
    this.draft.renderOrder = 11;
    (this.draft.material as THREE.MeshBasicMaterial).opacity = 0.95;
    this.group.add(this.built, this.draft);
  }

  private builder(): Builder {
    return new Builder((cell) => Math.max(this.surface[cell], 0) * TERRAIN_UNITS_PER_M);
  }

  setTerrain(t: TerrainView): void {
    this.surface.set(t.surface);
    this.setNetwork({ lines: this.lines });
  }

  setNetwork(view: NetworkView): void {
    this.lines = view.lines;
    const b = this.builder();
    const color = new THREE.Color();
    for (const line of view.lines) {
      const { path, stations } = line;
      // Rail beyond the end stations carries no one.
      b.ribbon(path.slice(0, stations[0] + 1), BASE_WIDTH * 0.6, TAIL);
      b.ribbon(path.slice(stations[stations.length - 1]), BASE_WIDTH * 0.6, TAIL);
      for (let s = 0; s + 1 < stations.length; s++) {
        const flow = Math.max(line.load[s][0], line.load[s][1]);
        const ratio = line.capacity > 0 ? flow / line.capacity : 0;
        const width = BASE_WIDTH + MAX_EXTRA_WIDTH * Math.sqrt(Math.min(ratio, 1.2));
        b.ribbon(path.slice(stations[s], stations[s + 1] + 1), width, loadColor(ratio, color), 0.005 * s);
      }
    }
    for (const line of view.lines) for (const s of line.stations) b.station(line.path[s]);
    this.built.geometry.dispose();
    this.built.geometry = new THREE.BufferGeometry();
    b.into(this.built.geometry);
  }

  setDraft(d: Draft | null): void {
    const b = this.builder();
    if (d) {
      b.ribbon(d.path, DRAFT_WIDTH, DRAFT);
      if (d.ghostRail.length > 1) b.ribbon(d.ghostRail, DRAFT_WIDTH * 0.6, DRAFT.clone().lerp(new THREE.Color('#ffffff'), 0.4));
      if (d.path.length === 1) b.disc(d.path[0], DRAFT_WIDTH * 0.6, DRAFT, 0);
      for (const s of d.stations) b.station(d.path[s]);
      if (d.ghostStation !== null) b.station(d.ghostStation, 0.8);
    }
    this.draft.geometry.dispose();
    this.draft.geometry = new THREE.BufferGeometry();
    b.into(this.draft.geometry);
  }
}
