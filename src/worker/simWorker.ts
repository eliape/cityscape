/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import { Simulation } from '../sim/simulation';
import { defaultParams, type ParamName, type Params } from '../sim/params';
import { SNAPSHOT_FIELDS, type Snapshot, type Stats, type TerrainView } from '../sim/types';

export type Speed = 1 | 4 | 16;

export interface WorkerEvents {
  terrain(t: TerrainView): void;
  snapshot(s: Snapshot): void;
  stats(s: Stats): void;
}

/** Snapshots go out at most this often (spec: ≤ 10 per second). */
const SNAPSHOT_INTERVAL_MS = 100;
/** Never run more than this many months in one loop turn, so commands stay responsive. */
const MAX_MONTHS_PER_TURN = 4;

/**
 * Owns the simulation state, runs the tick loop and applies commands.
 * 1× is one simulated month per second; 4× and 16× multiply that.
 */
class SimWorker {
  private sim = new Simulation(1);
  private events: WorkerEvents | null = null;
  private playing = false;
  private speed: Speed = 1;
  private due = 0; // months owed to the clock
  private lastClock = 0;
  private lastSnapshot = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private snapshotPending = false;

  connect(events: WorkerEvents): void {
    this.events = events;
    this.publishTerrain();
    this.publish(true);
  }

  play(): void {
    if (this.playing) return;
    this.playing = true;
    this.lastClock = performance.now();
    this.due = 1; // advance right away so the click feels immediate
    this.schedule(0);
  }

  pause(): void {
    this.playing = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.publish(true);
  }

  setSpeed(speed: Speed): void {
    this.speed = speed;
  }

  setParam(name: ParamName, value: number): void {
    if (!(name in defaultParams) || !Number.isFinite(value)) return;
    this.sim.setParam(name, value);
    if (!this.playing) {
      this.sim.refresh();
      this.publish(true);
    }
  }

  getParams(): Params {
    return { ...this.sim.params };
  }

  reset(seed: number, params?: Partial<Params>): void {
    if (params) Object.assign(this.sim.params, params);
    this.sim.reset(seed >>> 0);
    this.due = 0;
    this.lastClock = performance.now();
    this.publishTerrain();
    this.publish(true);
  }

  private publishTerrain(): void {
    if (!this.events) return;
    const t: TerrainView = { surface: this.sim.terrain.surface.slice(), water: this.sim.terrain.water.slice() };
    this.events.terrain(Comlink.transfer(t, [t.surface.buffer as ArrayBuffer, t.water.buffer as ArrayBuffer]));
  }

  private schedule(ms: number): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.loop(), ms);
  }

  private loop(): void {
    this.timer = null;
    if (!this.playing) return;
    const now = performance.now();
    this.due += ((now - this.lastClock) / 1000) * this.speed;
    this.lastClock = now;
    // If we fell far behind (a long fast-layer solve), drop the backlog rather than spiralling.
    this.due = Math.min(this.due, MAX_MONTHS_PER_TURN);
    let ran = 0;
    while (this.due >= 1 && ran < MAX_MONTHS_PER_TURN) {
      this.sim.step();
      this.due -= 1;
      ran++;
      this.events?.stats(this.sim.stats());
    }
    if (ran > 0) this.publish(false);
    else if (this.snapshotPending) this.publish(false);
    const msPerMonth = 1000 / this.speed;
    this.schedule(Math.max(0, Math.min(msPerMonth * (1 - this.due), 50)));
  }

  private publish(force: boolean): void {
    if (!this.events) return;
    const now = performance.now();
    if (!force && now - this.lastSnapshot < SNAPSHOT_INTERVAL_MS) {
      this.snapshotPending = true;
      return;
    }
    this.snapshotPending = false;
    this.lastSnapshot = now;
    const snap = this.sim.snapshot();
    const buffers = SNAPSHOT_FIELDS.map((k) => snap[k].buffer as ArrayBuffer);
    this.events.snapshot(Comlink.transfer(snap, buffers));
    this.events.stats(this.sim.stats());
  }
}

export type SimWorkerApi = SimWorker;

Comlink.expose(new SimWorker());
