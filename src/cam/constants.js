export const GRID_SIZE   = 10;
export const LANES       = 3;
export const SEG_CELLS   = 10;
export const INTER_CELLS = 6;
export const TURN_POCKET = 2;
export const VMAX        = 3;
export const P_RAND      = 0.28;
export const CELL_M      = 7.5;

export const CELL_PX     = 14;
export const INTER_PX    = INTER_CELLS * CELL_PX;
export const SEG_PX      = SEG_CELLS   * CELL_PX;
export const ROAD_PX     = LANES       * CELL_PX;
export const WORLD_STEP  = INTER_PX + SEG_PX;
export const WORLD_W     = WORLD_STEP * GRID_SIZE + INTER_PX;
export const WORLD_H     = WORLD_W;

export const DEFAULT_GREEN_NS = 30;
export const DEFAULT_GREEN_EW = 20;
export const YELLOW_TICKS     = 2;

export const WAVE_OFFSET = 9;

export const ARRIVAL_WINDOW  = 60;
export const TICKS_PER_HOUR  = 3600;
