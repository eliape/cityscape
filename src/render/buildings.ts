import * as THREE from 'three';
import { CELL_M, N } from '../sim/grid';
import type { Snapshot } from '../sim/types';
import { LN, LOT_M, LOTS, LotModel } from './lots';

/** Storey height, m, and the vertical exaggeration that keeps a 12.8 km map readable from above. */
const FLOOR_M = 3.5;
const VERTICAL_EXAGGERATION = 8;
/** World units are cells; a lot is LOT_M / CELL_M of a cell. */
const LOT_UNITS = LOT_M / CELL_M;
const UNITS_PER_FLOOR = (FLOOR_M / CELL_M) * VERTICAL_EXAGGERATION;

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
        const h = this.flatten ? 0.03 : floors * UNITS_PER_FLOOR;
        // Column-major scale + translation.
        m.fill(0, o, o + 16);
        m[o] = w;
        m[o + 5] = h;
        m[o + 10] = d;
        m[o + 12] = (lx + 0.5 + L.offsetX[i]) * LOT_UNITS - N / 2;
        m[o + 13] = 0.01;
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
