// Smart Traffic Light Simulation Engine — multi-lane model with internal
// intersection grid (P1).
//
// Each intersection now has an internal LANES × LANES grid of cells, so
// non-conflicting movements (e.g. straight-through on different lanes) can
// pass in parallel. Previously the whole intersection was a single cell and
// per-direction discharge was capped at 1 car/tick × green_fraction.
//
// Each road between two adjacent intersections still has 2 opposing
// directions × LANES lanes × SEG_CELLS cells.

export const GRID_SIZE = 10;
export const LANES = 3;
export const SEG_CELLS = 10;

// 900 internal intersection cells (100 intersections × LANES²)
// + 10,800 segment cells (4 × 10 × 9 × 3 × 10).
export const TOTAL_CELLS =
  GRID_SIZE * GRID_SIZE * LANES * LANES +
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
const SAT_FLOW = 30;
const LOST_TIME = 4;
const CLEARANCE_TICKS = 2;
const EMA_ALPHA = 0.2;
// Above this fraction of grid cells occupied, spawn probability decays
// linearly to zero. Without this the slider can ask for more demand than
// the grid can physically discharge and the system gridlocks regardless of
// signal policy.
const THROTTLE_DENSITY = 0.25;
// Cars recompute their path every REROUTE_INTERVAL ticks using current
// segment occupancy as edge weight, so demand spreads across the network
// instead of piling on whatever shortest path A* picked at spawn.
const REROUTE_INTERVAL = 40;
const LOAD_PENALTY = 20;
const SEG_CAPACITY = LANES * SEG_CELLS;
// Cars that have been waiting for MAX_WAIT consecutive ticks despawn,
// modeling a driver giving up / taking a detour off-grid. Without this a
// gridlock that forms once stays forever — there's no organic decay back
// to flow because nothing reduces demand once it's stuck.
const MAX_WAIT = 200;

let nextCarId = 1;

// --- Position helpers ---
//
// Position kinds:
//   internal intersection cell:  { kind: 'x', ir, ic, ix, iy }
//     - ix, iy ∈ 0..LANES-1, addressing the LANES×LANES internal grid of
//       intersection (ir, ic). Cars occupy 'x' cells one-at-a-time.
//   road-segment cell:           { kind: 's', fromIr, fromIc, toIr, toIc, lane, pos }
//     - fromIr/fromIc → toIr/toIc encode direction (adjacent intersections)
//     - lane ∈ 0..LANES-1
//     - pos  ∈ 0..SEG_CELLS-1   (0 = just past source, SEG_CELLS-1 = just before dest)
//   logical intersection ref:    { kind: 'i', ir, ic }
//     - NOT occupiable. Used only as a findPath endpoint meaning "any 'x'
//       cell of this intersection." Kept for caller ergonomics so spawn
//       destinations can still be expressed as an intersection.
//
// Lane↔internal mapping convention (looking at intersection from above with
// iy=0 = north edge, iy=LANES-1 = south edge, ix=0 = west, ix=LANES-1 = east):
//   - Northbound (entering from south): entry at (lane, LANES-1).
//   - Southbound (entering from north): entry at (lane, 0).
//   - Eastbound  (entering from west):  entry at (0, lane).
//   - Westbound  (entering from east):  entry at (LANES-1, lane).
// Exits mirror: e.g. ix=LANES-1 cells can exit east on lane=iy.

function ipos(ir, ic) {
  return { kind: 'i', ir, ic };
}

function xpos(ir, ic, ix, iy) {
  return { kind: 'x', ir, ic, ix, iy };
}

function spos(fromIr, fromIc, toIr, toIc, lane, pos) {
  return { kind: 's', fromIr, fromIc, toIr, toIc, lane, pos };
}

export function posKey(p) {
  if (p.kind === 'x') return `x,${p.ir},${p.ic},${p.ix},${p.iy}`;
  if (p.kind === 'i') return `i,${p.ir},${p.ic}`;
  return `s,${p.fromIr},${p.fromIc},${p.toIr},${p.toIc},${p.lane},${p.pos}`;
}

// Entry 'x' cell for a car arriving from segment `seg` at pos=SEG_CELLS-1.
function segEntryCell(seg) {
  const dir = dirOfSeg(seg.fromIr, seg.fromIc, seg.toIr, seg.toIc);
  switch (dir) {
    case 'north': return xpos(seg.toIr, seg.toIc, seg.lane, LANES - 1);
    case 'south': return xpos(seg.toIr, seg.toIc, seg.lane, 0);
    case 'east':  return xpos(seg.toIr, seg.toIc, 0, seg.lane);
    case 'west':  return xpos(seg.toIr, seg.toIc, LANES - 1, seg.lane);
  }
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
        qNS_ema: 0,
        qEW_ema: 0,
        clearing: false,
        clearanceTimer: 0,
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
      density: 0,
      spawnThrottled: false,
      abandoned: 0,
    },
    accidents: [],
    spawnRate: 3,
    maxCars: 800,
    controlMode: 'standard',
  };
}

// --- Pathfinding (A* with lane changes and internal-intersection routing) ---

// Neighbors of an internal 'x' cell:
//   - orthogonal step to another internal cell (cost 1)
//   - if at an edge of the internal grid, exit onto pos=0 of outbound segment
// Neighbors of a segment cell:
//   - forward in same lane (pos+1)
//   - diagonal lane change (pos+1, lane±1) — one tick of movement
//   - at pos=SEG_CELLS-1, enter the downstream intersection's entry 'x' cell
//     for this segment's lane and direction
function getNeighbors(p) {
  const out = [];
  if (p.kind === 'x') {
    // Internal orthogonal moves
    if (p.ix > 0)         out.push(xpos(p.ir, p.ic, p.ix - 1, p.iy));
    if (p.ix < LANES - 1) out.push(xpos(p.ir, p.ic, p.ix + 1, p.iy));
    if (p.iy > 0)         out.push(xpos(p.ir, p.ic, p.ix, p.iy - 1));
    if (p.iy < LANES - 1) out.push(xpos(p.ir, p.ic, p.ix, p.iy + 1));
    // Exit to outbound segments (only at the matching edge cell for that direction)
    if (p.iy === 0 && p.ir > 0) {
      out.push(spos(p.ir, p.ic, p.ir - 1, p.ic, p.ix, 0));   // north out, lane = ix
    }
    if (p.iy === LANES - 1 && p.ir < GRID_SIZE - 1) {
      out.push(spos(p.ir, p.ic, p.ir + 1, p.ic, p.ix, 0));   // south out
    }
    if (p.ix === 0 && p.ic > 0) {
      out.push(spos(p.ir, p.ic, p.ir, p.ic - 1, p.iy, 0));   // west out, lane = iy
    }
    if (p.ix === LANES - 1 && p.ic < GRID_SIZE - 1) {
      out.push(spos(p.ir, p.ic, p.ir, p.ic + 1, p.iy, 0));   // east out
    }
    return out;
  }
  // Segment cell
  if (p.pos < SEG_CELLS - 1) {
    out.push(spos(p.fromIr, p.fromIc, p.toIr, p.toIc, p.lane, p.pos + 1));
    if (p.lane > 0) {
      out.push(spos(p.fromIr, p.fromIc, p.toIr, p.toIc, p.lane - 1, p.pos + 1));
    }
    if (p.lane < LANES - 1) {
      out.push(spos(p.fromIr, p.fromIc, p.toIr, p.toIc, p.lane + 1, p.pos + 1));
    }
  } else {
    out.push(segEntryCell(p));
  }
  return out;
}

function isPosBlocked(grid, p) {
  // Accident blocks the whole intersection — every internal cell.
  if (p.kind === 'x') return grid[p.ir][p.ic].hasAccident;
  // 'i' is a logical reference, not occupiable, so isPosBlocked never gets
  // it as a real neighbor — but keep the check defensive.
  if (p.kind === 'i') return grid[p.ir][p.ic].hasAccident;
  return false;
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
// Crossing one intersection-to-the-next requires at least SEG_CELLS forward
// steps + 1 entry step into the destination's internal cell. Internal moves
// inside an intersection are bounded below by 0 (entry cell might already
// be an exit cell), so HOP_COST = SEG_CELLS + 1 remains admissible.
const HOP_COST = SEG_CELLS + 1;
function heuristic(p, destIr, destIc) {
  if (p.kind === 'x' || p.kind === 'i') {
    return (Math.abs(p.ir - destIr) + Math.abs(p.ic - destIc)) * HOP_COST;
  }
  // Segment cell: cost to reach the segment's downstream intersection
  // (= SEG_CELLS - pos), plus Manhattan lower bound from there.
  return (SEG_CELLS - p.pos) +
    (Math.abs(p.toIr - destIr) + Math.abs(p.toIc - destIc)) * HOP_COST;
}

// Edge cost when stepping into position `n`. Without `segmentLoad`, uniform 1
// (preserves old behavior for callers that don't pass it). With a load map,
// stepping into a segment cell costs more proportionally to how full that
// segment is — quadratic so heavy congestion is strongly avoided but light
// congestion barely matters. Internal 'x' and logical 'i' entries always
// cost 1 (we don't want to penalize crossings, only choice of segment).
function edgeCost(n, segmentLoad) {
  if (!segmentLoad || n.kind !== 's') return 1;
  const segKey = `${n.fromIr},${n.fromIc},${n.toIr},${n.toIc}`;
  const load = (segmentLoad[segKey] || 0) / SEG_CAPACITY;
  return 1 + LOAD_PENALTY * load * load;
}

// Sum of edge costs along `path` starting from index 1 (cost to step into
// each subsequent cell). Used by reroute to compare a proposed new path
// against the current remaining path under identical load conditions.
function pathCost(path, segmentLoad) {
  let cost = 0;
  for (let i = 1; i < path.length; i++) {
    cost += edgeCost(path[i], segmentLoad);
  }
  return cost;
}

export function findPath(grid, start, end, segmentLoad) {
  // `end` of kind 'i' is a logical "any cell of intersection (ir, ic)" goal.
  // 'x' / 's' ends are matched exactly by posKey.
  const destIr = end.kind === 'i' || end.kind === 'x' ? end.ir : end.toIr;
  const destIc = end.kind === 'i' || end.kind === 'x' ? end.ic : end.toIc;
  const endKey = end.kind === 'i' ? null : posKey(end);

  const isGoal = (cur) => {
    if (end.kind === 'i') {
      return cur.kind === 'x' && cur.ir === destIr && cur.ic === destIc;
    }
    return posKey(cur) === endKey;
  };

  if (isGoal(start)) return [start];

  const closed = new Set();
  const parent = new Map();
  const gScore = new Map();
  const open = new MinHeap();

  const startKey = posKey(start);
  gScore.set(startKey, 0);
  open.push({ pos: start, key: startKey, f: heuristic(start, destIr, destIc) });

  while (open.size() > 0) {
    const { pos: cur, key: curKey } = open.pop();
    if (closed.has(curKey)) continue;
    closed.add(curKey);

    if (isGoal(cur)) {
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
      const tentativeG = curG + edgeCost(n, segmentLoad);
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

// Logical destination refs (intersections at the grid edge).
function buildEdgeDestinations() {
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

// Spawn-start pool: actual occupiable cells inside edge intersections.
function buildEdgeStarts() {
  const cells = [];
  for (const e of buildEdgeDestinations()) {
    for (let ix = 0; ix < LANES; ix++) {
      for (let iy = 0; iy < LANES; iy++) {
        cells.push(xpos(e.ir, e.ic, ix, iy));
      }
    }
  }
  return cells;
}

// Spawn-start pool: every interior 'x' cell plus every segment cell.
function buildInteriorStarts() {
  const positions = [];
  for (let r = 1; r < GRID_SIZE - 1; r++) {
    for (let c = 1; c < GRID_SIZE - 1; c++) {
      for (let ix = 0; ix < LANES; ix++) {
        for (let iy = 0; iy < LANES; iy++) {
          positions.push(xpos(r, c, ix, iy));
        }
      }
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

const EDGE_DESTINATIONS = buildEdgeDestinations();
const EDGE_STARTS = buildEdgeStarts();
const INTERIOR_STARTS = buildInteriorStarts();

function spawnCar(state, occupied) {
  if (state.cars.length >= (state.maxCars ?? TOTAL_CELLS)) return null;

  // 60% interior, 40% edge. Sample ~60 candidates from the primary pool
  // first (A* is the expensive step; a full shuffle of 10k+ positions would
  // dwarf it).
  const useInterior = Math.random() < 0.6;
  const primaryPool = useInterior ? INTERIOR_STARTS : EDGE_STARTS;
  const fallbackPool = useInterior ? EDGE_STARTS : INTERIOR_STARTS;

  const tryStart = (start) => {
    const startKey = posKey(start);
    if (occupied.has(startKey)) return null;
    if (isPosBlocked(state.grid, start)) return null;

    const dest = EDGE_DESTINATIONS[Math.floor(Math.random() * EDGE_DESTINATIONS.length)];
    if (start.kind === 'x' && start.ir === dest.ir && start.ic === dest.ic) return null;

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
      // Resets every time the car actually moves; drives the MAX_WAIT
      // despawn check. Kept separate from `waitTime` so cumulative stats
      // (average wait per completed trip) stay accurate.
      consecutiveWait: 0,
      travelTime: 0,
      // Stagger the first reroute across [0, REROUTE_INTERVAL) so the cost
      // of rerouting is spread over ticks instead of spiking every 40th.
      nextRerouteTick: state.tick + Math.floor(Math.random() * REROUTE_INTERVAL),
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
  if (intersection.clearing) return false;
  const isNS = direction === 'north' || direction === 'south';
  return (isNS && intersection.phase === 'ns') || (!isNS && intersection.phase === 'ew');
}

function hasAccidentNeighbor(grid, r, c) {
  for (const { dr, dc } of DIRS_4) {
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nr >= GRID_SIZE || nc < 0 || nc >= GRID_SIZE) continue;
    if (grid[nr][nc].hasAccident) return true;
  }
  return false;
}

// Webster cycle/green computation. Returns `phaseDuration` to use for the
// upcoming green phase `nextPhase`. Reads smoothed approach demand from the
// intersection's EMA fields so it reflects sustained queues, not a single
// noisy tick at the moment of phase flip.
function websterDuration(inter, nextPhase) {
  const yNS = Math.min(inter.qNS_ema / SAT_FLOW, 0.45);
  const yEW = Math.min(inter.qEW_ema / SAT_FLOW, 0.45);
  const Y   = Math.min(yNS + yEW, 0.9);
  const C   = Math.max(MIN_PHASE * 2, Math.min(MAX_PHASE * 2,
                Math.round((1.5 * LOST_TIME + 5) / (1 - Y))));
  const green = C - LOST_TIME;
  const total = yNS + yEW || 1;
  const nsG = Math.max(MIN_PHASE, Math.round(green * yNS / total));
  const ewG = Math.max(MIN_PHASE, Math.round(green * yEW / total));
  return nextPhase === 'ns' ? nsG : ewG;
}

function adaptiveDuration(inter, nextPhase) {
  const inQ  = nextPhase === 'ns' ? inter.qNS_ema : inter.qEW_ema;
  const outQ = nextPhase === 'ns' ? inter.qEW_ema : inter.qNS_ema;
  const total = inQ + outQ || 1;
  const ratio = inQ / total;
  return Math.max(MIN_PHASE,
    Math.min(MAX_PHASE, Math.round(MIN_PHASE + ratio * (MAX_PHASE - MIN_PHASE))));
}

export function simulateTick(state) {
  const grid = state.grid.map((row) => row.map((cell) => ({ ...cell })));
  const cars = state.cars.map((c) => ({ ...c, path: c.path }));
  const stats = { ...state.stats, greenCorridorCount: 0 };
  let accidents = [...state.accidents];
  const tick = state.tick + 1;

  // Approach demand: every car on a segment whose downstream intersection is
  // (toIr, toIc) contributes to that intersection's NS or EW queue. This is
  // the signal Webster/adaptive should be sizing for — not just cars already
  // at the stop line, which was the old definition and saw queues of 0–2.
  // Stopline counts (cars currently held at an intersection waiting to leave)
  // are tracked separately and used only for adaptive's early-cut decision.
  const nsApproach = {};
  const ewApproach = {};
  const nsStopline = {};
  const ewStopline = {};
  // Downstream loads: cars on segments *leaving* (r,c) in each direction.
  // Max-pressure picks the phase that maximizes (inbound − outbound) demand,
  // so we need both sides of the difference.
  const nsDownstream = {};
  const ewDownstream = {};
  if (state.controlMode !== 'standard') {
    for (const car of state.cars) {
      const p = car.pos;
      if (p.kind === 's') {
        const inKey = `${p.toIr}-${p.toIc}`;
        const outKey = `${p.fromIr}-${p.fromIc}`;
        const dir = dirOfSeg(p.fromIr, p.fromIc, p.toIr, p.toIc);
        if (dir === 'north' || dir === 'south') {
          nsApproach[inKey] = (nsApproach[inKey] || 0) + 1;
          nsDownstream[outKey] = (nsDownstream[outKey] || 0) + 1;
        } else {
          ewApproach[inKey] = (ewApproach[inKey] || 0) + 1;
          ewDownstream[outKey] = (ewDownstream[outKey] || 0) + 1;
        }
        // Stopline = waiting cars at the very last segment cell, gated by
        // the light from entering the intersection. The old definition
        // (cars on the 'i' cell waiting to leave) no longer applies — cars
        // inside the intersection are past the light.
        if (car.waiting && p.pos === SEG_CELLS - 1) {
          if (dir === 'north' || dir === 'south') nsStopline[inKey] = (nsStopline[inKey] || 0) + 1;
          else ewStopline[inKey] = (ewStopline[inKey] || 0) + 1;
        }
      }
      // 'x' cells don't contribute to queues — already past the light.
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
          inter.clearing = false;
          inter.clearanceTimer = 0;
          accidents = accidents.filter((a) => !(a.row === r && a.col === c));
        }
        continue;
      }

      const key = `${r}-${c}`;
      if (state.controlMode !== 'standard') {
        inter.qNS_ema = EMA_ALPHA * (nsApproach[key] || 0) + (1 - EMA_ALPHA) * inter.qNS_ema;
        inter.qEW_ema = EMA_ALPHA * (ewApproach[key] || 0) + (1 - EMA_ALPHA) * inter.qEW_ema;
      }

      // All-red clearance interval. When phaseTimer overflows we set
      // clearing=true (below); during clearance no direction can pass, giving
      // intersection cells time to drain before the cross-direction enters.
      if (inter.clearing) {
        inter.clearanceTimer++;
        if (inter.clearanceTimer >= CLEARANCE_TICKS) {
          inter.clearing = false;
          inter.clearanceTimer = 0;
          inter.phase = inter.phase === 'ns' ? 'ew' : 'ns';
          inter.phaseTimer = 0;

          if (state.controlMode === 'webster' && !hasAccidentNeighbor(grid, r, c)) {
            inter.phaseDuration = websterDuration(inter, inter.phase);
          } else if (state.controlMode === 'adaptive') {
            inter.phaseDuration = adaptiveDuration(inter, inter.phase);
          }
          // maxpressure: phase length is decided by pressure, not a fixed
          // duration — leave phaseDuration untouched.
        }
        continue;
      }

      // Max-pressure: switch as soon as the alternative direction has strictly
      // more queue-pressure (inbound − downstream), subject to MIN_PHASE.
      // Provably stable for any feasible demand, so it should keep working
      // where Webster collapses.
      if (state.controlMode === 'maxpressure' && inter.phaseTimer >= MIN_PHASE) {
        const pNS = (nsApproach[key] || 0) - (nsDownstream[key] || 0);
        const pEW = (ewApproach[key] || 0) - (ewDownstream[key] || 0);
        const curP = inter.phase === 'ns' ? pNS : pEW;
        const altP = inter.phase === 'ns' ? pEW : pNS;
        if (altP > curP) {
          inter.clearing = true;
          inter.clearanceTimer = 0;
          continue;
        }
      }

      if (state.controlMode === 'adaptive' && inter.phaseTimer >= MIN_PHASE) {
        const greenQ = inter.phase === 'ns' ? (nsStopline[key] || 0) : (ewStopline[key] || 0);
        const redQ   = inter.phase === 'ns' ? (ewStopline[key] || 0) : (nsStopline[key] || 0);
        if (greenQ === 0 && redQ > 0) {
          inter.phaseTimer = inter.phaseDuration - 1;
        }
      }

      inter.phaseTimer++;
      if (state.controlMode !== 'maxpressure' && inter.phaseTimer >= inter.phaseDuration) {
        inter.clearing = true;
        inter.clearanceTimer = 0;
      }
    }
  }

  // --- Move cars ---
  const carsToRemove = new Set();
  // One car per cell. Pre-seed with every occupied cell; moving cars delete
  // their old cell so followers can advance into the vacated spot this tick.
  const nextOccupied = new Set(cars.map((c) => posKey(c.pos)));

  // Snapshot of segment occupancy at the start of this tick. Used as edge
  // weight by periodic reroutes so cars choose lightly-loaded segments.
  const segmentLoad = {};
  for (const car of cars) {
    if (car.pos.kind === 's') {
      const k = `${car.pos.fromIr},${car.pos.fromIc},${car.pos.toIr},${car.pos.toIc}`;
      segmentLoad[k] = (segmentLoad[k] || 0) + 1;
    }
  }

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

    // Periodic congestion-aware reroute (P2).
    //
    // Two correctness fixes over the naive version:
    //
    // 1. Booked load: when a car commits to a new path, every segment on that
    //    path is added to `segmentLoad` immediately. Cars rerouting later in
    //    the same tick see the updated load and avoid synchronising onto the
    //    same "free" corridor (which would just become the next traffic jam).
    //
    // 2. Significant-improvement gate: only switch paths if the new path's
    //    total cost is at least 10% cheaper than the current remaining path
    //    under the same load. Without this, microscopic load shifts make
    //    cars flap between equivalent routes and re-trigger oscillation.
    if (tick >= (car.nextRerouteTick ?? Infinity)) {
      const dest = ipos(car.destIr, car.destIc);
      const newPath = findPath(grid, car.pos, dest, segmentLoad);
      if (newPath && newPath.length >= 2) {
        const oldRemaining = car.path.slice(car.pathIndex);
        const oldCost = pathCost(oldRemaining, segmentLoad);
        const newCost = pathCost(newPath, segmentLoad);
        if (newCost < oldCost * 0.9) {
          car.path = newPath;
          car.pathIndex = 0;
          for (const p of newPath) {
            if (p.kind === 's') {
              const k = `${p.fromIr},${p.fromIc},${p.toIr},${p.toIc}`;
              segmentLoad[k] = (segmentLoad[k] || 0) + 1;
            }
          }
        }
      }
      car.nextRerouteTick = tick + REROUTE_INTERVAL;
    }

    const current = car.path[car.pathIndex];
    const next    = car.path[car.pathIndex + 1];
    const curKey  = posKey(current);
    const nextKey = posKey(next);

    // Reroute when the next position is inside an intersection now blocked
    // by an accident (any 'x' cell of that intersection is blocked).
    if (next.kind === 'x' && grid[next.ir][next.ic].hasAccident) {
      const dest = ipos(car.destIr, car.destIc);
      const newPath = findPath(grid, current, dest, segmentLoad);
      if (newPath && newPath.length >= 2) {
        cars[i] = { ...car, path: newPath, pathIndex: 0, pos: current, waiting: true };
        cars[i].waitTime++;
        cars[i].consecutiveWait = (cars[i].consecutiveWait ?? 0) + 1;
        if (cars[i].consecutiveWait >= MAX_WAIT) {
          carsToRemove.add(i);
          stats.abandoned++;
          nextOccupied.delete(posKey(cars[i].pos));
        }
      } else {
        car.waiting = true;
        car.waitTime++;
        car.consecutiveWait = (car.consecutiveWait ?? 0) + 1;
        if (car.consecutiveWait >= MAX_WAIT) {
          carsToRemove.add(i);
          stats.abandoned++;
          nextOccupied.delete(curKey);
        }
      }
      continue;
    }

    // Traffic light gates entry into the intersection: car stepping from
    // segment pos=SEG_CELLS-1 into an 'x' entry cell. Direction = the
    // segment's travel direction. Inside the intersection, internal moves
    // ('x' → 'x') are unrestricted so cars already past the bar can clear.
    let lightGreen = true;
    if (current.kind === 's' && next.kind === 'x') {
      const dir = dirOfSeg(current.fromIr, current.fromIc, current.toIr, current.toIc);
      lightGreen = canPass(grid[next.ir][next.ic], dir);
    }
    const nextFree = !nextOccupied.has(nextKey);

    if (lightGreen && nextFree) {
      nextOccupied.delete(curKey);
      car.pathIndex++;
      car.pos = next;
      car.waiting = false;
      car.consecutiveWait = 0;
      nextOccupied.add(nextKey);
      stats.greenCorridorCount = (stats.greenCorridorCount || 0) + 1;
    } else {
      car.waiting = true;
      car.waitTime++;
      car.consecutiveWait = (car.consecutiveWait ?? 0) + 1;
      if (car.consecutiveWait >= MAX_WAIT) {
        carsToRemove.add(i);
        stats.abandoned++;
        nextOccupied.delete(curKey);
      }
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
  // Throttle as the grid fills: at density ≥ THROTTLE_DENSITY no new cars
  // enter. Without this, a high spawnRate slider value floods the grid past
  // its discharge capacity and no signal policy can recover.
  const density = remainingCars.length / TOTAL_CELLS;
  const throttleFactor = Math.max(0, 1 - density / THROTTLE_DENSITY);
  newState.stats.density = density;
  newState.stats.spawnThrottled = throttleFactor < 1;

  const spawnOccupied = new Set(remainingCars.map((c) => posKey(c.pos)));
  for (let i = 0; i < state.spawnRate; i++) {
    if (Math.random() < 0.5 * throttleFactor) {
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
        (p) => p.kind === 'x' && p.ir === row && p.ic === col
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
