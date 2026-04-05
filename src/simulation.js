// Smart Traffic Light Simulation Engine

// Directions: 0=North, 1=East, 2=South, 3=West
const DIRS = [
  { dr: -1, dc: 0 }, // North
  { dr: 0, dc: 1 },  // East
  { dr: 1, dc: 0 },  // South
  { dr: 0, dc: -1 }, // West
];

const GRID_SIZE = 10;
const DEFAULT_PHASE = 12;
const MAX_CARS = 120;

let nextCarId = 1;

export function createGrid() {
  const intersections = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    const row = [];
    for (let c = 0; c < GRID_SIZE; c++) {
      row.push({
        row: r,
        col: c,
        phase: (r + c) % 2 === 0 ? 'ns' : 'ew',
        // Offset timers to create green waves along corridors
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
    },
    accidents: [],
    spawnRate: 3,
  };
}

// BFS pathfinding avoiding accidents
export function findPath(grid, startR, startC, endR, endC) {
  const visited = Array.from({ length: GRID_SIZE }, () =>
    new Array(GRID_SIZE).fill(false)
  );
  const parent = Array.from({ length: GRID_SIZE }, () =>
    new Array(GRID_SIZE).fill(null)
  );

  const queue = [{ r: startR, c: startC }];
  visited[startR][startC] = true;

  while (queue.length > 0) {
    const { r, c } = queue.shift();
    if (r === endR && c === endC) {
      const path = [];
      let cur = { r: endR, c: endC };
      while (cur) {
        path.unshift({ row: cur.r, col: cur.c });
        cur = parent[cur.r][cur.c];
      }
      return path;
    }

    for (const { dr, dc } of DIRS) {
      const nr = r + dr;
      const nc = c + dc;
      if (
        nr >= 0 && nr < GRID_SIZE &&
        nc >= 0 && nc < GRID_SIZE &&
        !visited[nr][nc] &&
        !grid[nr][nc].hasAccident
      ) {
        visited[nr][nc] = true;
        parent[nr][nc] = { r, c };
        queue.push({ r: nr, c: nc });
      }
    }
  }
  return null;
}

function spawnCar(state) {
  if (state.cars.length >= MAX_CARS) return null;

  const edges = [];
  for (let i = 0; i < GRID_SIZE; i++) {
    edges.push({ r: 0, c: i });
    edges.push({ r: GRID_SIZE - 1, c: i });
    edges.push({ r: i, c: 0 });
    edges.push({ r: i, c: GRID_SIZE - 1 });
  }

  const start = edges[Math.floor(Math.random() * edges.length)];

  let dest;
  let attempts = 0;
  do {
    dest = edges[Math.floor(Math.random() * edges.length)];
    attempts++;
  } while (dest.r === start.r && dest.c === start.c && attempts < 20);

  if (dest.r === start.r && dest.c === start.c) return null;
  if (state.grid[start.r][start.c].hasAccident) return null;

  const path = findPath(state.grid, start.r, start.c, dest.r, dest.c);
  if (!path || path.length < 2) return null;

  return {
    id: nextCarId++,
    path,
    pathIndex: 0,
    row: start.r,
    col: start.c,
    destRow: dest.r,
    destCol: dest.c,
    waiting: false,
    waitTime: 0,
    travelTime: 0,
  };
}

function getDirectionBetween(fromR, fromC, toR, toC) {
  if (toR < fromR) return 'north';
  if (toR > fromR) return 'south';
  if (toC > fromC) return 'east';
  if (toC < fromC) return 'west';
  return 'north';
}

function canPass(intersection, direction) {
  if (intersection.hasAccident) return false;
  const isNS = direction === 'north' || direction === 'south';
  return (isNS && intersection.phase === 'ns') || (!isNS && intersection.phase === 'ew');
}

// Mutable tick — avoids expensive deep clone
export function simulateTick(state) {
  // Shallow-clone top level + clone grid rows, cars array
  const grid = state.grid.map((row) =>
    row.map((cell) => ({ ...cell }))
  );
  const cars = state.cars.map((c) => ({ ...c, path: c.path }));
  const stats = { ...state.stats };
  let accidents = [...state.accidents];

  const tick = state.tick + 1;

  // Update traffic light phases
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const inter = grid[r][c];
      inter.phaseTimer++;
      if (inter.phaseTimer >= inter.phaseDuration) {
        inter.phaseTimer = 0;
        inter.phase = inter.phase === 'ns' ? 'ew' : 'ns';
      }

      if (inter.hasAccident) {
        inter.accidentTimer--;
        if (inter.accidentTimer <= 0) {
          inter.hasAccident = false;
          inter.accidentTimer = 0;
          inter.phaseDuration = DEFAULT_PHASE;
          accidents = accidents.filter(
            (a) => !(a.row === r && a.col === c)
          );
        }
      }
    }
  }

  // Move cars
  const carsToRemove = new Set();

  for (let i = 0; i < cars.length; i++) {
    const car = cars[i];
    car.travelTime++;

    if (car.pathIndex >= car.path.length - 1) {
      carsToRemove.add(i);
      stats.exited++;
      stats.completedTrips++;
      stats.totalTravelTime += car.travelTime;
      stats.totalWaitTime += car.waitTime;
      continue;
    }

    const current = car.path[car.pathIndex];
    const next = car.path[car.pathIndex + 1];

    // Reroute if next intersection has accident
    if (grid[next.row][next.col].hasAccident) {
      const newPath = findPath(grid, current.row, current.col, car.destRow, car.destCol);
      if (newPath && newPath.length >= 2) {
        cars[i] = { ...car, path: newPath, pathIndex: 0, row: current.row, col: current.col, waiting: true };
        cars[i].waitTime++;
      } else {
        car.waiting = true;
        car.waitTime++;
      }
      continue;
    }

    const direction = getDirectionBetween(current.row, current.col, next.row, next.col);

    if (canPass(grid[current.row][current.col], direction)) {
      car.pathIndex++;
      car.row = next.row;
      car.col = next.col;
      car.waiting = false;
    } else {
      car.waiting = true;
      car.waitTime++;
    }
  }

  const remainingCars = cars.filter((_, i) => !carsToRemove.has(i));

  // Spawn new cars
  const newState = {
    grid,
    cars: remainingCars,
    tick,
    stats,
    accidents,
    spawnRate: state.spawnRate,
  };

  for (let i = 0; i < state.spawnRate; i++) {
    if (Math.random() < 0.5) {
      const car = spawnCar(newState);
      if (car) {
        newState.cars.push(car);
        newState.stats.entered++;
      }
    }
  }

  newState.stats.carsInGrid = newState.cars.length;

  return newState;
}

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

    // Speed up neighboring lights to clear congestion
    for (const { dr, dc } of DIRS) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE) {
        grid[nr][nc].phaseDuration = Math.max(6, grid[nr][nc].phaseDuration - 4);
      }
    }

    // Reroute affected cars
    cars = cars.map((car) => {
      const passesThrough = car.path.slice(car.pathIndex + 1).some(
        (p) => p.row === row && p.col === col
      );
      if (!passesThrough) return car;

      const current = car.path[car.pathIndex];
      const newPath = findPath(grid, current.row, current.col, car.destRow, car.destCol);
      if (newPath && newPath.length >= 2) {
        return { ...car, path: newPath, pathIndex: 0, row: current.row, col: current.col };
      }
      return car;
    });
  }

  return { ...state, grid, accidents, cars };
}

export { GRID_SIZE };
