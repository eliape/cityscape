import * as THREE from 'three';
import { CELLS, N } from '../sim/grid';
import type { Snapshot } from '../sim/types';

// Job share ramp: warm residential → pale mixed → cool commercial.
const RESIDENTIAL = new THREE.Color('#e48a3c');
const MIXED = new THREE.Color('#ece6da');
const COMMERCIAL = new THREE.Color('#3f78c2');
/** World units (cells) of height per √(floor space). */
const HEIGHT_SCALE = 2.4;
/** Floor space below this is open land and draws no block. */
const MIN_FLOOR = 0.03;

/** One extruded block per cell, all drawn in a single InstancedMesh call. */
export class BuildingLayer {
  readonly mesh: THREE.InstancedMesh;
  private material: THREE.MeshLambertMaterial;
  private color = new THREE.Color();
  private flatten = false;
  private faded = false;
  private last: Snapshot | null = null;

  constructor() {
    const geo = new THREE.BoxGeometry(0.86, 1, 0.86);
    geo.translate(0, 0.5, 0);
    this.material = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 1 });
    this.mesh = new THREE.InstancedMesh(geo, this.material, CELLS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CELLS * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    const m = this.mesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < CELLS; i++) {
      const o = i * 16;
      m.fill(0, o, o + 16);
      m[o + 15] = 1;
    }
  }

  setFlatten(on: boolean): void {
    this.flatten = on;
    if (this.last) this.update(this.last);
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
    this.last = snap;
    const m = this.mesh.instanceMatrix.array as Float32Array;
    const c = this.mesh.instanceColor!.array as Float32Array;
    const { floor, mix } = snap;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const o = i * 16;
        const S = floor[i];
        const built = S > MIN_FLOOR;
        const h = built ? (this.flatten ? 0.02 : Math.max(0.05, HEIGHT_SCALE * Math.sqrt(S))) : 0;
        const w = built ? 1 : 0;
        // Column-major scale + translation.
        m[o] = w;
        m[o + 5] = h;
        m[o + 10] = w;
        m[o + 12] = x - N / 2 + 0.5;
        m[o + 13] = 0.01;
        m[o + 14] = y - N / 2 + 0.5;
        const t = mix[i];
        if (t < 0.5) this.color.copy(RESIDENTIAL).lerp(MIXED, t * 2);
        else this.color.copy(MIXED).lerp(COMMERCIAL, t * 2 - 1);
        c[i * 3] = this.color.r;
        c[i * 3 + 1] = this.color.g;
        c[i * 3 + 2] = this.color.b;
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }
}
