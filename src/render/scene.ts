import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { N } from '../sim/grid';
import type { NetworkView, Snapshot, TerrainView } from '../sim/types';
import { BuildingLayer } from './buildings';
import { NetworkLayer, type Draft } from './networkLayer';
import { OverlayLayer, OVERLAYS, type Legend, type OverlayId } from './overlays';

const deg = Math.PI / 180;
/** A press that moves less than this many pixels is a click, not a pan. */
const CLICK_SLOP_PX = 5;

export interface MapPointerHandlers {
  /** The cell under the cursor, or null off the map. */
  hover(cell: number | null): void;
  click(cell: number): void;
  dblclick(cell: number): void;
}

/** The tilted 3D map: ground overlay, buildings, camera and controls. */
export class MapScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: MapControls;
  readonly buildings = new BuildingLayer();
  readonly overlay: OverlayLayer;
  readonly network = new NetworkLayer();
  pointer: MapPointerHandlers | null = null;
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private down: { x: number; y: number } | null = null;
  private snapshot: Snapshot | null = null;
  private frame = 0;
  private resizeObserver: ResizeObserver;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 2000);
    this.camera.position.set(0, 95, 105);

    this.controls = new MapControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = false;
    // Tilt limited to 20–70° above the horizon: polar angle from vertical 20–70°.
    this.controls.minPolarAngle = 20 * deg;
    this.controls.maxPolarAngle = 70 * deg;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 260;
    this.controls.target.set(0, 0, 0);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-60, 120, 40);
    this.scene.add(sun);

    this.overlay = new OverlayLayer(new THREE.Color('#d9d4c7'));
    this.overlay.setColors(new THREE.Color('#cfd5b5'), new THREE.Color('#ece6d6'), new THREE.Color('#9cc3de'));
    this.scene.background = new THREE.Color('#eef0f2');
    this.scene.add(this.overlay.mesh);
    this.scene.add(this.buildings.mesh);
    this.scene.add(this.network.group);

    // A thin frame marks the edge of the 12.8 km world.
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(N, N).rotateX(-Math.PI / 2)),
      new THREE.LineBasicMaterial({ color: 0x8a8578 }),
    );
    edge.position.y = 0.02;
    this.scene.add(edge);

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointerleave', this.onPointerLeave);
    el.addEventListener('dblclick', this.onDblClick);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    const tick = () => {
      this.frame = requestAnimationFrame(tick);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  /** A new map: lift the ground and seat the buildings on it. */
  setTerrain(t: TerrainView): void {
    this.overlay.setTerrain(t);
    this.buildings.setTerrain(t);
    this.network.setTerrain(t);
  }

  setNetwork(view: NetworkView): void {
    this.network.setNetwork(view);
  }

  setDraft(d: Draft | null): void {
    this.network.setDraft(d);
  }

  /** The cell under a point on the canvas, or null when the ray misses the ground. */
  cellAt(clientX: number, clientY: number): number | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.overlay.mesh, false)[0];
    if (!hit) return null;
    const x = Math.round(hit.point.x + (N - 1) / 2);
    const y = Math.round(hit.point.z + (N - 1) / 2);
    if (x < 0 || y < 0 || x >= N || y >= N) return null;
    return y * N + x;
  }

  private onPointerDown = (e: PointerEvent) => {
    this.down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.pointer || e.buttons !== 0) return;
    this.pointer.hover(this.cellAt(e.clientX, e.clientY));
  };

  private onPointerUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    if (!this.pointer || !d || e.button !== 0) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP_PX) return;
    const cell = this.cellAt(e.clientX, e.clientY);
    if (cell !== null) this.pointer.click(cell);
  };

  private onPointerLeave = () => {
    this.pointer?.hover(null);
  };

  private onDblClick = (e: MouseEvent) => {
    if (!this.pointer) return;
    const cell = this.cellAt(e.clientX, e.clientY);
    if (cell !== null) this.pointer.dblclick(cell);
  };

  setSnapshot(snap: Snapshot): void {
    this.snapshot = snap;
    this.buildings.update(snap);
    this.overlay.update(snap);
  }

  setOverlay(id: OverlayId): void {
    const def = OVERLAYS.find((o) => o.id === id) ?? OVERLAYS[0];
    this.overlay.setOverlay(def, this.snapshot);
    this.buildings.setFaded(def.kind !== 'none');
  }

  setFlatten(on: boolean): void {
    this.buildings.setFlatten(on);
  }

  get legend(): Legend | null {
    return this.overlay.legend;
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointerleave', this.onPointerLeave);
    el.removeEventListener('dblclick', this.onDblClick);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
  }
}
