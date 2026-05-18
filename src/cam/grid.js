import { GRID_SIZE, LANES, SEG_CELLS, INTER_CELLS, TURN_POCKET,
         DEFAULT_GREEN_NS, DEFAULT_GREEN_EW, VMAX } from './constants.js';

export function createCAMGrid() {
  const intersections = [];
  for (let iy = 0; iy < GRID_SIZE; iy++) {
    const row = [];
    for (let ix = 0; ix < GRID_SIZE; ix++) {
      row.push(createIntersection(ix, iy));
    }
    intersections.push(row);
  }

  const segments = new Map();
  for (let iy = 0; iy < GRID_SIZE; iy++) {
    for (let ix = 0; ix < GRID_SIZE; ix++) {
      if (ix < GRID_SIZE - 1) {
        segments.set(segKey(ix, iy, ix+1, iy), createSegment(ix, iy, ix+1, iy, 'EW'));
        segments.set(segKey(ix+1, iy, ix, iy), createSegment(ix+1, iy, ix, iy, 'WE'));
      }
      if (iy < GRID_SIZE - 1) {
        segments.set(segKey(ix, iy, ix, iy+1), createSegment(ix, iy, ix, iy+1, 'NS'));
        segments.set(segKey(ix, iy+1, ix, iy), createSegment(ix, iy+1, ix, iy, 'SN'));
      }
    }
  }

  return { intersections, segments, tick: 0 };
}

function createIntersection(ix, iy) {
  return {
    ix, iy,
    grid: Array.from({ length: INTER_CELLS }, () => new Int8Array(INTER_CELLS).fill(-1)),
    pocketNS: new Int8Array(TURN_POCKET).fill(-1),
    pocketEW: new Int8Array(TURN_POCKET).fill(-1),
    phase: 'NS',
    localTick: Math.floor(Math.random() * 60),
    greenNS: DEFAULT_GREEN_NS + Math.floor(Math.random() * 16),
    greenEW: DEFAULT_GREEN_EW + Math.floor(Math.random() * 12),
    queueNS: 0,
    queueEW: 0,
    hasAccident: false,
  };
}

function createSegment(fx, fy, tx, ty, dir) {
  return {
    fx, fy, tx, ty, dir,
    cells: Array.from({ length: LANES }, () => new Int8Array(SEG_CELLS).fill(-1)),
    incident: false,
    incidentCell: Math.floor(SEG_CELLS / 2),
  };
}

export function segKey(fx, fy, tx, ty) {
  return `${fx},${fy}-${tx},${ty}`;
}

export function getSeg(grid, fx, fy, tx, ty) {
  return grid.segments.get(segKey(fx, fy, tx, ty));
}

export function getDownstream(grid, seg) {
  const { tx, ty, dir } = seg;
  if (dir === 'EW' && tx < GRID_SIZE-1) return getSeg(grid, tx, ty, tx+1, ty);
  if (dir === 'WE' && tx > 0)           return getSeg(grid, tx, ty, tx-1, ty);
  if (dir === 'NS' && ty < GRID_SIZE-1) return getSeg(grid, tx, ty, tx, ty+1);
  if (dir === 'SN' && ty > 0)           return getSeg(grid, tx, ty, tx, ty-1);
  return null;
}

export function seedVehicles(camGrid, densityPct) {
  const p = Math.min(densityPct, 35) / 100;
  for (const seg of camGrid.segments.values()) {
    for (let lane = 0; lane < LANES; lane++) {
      seg.cells[lane].fill(-1);
      for (let i = 0; i < SEG_CELLS; i++) {
        if (Math.random() < p) {
          seg.cells[lane][i] = Math.floor(Math.random() * (VMAX + 1));
        }
      }
    }
  }
  for (const row of camGrid.intersections) {
    for (const inter of row) {
      inter.pocketNS.fill(-1);
      inter.pocketEW.fill(-1);
      for (let r = 0; r < INTER_CELLS; r++) inter.grid[r].fill(-1);
    }
  }
}

export function syncAccidents(camGrid, mainGrid) {
  for (let iy = 0; iy < GRID_SIZE; iy++) {
    for (let ix = 0; ix < GRID_SIZE; ix++) {
      camGrid.intersections[iy][ix].hasAccident = mainGrid[iy][ix].hasAccident;
    }
  }
}
