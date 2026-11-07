import * as THREE from 'three';
import { CELL_M, N } from '../sim/grid';
import type { Snapshot, TerrainView } from '../sim/types';
import { LN, LOT_M, LOTS, LotModel } from './lots';
import { TERRAIN_UNITS_PER_M } from './scale';

/** Storey height, m, and the vertical exaggeration that keeps a 12.8 km map readable from above. */
const FLOOR_M = 3.5;
const VERTICAL_EXAGGERATION = 8;
/** World units are cells; a lot is LOT_M / CELL_M of a cell. */
const LOT_UNITS = LOT_M / CELL_M;
const UNITS_PER_FLOOR = (FLOOR_M / CELL_M) * VERTICAL_EXAGGERATION;
/** How far a building reaches below its lot's centre height, world units, to cover the slope under it. */
const PLINTH = 0.15;

// Two families of shades: warm for homes, cool for jobs. Each building picks a shade from its family.
const HOME_LIGHT = new THREE.Color('#f2c38f');
const HOME_DARK = new THREE.Color('#d9772e');
const WORK_LIGHT = new THREE.Color('#9dbbe3');
const WORK_DARK = new THREE.Color('#3a6fb8');

/**
 * Buildings as their own graphical layer: one block per developed 50 m lot, drawn in a single
 * InstancedMesh. Lot development lives in LotModel; this class only turns it into instances.
 */
export class BuildingLayer {
  readonly mesh: THREE.InstancedMesh;
  readonly lots = new LotModel();
  private material: THREE.MeshLambertMaterial;
  private color = new THREE.Color();
  private flatten = false;
  private faded = false;
  /** Ground height under each lot, world units; buildings start a little below it so slopes leave no gaps. */
  private base = new Float32Array(LOTS);

  constructor() {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    this.material = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 1 });
    this.mesh = new THREE.InstancedMesh(geo, this.material, LOTS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(LOTS * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  setTerrain(t: TerrainView): void {
    const cellsPerLot = LOT_M / CELL_M;
    for (let ly = 0; ly < LN; ly++)
      for (let lx = 0; lx < LN; lx++) {
        // Each lot lies inside one cell; sample the ground mesh (vertices at cell centres) at the lot centre.
        let fx = (lx + 0.5) * cellsPerLot - 0.5;
        let fy = (ly + 0.5) * cellsPerLot - 0.5;
        fx = Math.min(Math.max(fx, 0), N - 1);
        fy = Math.min(Math.max(fy, 0), N - 1);
        const x0 = Math.min(fx | 0, N - 2);
        const y0 = Math.min(fy | 0, N - 2);
        const tx = fx - x0;
        const ty = fy - y0;
        const h = (i: number) => Math.max(t.surface[i], 0);
        const a = y0 * N + x0;
        this.base[ly * LN + lx] = ((h(a) * (1 - tx) + h(a + 1) * tx) * (1 - ty) + (h(a + N) * (1 - tx) + h(a + N + 1) * tx) * ty) * TERRAIN_UNITS_PER_M;
      }
    this.lots.setWater(t.water);
  }

  setFlatten(on: boolean): void {
    this.flatten = on;
    this.rebuild();
  }

  /** An active overlay fades buildings to 25 % opacity. */
  setFaded(on: boolean): void {
    this.faded = on;
    this.material.opacity = on ? 0.25 : 1;
    this.material.depthWrite = !on;
    this.material.needsUpdate = true;
  }

  get isFaded(): boolean {
    return this.faded;
  }

  update(snap: Snapshot): void {
    this.lots.update(snap.month, snap.floor, snap.mix);
    this.rebuild();
  }

  /** Write one instance per standing building. */
  private rebuild(): void {
    const L = this.lots;
    const m = this.mesh.instanceMatrix.array as Float32Array;
    const c = this.mesh.instanceColor!.array as Float32Array;
    let n = 0;
    for (let ly = 0; ly < LN; ly++) {
      for (let lx = 0; lx < LN; lx++) {
        const i = ly * LN + lx;
        const floors = L.floors[i];
        if (floors === 0) continue;
        const o = n * 16;
        const w = L.width[i] * LOT_UNITS;
        const d = L.depth[i] * LOT_UNITS;
        const h = (this.flatten ? 0.03 : floors * UNITS_PER_FLOOR) + PLINTH;
        // Column-major scale + translation.
        m.fill(0, o, o + 16);
        m[o] = w;
        m[o + 5] = h;
        m[o + 10] = d;
        m[o + 12] = (lx + 0.5 + L.offsetX[i]) * LOT_UNITS - N / 2;
        m[o + 13] = this.base[i] + 0.01 - PLINTH;
        m[o + 14] = (ly + 0.5 + L.offsetY[i]) * LOT_UNITS - N / 2;
        m[o + 15] = 1;
        const t = L.shade[i];
        if (L.commercial[i]) this.color.copy(WORK_LIGHT).lerp(WORK_DARK, 0.35 + 0.65 * t);
        else this.color.copy(HOME_LIGHT).lerp(HOME_DARK, 0.35 + 0.65 * t);
        c[n * 3] = this.color.r;
        c[n * 3 + 1] = this.color.g;
        c[n * 3 + 2] = this.color.b;
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }
}
