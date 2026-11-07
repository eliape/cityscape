import { N } from '../sim/grid';
import { pathLength, railBetween, railThrough } from '../sim/metro';
import type { Draft } from '../render/networkLayer';

/** Spec range for metro stop spacing, m. */
export const METRO_SPACING: [number, number] = [800, 1500];
/** A click this many cells from the rail still snaps a station onto it. */
const SNAP_CELLS = 3;

/** The metro tool: first lay the rail point by point, then click stations onto it. */
export interface LineToolState {
  phase: 'rail' | 'stations';
  points: number[]; // clicked rail points, cells
  stations: number[]; // indices into the rail path, increasing
}

export const startTool = (): LineToolState => ({ phase: 'rail', points: [], stations: [] });

export function toolPath(t: LineToolState): number[] {
  return railThrough(t.points);
}

/** Nearest rail position to a cell, within SNAP_CELLS; −1 if none. */
export function snapToRail(path: readonly number[], cell: number): number {
  const x = cell % N;
  const y = (cell / N) | 0;
  let best = -1;
  let bestD = Infinity;
  for (let k = 0; k < path.length; k++) {
    const dx = (path[k] % N) - x;
    const dy = ((path[k] / N) | 0) - y;
    const d = dx * dx + dy * dy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) <= SNAP_CELLS && d < bestD) {
      best = k;
      bestD = d;
    }
  }
  return best;
}

/** Add a station at rail position k, or remove it if there is one. */
export function toggleStation(stations: readonly number[], k: number): number[] {
  if (stations.includes(k)) return stations.filter((s) => s !== k);
  return [...stations, k].sort((a, b) => a - b);
}

/** Moving from rail to stations: put stations at both ends of the rail where there is land. */
export function endStations(path: readonly number[], water: Uint8Array | null): number[] {
  const ends = [0, path.length - 1].filter((k, i, a) => a.indexOf(k) === i);
  return ends.filter((k) => !water || !water[path[k]]);
}

export function draftOf(t: LineToolState, hover: number | null): Draft {
  const path = toolPath(t);
  let ghostRail: number[] = [];
  let ghostStation: number | null = null;
  if (hover !== null) {
    if (t.phase === 'rail' && t.points.length > 0) ghostRail = railBetween(t.points[t.points.length - 1], hover);
    if (t.phase === 'stations') {
      const k = snapToRail(path, hover);
      if (k >= 0 && !t.stations.includes(k)) ghostStation = path[k];
    }
  }
  return { path, stations: t.stations, ghostRail, ghostStation };
}

export interface ToolSummary {
  lengthM: number;
  stationCount: number;
  tooClose: number; // gaps shorter than the spec range
  tooFar: number; // gaps longer than the spec range
}

export function summarise(t: LineToolState): ToolSummary {
  const path = toolPath(t);
  let tooClose = 0;
  let tooFar = 0;
  for (let s = 0; s + 1 < t.stations.length; s++) {
    const m = pathLength(path, t.stations[s], t.stations[s + 1]);
    if (m < METRO_SPACING[0]) tooClose++;
    else if (m > METRO_SPACING[1]) tooFar++;
  }
  return { lengthM: pathLength(path), stationCount: t.stations.length, tooClose, tooFar };
}
