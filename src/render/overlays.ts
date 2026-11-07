import * as THREE from 'three';
import { N } from '../sim/grid';
import type { Snapshot, SnapshotField, TerrainView } from '../sim/types';
import { TERRAIN_UNITS_PER_M } from './scale';

export type OverlayId = 'none' | 'access' | 'rent' | 'pressure' | 'commute' | 'crowding' | 'buildCost' | 'amenity';

export interface OverlayDef {
  id: OverlayId;
  label: string;
  hint: string;
  field?: SnapshotField;
  kind: 'none' | 'sequential' | 'diverging';
  center?: number;
  unit?: string;
  digits?: number;
  /** Fixed colour range instead of the robust 2–98 % range of the data. */
  range?: [number, number];
}

export const OVERLAYS: OverlayDef[] = [
  { id: 'none', label: 'Buildings', hint: 'One building per 50 m lot, floors from floor space; warm = homes, cool = jobs', kind: 'none' },
  { id: 'access', label: 'Accessibility', hint: 'ln A_w: jobs within reach', field: 'lnA', kind: 'sequential', digits: 1 },
  { id: 'rent', label: 'Rent', hint: 'Rent per unit of floor space', field: 'rent', kind: 'sequential', digits: 2 },
  { id: 'pressure', label: 'Growth pressure', hint: 'B − R: red = undervalued land', field: 'pressure', kind: 'diverging', center: 0, digits: 2 },
  { id: 'commute', label: 'Commute', hint: 'Mean generalised cost of trips from each cell', field: 'commute', kind: 'sequential', unit: 'min', digits: 0 },
  { id: 'crowding', label: 'Crowding', hint: 'Floor-space demand / supply: red = crowded', field: 'crowding', kind: 'diverging', center: 1, digits: 2 },
  { id: 'buildCost', label: 'Build cost', hint: 'Construction cost vs flat dry land, from slope and wetland; top colour = 4× or unbuildable', field: 'buildCost', kind: 'sequential', unit: '×', digits: 1, range: [1, 4] },
  { id: 'amenity', label: 'Amenity', hint: 'Household amenity: waterfront, views and seeded noise', field: 'amenity', kind: 'sequential', digits: 2 },
];

export interface Legend {
  kind: 'sequential' | 'diverging';
  min: number;
  max: number;
  unit?: string;
  digits: number;
}

// Vertices sit at cell centres, so map the plane's 0..1 uv onto texel centres.
const vertex = /* glsl */ `
uniform float uHeightScale;
varying vec2 vUv;
varying vec3 vNormal;
varying float vHeight;
void main() {
  vec2 t = vec2(uv.x, 1.0 - uv.y);
  vUv = (0.5 + t * ${(N - 1).toFixed(1)}) / ${N.toFixed(1)};
  vNormal = normal;
  vHeight = position.y * uHeightScale;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// Sequential: a perceptual blue-green-yellow ramp. Diverging: blue – near-white – red.
const fragment = /* glsl */ `
uniform sampler2D uData;
uniform sampler2D uWater;
uniform int uMode; // 0 none, 1 sequential, 2 diverging
uniform vec3 uBase;
uniform vec3 uHigh;
uniform vec3 uWaterColor;
uniform vec3 uSunDir;
uniform float uFade;
varying vec2 vUv;
varying vec3 vNormal;
varying float vHeight; // 0 at sea level, 1 at the highest point

vec3 sequential(float t) {
  vec3 c0 = vec3(0.13, 0.11, 0.33);
  vec3 c1 = vec3(0.16, 0.38, 0.56);
  vec3 c2 = vec3(0.15, 0.62, 0.53);
  vec3 c3 = vec3(0.55, 0.80, 0.30);
  vec3 c4 = vec3(0.99, 0.90, 0.25);
  t = clamp(t, 0.0, 1.0) * 4.0;
  if (t < 1.0) return mix(c0, c1, t);
  if (t < 2.0) return mix(c1, c2, t - 1.0);
  if (t < 3.0) return mix(c2, c3, t - 2.0);
  return mix(c3, c4, t - 3.0);
}

vec3 diverging(float t) {
  vec3 lo = vec3(0.17, 0.40, 0.73);
  vec3 mid = vec3(0.93, 0.92, 0.89);
  vec3 hi = vec3(0.80, 0.22, 0.17);
  t = clamp(t, 0.0, 1.0);
  return t < 0.5 ? mix(lo, mid, t * 2.0) : mix(mid, hi, t * 2.0 - 1.0);
}

void main() {
  vec3 col = mix(uBase, uHigh, clamp(vHeight, 0.0, 1.0));
  if (uMode > 0) {
    float t = texture2D(uData, vUv).r;
    vec3 c = uMode == 1 ? sequential(t) : diverging(t);
    col = mix(col, c, uFade);
  }
  // Soft hillshade: full brightness on flat ground, darker on slopes facing away from the sun.
  vec3 n = normalize(vNormal);
  float shade = clamp(0.3 + 0.7 * dot(n, uSunDir) / uSunDir.y, 0.55, 1.15);
  col *= shade;
  // Sea, lakes and rivers alike; a linear-filtered mask threshold gives smooth shores.
  float w = texture2D(uWater, vUv).r;
  col = mix(col, uWaterColor, smoothstep(0.4, 0.6, w));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/**
 * The ground: a 128 × 128 height mesh with one vertex per cell centre, tinted by height, shaded by slope,
 * painted with water, and recoloured on the GPU by the active overlay's ramp.
 */
export class OverlayLayer {
  readonly mesh: THREE.Mesh;
  private data = new Uint8Array(N * N);
  private texture: THREE.DataTexture;
  private waterData = new Uint8Array(N * N);
  private waterTexture: THREE.DataTexture;
  private material: THREE.ShaderMaterial;
  private sortBuf = new Float32Array(N * N);
  current: OverlayDef = OVERLAYS[0];
  legend: Legend | null = null;

  constructor(baseColor: THREE.Color) {
    this.texture = new THREE.DataTexture(this.data, N, N, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;
    this.waterTexture = new THREE.DataTexture(this.waterData, N, N, THREE.RedFormat, THREE.UnsignedByteType);
    this.waterTexture.magFilter = THREE.LinearFilter;
    this.waterTexture.minFilter = THREE.LinearFilter;
    this.waterTexture.needsUpdate = true;
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uData: { value: this.texture },
        uWater: { value: this.waterTexture },
        uMode: { value: 0 },
        uBase: { value: baseColor.clone() },
        uHigh: { value: baseColor.clone() },
        uWaterColor: { value: new THREE.Color('#8fb8d8') },
        uSunDir: { value: new THREE.Vector3(-60, 120, 40).normalize() },
        uHeightScale: { value: 1 },
        uFade: { value: 1 },
      },
    });
    const geo = new THREE.PlaneGeometry(N - 1, N - 1, N - 1, N - 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.receiveShadow = false;
  }

  /** Ground colour at sea level, at the highest point, and the colour of water. */
  setColors(base: THREE.Color, high: THREE.Color, water: THREE.Color): void {
    (this.material.uniforms.uBase.value as THREE.Color).copy(base);
    (this.material.uniforms.uHigh.value as THREE.Color).copy(high);
    (this.material.uniforms.uWaterColor.value as THREE.Color).copy(water);
  }

  /** Lift each vertex to its cell's surface height and upload the water mask. */
  setTerrain(t: TerrainView): void {
    const pos = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    let top = 0;
    for (let i = 0; i < N * N; i++) {
      // PlaneGeometry rows run from −z to +z after the rotation, matching cell rows y = 0 … N−1.
      const y = Math.max(t.surface[i], 0) * TERRAIN_UNITS_PER_M;
      pos.setY(i, y);
      top = Math.max(top, y);
      this.waterData[i] = t.water[i] ? 255 : 0;
    }
    pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    this.mesh.geometry.computeBoundingSphere();
    this.material.uniforms.uHeightScale.value = top > 0 ? 1 / top : 0;
    this.waterTexture.needsUpdate = true;
  }

  setOverlay(def: OverlayDef, snap: Snapshot | null): void {
    this.current = def;
    this.material.uniforms.uMode.value = def.kind === 'none' ? 0 : def.kind === 'sequential' ? 1 : 2;
    if (snap) this.update(snap);
    else this.legend = null;
  }

  /** Normalise the active field to 0..1 on the CPU (robust 2–98 % range) and upload it. */
  update(snap: Snapshot): void {
    const def = this.current;
    if (!def.field || def.kind === 'none') {
      this.legend = null;
      return;
    }
    const f = snap[def.field];
    const n = f.length;
    let lo: number;
    let hi: number;
    if (def.range) {
      [lo, hi] = def.range;
      const inv = 1 / (hi - lo);
      for (let i = 0; i < n; i++) this.data[i] = Math.max(0, Math.min(255, Math.round((f[i] - lo) * inv * 255)));
    } else if (def.kind === 'sequential') {
      this.sortBuf.set(f);
      this.sortBuf.sort();
      lo = this.sortBuf[Math.floor(n * 0.02)];
      hi = this.sortBuf[Math.floor(n * 0.98)];
      if (hi - lo < 1e-6) hi = lo + 1e-6;
      const inv = 1 / (hi - lo);
      for (let i = 0; i < n; i++) this.data[i] = Math.max(0, Math.min(255, Math.round((f[i] - lo) * inv * 255)));
    } else {
      const c = def.center ?? 0;
      for (let i = 0; i < n; i++) this.sortBuf[i] = Math.abs(f[i] - c);
      this.sortBuf.sort();
      const m = Math.max(this.sortBuf[Math.floor(n * 0.98)], 1e-6);
      lo = c - m;
      hi = c + m;
      for (let i = 0; i < n; i++) this.data[i] = Math.max(0, Math.min(255, Math.round(((f[i] - c) / m + 1) * 127.5)));
    }
    this.texture.needsUpdate = true;
    this.legend = { kind: def.kind, min: lo, max: hi, unit: def.unit, digits: def.digits ?? 2 };
  }
}
