import { CELL_M } from '../sim/grid';

/** World units are cells. Terrain is drawn with this vertical exaggeration so 100 m hills read on a 12.8 km map. */
export const TERRAIN_EXAGGERATION = 4;
export const TERRAIN_UNITS_PER_M = TERRAIN_EXAGGERATION / CELL_M;
