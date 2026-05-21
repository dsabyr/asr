// Smart Traffic Light Simulation Engine — multi-lane model
//
// Each road between two adjacent intersections has 2 opposing directions × LANES
// lanes × SEG_CELLS cells = 60 cells per pair of adjacent intersections.
// Cars occupy single cells. Total cells = 100 intersections + 10,800 segment cells.

export const GRID_SIZE = 10;
export const LANES = 3;
export const SEG_CELLS = 10;

// 100 intersection cells + 4 directional segments per pair × LANES × SEG_CELLS each.
// 4 × 10 × 9 × 3 × 10 = 10,800 segment cells.
export const TOTAL_CELLS =
  GRID_SIZE * GRID_SIZE +
  4 * GRID_SIZE * (GRID_SIZE - 1) * LANES * SEG_CELLS;

const DIRS_4 = [
  { dr: -1, dc: 0, dir: 'north' },
  { dr:  1, dc: 0, dir: 'south' },
  { dr:  0, dc: 1, dir: 'east'  },
  { dr:  0, dc:-1, dir: 'west'  },
];

const DEFAULT_PHASE = 12;
const MIN_PHASE = 4;
const MAX_PHASE = 30;
const SAT_FLOW = 3;
const LOST_TIME = 4;

let nextCarId = 1;

// --- Position helpers ---
//
// Two position kinds:
//   intersection cell:  { kind: 'i', ir, ic }
//   road-segment cell:  { kind: 's', fromIr, fromIc, toIr, toIc, lane, pos }
//     - fromIr/fromIc → toIr/toIc encode direction (adjacent intersections)
//     - lane ∈ 0..LANES-1
//     - pos  ∈ 0..SEG_CELLS-1   (0 = just past source, SEG_CELLS-1 = just before dest)

function ipos(ir, ic) {
  return { kind: 'i', ir, ic };
}

function spos(fromIr, fromIc, toIr, toIc, lane, pos) {
  return { kind: 's', fromIr, fromIc, toIr, toIc, lane, pos };
}

export function posKey(p) {
  if (p.kind === 'i') return `i,${p.ir},${p.ic}`;
  return `s,${p.fromIr},${p.fromIc},${p.toIr},${p.toIc},${p.lane},${p.pos}`;
}

export function dirOfSeg(fromIr, fromIc, toIr, toIc) {
  if (toIr < fromIr) return 'north';
  if (toIr > fromIr) return 'south';
  if (toIc > fromIc) return 'east';
  return 'west';
}

// --- Grid + state ---

export function createGrid() {
  const intersections = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    const row = [];
    for (let c = 0; c < GRID_SIZE; c++) {
      row.push({
        row: r,
        col: c,
        phase: (r + c) % 2 === 0 ? 'ns' : 'ew',
        phaseTimer: ((r + c) * 3) % DEFAULT_PHASE,
        phaseDuration: DEFAULT_PHASE,
        hasAccident: false,
        accidentTimer: 0,
      });
    }
    intersections.push(row);
  }
  return intersections;
}

export function createSimState() {
  return {
    grid: createGrid(),
    cars: [],
    tick: 0,
    stats: {
      entered: 0,
      exited: 0,
      totalWaitTime: 0,
      totalTravelTime: 0,
      completedTrips: 0,
      carsInGrid: 0,
      greenCorridorCount: 0,
    },
    accidents: [],
    spawnRate: 3,
    maxCars: 800,
    controlMode: 'standard',
  };
}

// --- Pathfinding (plain BFS with lane changes allowed) ---

// Neighbors of an intersection: pos=0 of any outgoing lane (4 dirs × LANES lanes).
// Neighbors of a segment cell:
//   - forward in same lane (pos+1)
//   - diagonal lane change (pos+1, lane±1) — counts as one tick of movement
//   - exit to downstream intersection when pos = SEG_CELLS-1
function getNeighbors(p) {
  if (p.kind === 'i') {
    const out = [];
    for (const { dr, dc } of DIRS_4) {
      const toIr = p.ir + dr;
      const toIc = p.ic + dc;
      if (toIr < 0 || toIr >= GRID_SIZE || toIc < 0 || toIc >= GRID_SIZE) continue;
      for (let lane = 0; lane < LANES; lane++) {
        out.push(spos(p.ir, p.ic, toIr, toIc, lane, 0));
      }
    }
    return out;
  }
  // Segment cell
  const out = [];
  if (p.pos < SEG_CELLS - 1) {
    out.push(spos(p.fromIr, p.fromIc, p.toIr, p.toIc, p.lane, p.pos + 1));
    if (p.lane > 0) {
      out.push(spos(p.fromIr, p.fromIc, p.toIr, p.toIc, p.lane - 1, p.pos + 1));
    }
    if (p.lane < LANES - 1) {
      out.push(spos(p.fromIr, p.fromIc, p.toIr, p.toIc, p.lane + 1, p.pos + 1));
    }
  } else {
    out.push(ipos(p.toIr, p.toIc));
  }
  return out;
}

function isPosBlocked(grid, p) {
  // Only intersection cells with active accidents are blocked.
  return p.kind === 'i' && grid[p.ir][p.ic].hasAccident;
}

// --- Min-heap for A* open set ---
class MinHeap {
  constructor() { this.data = []; }
  size() { return this.data.length; }
  push(item) {
    this.data.push(item);
    let i = this.data.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.data[parent].f <= this.data[i].f) break;
      [this.data[parent], this.data[i]] = [this.data[i], this.data[parent]];
      i = parent;
    }
  }
  pop() {
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length > 0) {
      this.data[0] = last;
      let i = 0;
      const n = this.data.length;
      while (true) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let smallest = i;
        if (l < n && this.data[l].f < this.data[smallest].f) smallest = l;
        if (r < n && this.data[r].f < this.data[smallest].f) smallest = r;
        if (smallest === i) break;
        [this.data[smallest], this.data[i]] = [this.data[i], this.data[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

// Lower-bound cost between two intersections (Manhattan × cost-per-hop).
// Each adjacent intersection-to-intersection move costs SEG_CELLS + 1 path steps.
const HOP_COST = SEG_CELLS + 1;
function heuristic(p, destIr, destIc) {
  if (p.kind === 'i') {
    return (Math.abs(p.ir - destIr) + Math.abs(p.ic - destIc)) * HOP_COST;
  }
  // From a segment cell: cost to reach the segment's downstream intersection,
  // plus a Manhattan lower bound from there.
  return (SEG_CELLS - p.pos) +
    (Math.abs(p.toIr - destIr) + Math.abs(p.toIc - destIc)) * HOP_COST;
}

export function findPath(grid, start, end) {
  const startKey = posKey(start);
  const endKey = posKey(end);
  if (startKey === endKey) return [start];

  // The heuristic anchors to the destination intersection (callers always
  // route to an edge intersection — see spawnCar / reroute paths).
  const destIr = end.kind === 'i' ? end.ir : end.toIr;
  const destIc = end.kind === 'i' ? end.ic : end.toIc;

  const closed = new Set();
  const parent = new Map();
  const gScore = new Map();
  const open = new MinHeap();

  gScore.set(startKey, 0);
  open.push({ pos: start, key: startKey, f: heuristic(start, destIr, destIc) });

  while (open.size() > 0) {
    const { pos: cur, key: curKey } = open.pop();
    if (closed.has(curKey)) continue;
    closed.add(curKey);

    if (curKey === endKey) {
      const path = [cur];
      let prev = parent.get(curKey);
      while (prev) {
        path.unshift(prev);
        prev = parent.get(posKey(prev));
      }
      return path;
    }

    const curG = gScore.get(curKey);
    for (const n of getNeighbors(cur)) {
      const nk = posKey(n);
      if (closed.has(nk)) continue;
      if (isPosBlocked(grid, n)) continue;
      const tentativeG = curG + 1;
      const prevG = gScore.get(nk);
      if (prevG === undefined || tentativeG < prevG) {
        gScore.set(nk, tentativeG);
        parent.set(nk, cur);
        open.push({ pos: n, key: nk, f: tentativeG + heuristic(n, destIr, destIc) });
      }
    }
  }
  return null;
}

// --- Spawning ---

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildEdgeIntersections() {
  const edges = [];
  for (let i = 0; i < GRID_SIZE; i++) {
    edges.push(ipos(0, i));
    edges.push(ipos(GRID_SIZE - 1, i));
    if (i !== 0 && i !== GRID_SIZE - 1) {
      edges.push(ipos(i, 0));
      edges.push(ipos(i, GRID_SIZE - 1));
    }
  }
  return edges;
}

function buildInteriorPositions() {
  const positions = [];
  for (let r = 1; r < GRID_SIZE - 1; r++) {
    for (let c = 1; c < GRID_SIZE - 1; c++) {
      positions.push(ipos(r, c));
    }
  }
  for (let fromIr = 0; fromIr < GRID_SIZE; fromIr++) {
    for (let fromIc = 0; fromIc < GRID_SIZE; fromIc++) {
      for (const { dr, dc } of DIRS_4) {
        const toIr = fromIr + dr;
        const toIc = fromIc + dc;
        if (toIr < 0 || toIr >= GRID_SIZE || toIc < 0 || toIc >= GRID_SIZE) continue;
        for (let lane = 0; lane < LANES; lane++) {
          for (let pos = 0; pos < SEG_CELLS; pos++) {
            positions.push(spos(fromIr, fromIc, toIr, toIc, lane, pos));
          }
        }
      }
    }
  }
  return positions;
}

const EDGE_INTERSECTIONS = buildEdgeIntersections();
const INTERIOR_POSITIONS = buildInteriorPositions();

function spawnCar(state, occupied) {
  if (state.cars.length >= (state.maxCars ?? TOTAL_CELLS)) return null;

  // 60% interior, 40% edge. Sample ~120 candidates from the primary pool
  // (BFS is the expensive step; a full shuffle of 10,800+ positions would dwarf it).
  const useInterior = Math.random() < 0.6;
  const primaryPool = useInterior ? INTERIOR_POSITIONS : EDGE_INTERSECTIONS;
  const fallbackPool = useInterior ? EDGE_INTERSECTIONS : INTERIOR_POSITIONS;

  const tryStart = (start) => {
    const startKey = posKey(start);
    if (occupied.has(startKey)) return null;
    if (isPosBlocked(state.grid, start)) return null;

    const dest = EDGE_INTERSECTIONS[Math.floor(Math.random() * EDGE_INTERSECTIONS.length)];
    if (start.kind === 'i' && start.ir === dest.ir && start.ic === dest.ic) return null;

    const path = findPath(state.grid, start, dest);
    if (!path || path.length < 2) return null;

    return {
      id: nextCarId++,
      path,
      pathIndex: 0,
      pos: start,
      destIr: dest.ir,
      destIc: dest.ic,
      waiting: false,
      waitTime: 0,
      travelTime: 0,
    };
  };

  // Try a bounded sample from the primary pool, then the full fallback.
  const sample = (pool, n) => {
    const picks = [];
    const len = pool.length;
    for (let i = 0; i < n; i++) {
      picks.push(pool[Math.floor(Math.random() * len)]);
    }
    return picks;
  };

  const candidates = [
    ...sample(primaryPool, 60),
    ...shuffle([...fallbackPool]),
  ];

  for (const start of candidates) {
    const car = tryStart(start);
    if (car) return car;
  }
  return null;
}

// --- Tick ---

function canPass(intersection, direction) {
  if (intersection.hasAccident) return false;
  const isNS = direction === 'north' || direction === 'south';
  return (isNS && intersection.phase === 'ns') || (!isNS && intersection.phase === 'ew');
}

export function simulateTick(state) {
  const grid = state.grid.map((row) => row.map((cell) => ({ ...cell })));
  const cars = state.cars.map((c) => ({ ...c, path: c.path }));
  const stats = { ...state.stats, greenCorridorCount: 0 };
  let accidents = [...state.accidents];
  const tick = state.tick + 1;

  // NS/EW waiting queues (only cars held at an intersection, about to leave it).
  const nsQueue = {};
  const ewQueue = {};
  if (state.controlMode !== 'standard') {
    for (const car of state.cars) {
      if (!car.waiting) continue;
      const cur = car.pos;
      if (cur.kind !== 'i') continue;
      if (car.pathIndex >= car.path.length - 1) continue;
      const next = car.path[car.pathIndex + 1];
      if (next.kind !== 's') continue;
      const dir = dirOfSeg(cur.ir, cur.ic, next.toIr, next.toIc);
      const key = `${cur.ir}-${cur.ic}`;
      if (dir === 'north' || dir === 'south') nsQueue[key] = (nsQueue[key] || 0) + 1;
      else ewQueue[key] = (ewQueue[key] || 0) + 1;
    }
  }

  // --- Traffic light phases ---
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const inter = grid[r][c];

      if (inter.hasAccident) {
        inter.accidentTimer--;
        if (inter.accidentTimer <= 0) {
          inter.hasAccident = false;
          inter.accidentTimer = 0;
          inter.phaseDuration = DEFAULT_PHASE;
          accidents = accidents.filter((a) => !(a.row === r && a.col === c));
        }
        continue;
      }

      if (state.controlMode === 'adaptive' && inter.phaseTimer >= MIN_PHASE) {
        const key = `${r}-${c}`;
        const greenQ = inter.phase === 'ns' ? (nsQueue[key] || 0) : (ewQueue[key] || 0);
        const redQ   = inter.phase === 'ns' ? (ewQueue[key] || 0) : (nsQueue[key] || 0);
        if (greenQ === 0 && redQ > 0) {
          inter.phaseTimer = inter.phaseDuration - 1;
        }
      }

      inter.phaseTimer++;
      if (inter.phaseTimer >= inter.phaseDuration) {
        inter.phaseTimer = 0;
        inter.phase = inter.phase === 'ns' ? 'ew' : 'ns';

        const key = `${r}-${c}`;
        if (state.controlMode === 'webster') {
          const qNS = nsQueue[key] || 0;
          const qEW = ewQueue[key] || 0;
          const yNS = Math.min(qNS / SAT_FLOW, 0.45);
          const yEW = Math.min(qEW / SAT_FLOW, 0.45);
          const Y   = Math.min(yNS + yEW, 0.9);
          const C   = Math.max(MIN_PHASE * 2, Math.min(MAX_PHASE * 2,
                        Math.round((1.5 * LOST_TIME + 5) / (1 - Y))));
          const green = C - LOST_TIME;
          const total = yNS + yEW || 1;
          const nsG = Math.max(MIN_PHASE, Math.round(green * yNS / total));
          const ewG = Math.max(MIN_PHASE, Math.round(green * yEW / total));
          inter.phaseDuration = inter.phase === 'ns' ? nsG : ewG;
        } else if (state.controlMode === 'adaptive') {
          const inQ  = inter.phase === 'ns' ? (nsQueue[key] || 0) : (ewQueue[key] || 0);
          const outQ = inter.phase === 'ns' ? (ewQueue[key] || 0) : (nsQueue[key] || 0);
          const total = inQ + outQ || 1;
          const ratio = inQ / total;
          inter.phaseDuration = Math.max(MIN_PHASE,
            Math.min(MAX_PHASE, Math.round(MIN_PHASE + ratio * (MAX_PHASE - MIN_PHASE))));
        }
      }
    }
  }

  // --- Move cars ---
  const carsToRemove = new Set();
  // One car per cell. Pre-seed with every occupied cell; moving cars delete
  // their old cell so followers can advance into the vacated spot this tick.
  const nextOccupied = new Set(cars.map((c) => posKey(c.pos)));

  const order = [...Array(cars.length).keys()].sort(
    (a, b) => cars[b].pathIndex - cars[a].pathIndex
  );

  for (const i of order) {
    const car = cars[i];
    car.travelTime++;

    if (car.pathIndex >= car.path.length - 1) {
      carsToRemove.add(i);
      stats.exited++;
      stats.completedTrips++;
      stats.totalTravelTime += car.travelTime;
      stats.totalWaitTime += car.waitTime;
      nextOccupied.delete(posKey(car.pos));
      continue;
    }

    if (car.pathIndex < 0 || car.pathIndex >= car.path.length) {
      console.warn(`Car ${car.id}: pathIndex ${car.pathIndex} out of bounds (path.length=${car.path.length})`);
      carsToRemove.add(i);
      nextOccupied.delete(posKey(car.pos));
      continue;
    }

    const current = car.path[car.pathIndex];
    const next    = car.path[car.pathIndex + 1];
    const curKey  = posKey(current);
    const nextKey = posKey(next);

    // Reroute when the next position is an intersection blocked by accident.
    if (next.kind === 'i' && grid[next.ir][next.ic].hasAccident) {
      const dest = ipos(car.destIr, car.destIc);
      const newPath = findPath(grid, current, dest);
      if (newPath && newPath.length >= 2) {
        cars[i] = { ...car, path: newPath, pathIndex: 0, pos: current, waiting: true };
        cars[i].waitTime++;
      } else {
        car.waiting = true;
        car.waitTime++;
      }
      continue;
    }

    // Traffic light check fires only when leaving an intersection.
    let lightGreen = true;
    if (current.kind === 'i' && next.kind === 's') {
      const dir = dirOfSeg(current.ir, current.ic, next.toIr, next.toIc);
      lightGreen = canPass(grid[current.ir][current.ic], dir);
    }
    const nextFree = !nextOccupied.has(nextKey);

    if (lightGreen && nextFree) {
      nextOccupied.delete(curKey);
      car.pathIndex++;
      car.pos = next;
      car.waiting = false;
      nextOccupied.add(nextKey);
      stats.greenCorridorCount = (stats.greenCorridorCount || 0) + 1;
    } else {
      car.waiting = true;
      car.waitTime++;
    }
  }

  const remainingCars = cars.filter((_, i) => !carsToRemove.has(i));

  const newState = {
    grid,
    cars: remainingCars,
    tick,
    stats,
    accidents,
    spawnRate: state.spawnRate,
    maxCars: state.maxCars,
    controlMode: state.controlMode,
  };

  // --- Spawn new cars ---
  const spawnOccupied = new Set(remainingCars.map((c) => posKey(c.pos)));
  for (let i = 0; i < state.spawnRate; i++) {
    if (Math.random() < 0.5) {
      const car = spawnCar(newState, spawnOccupied);
      if (car) {
        spawnOccupied.add(posKey(car.pos));
        newState.cars.push(car);
        newState.stats.entered++;
      }
    }
  }

  newState.stats.carsInGrid = newState.cars.length;
  return newState;
}

// --- Accidents ---

export function addAccident(state, row, col) {
  if (row < 0 || row >= GRID_SIZE || col < 0 || col >= GRID_SIZE) return state;

  const grid = state.grid.map((r) => r.map((cell) => ({ ...cell })));
  const inter = grid[row][col];
  let accidents = [...state.accidents];
  let cars = state.cars.map((c) => ({ ...c, path: c.path }));

  if (inter.hasAccident) {
    inter.hasAccident = false;
    inter.accidentTimer = 0;
    inter.phaseDuration = DEFAULT_PHASE;
    accidents = accidents.filter((a) => !(a.row === row && a.col === col));
  } else {
    inter.hasAccident = true;
    inter.accidentTimer = 80;
    accidents.push({ row, col, timer: 80 });

    for (const { dr, dc } of DIRS_4) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE) {
        grid[nr][nc].phaseDuration = Math.max(6, grid[nr][nc].phaseDuration - 4);
      }
    }

    // Reroute cars whose remaining path passes through the blocked intersection.
    cars = cars.map((car) => {
      const passesThrough = car.path.slice(car.pathIndex + 1).some(
        (p) => p.kind === 'i' && p.ir === row && p.ic === col
      );
      if (!passesThrough) return car;

      const current = car.path[car.pathIndex];
      const dest = ipos(car.destIr, car.destIc);
      const newPath = findPath(grid, current, dest);
      if (newPath && newPath.length >= 2) {
        return { ...car, path: newPath, pathIndex: 0, pos: current };
      }
      return car;
    });
  }

  return { ...state, grid, accidents, cars };
}

// Clear every active accident in one shot (used by Scenario mode for the
// Phase A → Phase B reset). Idempotent: no-op when no accidents are active.
export function clearAccidents(state) {
  if (state.accidents.length === 0) return state;
  const grid = state.grid.map((row) =>
    row.map((cell) => {
      if (!cell.hasAccident) return cell;
      return { ...cell, hasAccident: false, accidentTimer: 0, phaseDuration: DEFAULT_PHASE };
    })
  );
  return { ...state, grid, accidents: [] };
}
