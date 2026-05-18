import { GRID_SIZE, LANES, SEG_CELLS, INTER_CELLS, TURN_POCKET,
         VMAX, P_RAND, YELLOW_TICKS, WAVE_OFFSET,
         ARRIVAL_WINDOW, TICKS_PER_HOUR } from './constants.js';
import { getSeg, getDownstream } from './grid.js';
import {
  nsUpdateSpeed,
  computeGap,
  websterOptimizeIntersection,
  greenWaveOffset,
} from './formulas.js';

export function camStep(camGrid) {
  _updateSignals(camGrid);

  const newCells = new Map();
  for (const [key, seg] of camGrid.segments) {
    const inter = camGrid.intersections[seg.ty][seg.tx];
    const red = !_isGreen(inter, seg.dir);
    const newLanes = Array.from({ length: LANES }, (_, lane) =>
      _nsStepLane(camGrid, seg, lane, red)
    );
    newCells.set(key, newLanes);
  }

  for (const [key, lanes] of newCells) {
    const seg = camGrid.segments.get(key);
    for (let lane = 0; lane < LANES; lane++) {
      for (let i = 0; i < SEG_CELLS; i++) {
        seg.cells[lane][i] = lanes[lane][i];
      }
    }
  }

  _flushIntersections(camGrid);
  _updateQueues(camGrid);

  if (camGrid.tick % 60 === 0) {
    _websterReopt(camGrid);
  }

  // Антидедлок: каждые 30 тактов проверяем и разряжаем застрявшие зоны
  if (camGrid.tick % 60 === 0) {
    _resolveGridlock(camGrid);
  }

  // Спаун: каждые 5 тактов добавляем машины на граничные сегменты
  if (camGrid.tick % 5 === 0) {
    _spawnBoundaryVehicles(camGrid);
  }

  camGrid.tick++;
}

function _updateSignals(camGrid) {
  for (const row of camGrid.intersections) {
    for (const inter of row) {
      if (inter.hasAccident) continue;
      inter.localTick++;
      const cycle = inter.greenNS + inter.greenEW + YELLOW_TICKS * 2;
      const t = inter.localTick % cycle;
      if (t < inter.greenNS)                                    inter.phase = 'NS';
      else if (t < inter.greenNS + YELLOW_TICKS)                inter.phase = 'YELLOW_NS';
      else if (t < inter.greenNS + YELLOW_TICKS + inter.greenEW) inter.phase = 'EW';
      else                                                       inter.phase = 'YELLOW_EW';
    }
  }
}

function _isGreen(inter, dir) {
  if (inter.hasAccident) return false;
  if (dir === 'NS' || dir === 'SN') return inter.phase === 'NS';
  return inter.phase === 'EW';
}

function _nsStepLane(camGrid, seg, lane, red) {
  const n         = SEG_CELLS;
  const next      = new Int8Array(n).fill(-1);
  const blockCell = seg.incident ? seg.incidentCell : -1;
  const inter     = camGrid.intersections[seg.ty][seg.tx];
  const ds        = getDownstream(camGrid, seg);

  for (let i = 0; i < n; i++) {
    if (seg.cells[lane][i] < 0) continue;

    const gap = computeGap(seg.cells[lane], i, VMAX, red, blockCell);
    const v   = nsUpdateSpeed(seg.cells[lane][i], gap, VMAX, P_RAND);
    const ni  = i + v;

    if (ni >= n) {
      // Правило "не въезжай если перекрёсток занят" (anti-spillback)
      if (!red && _hasRoomInIntersection(inter, seg, lane, ds)) {
        _enterIntersection(inter, seg, lane, v, ds);
      } else {
        // Места нет — машина остаётся на последней ячейке
        if (next[n - 1] < 0) next[n - 1] = 0;
      }
    } else {
      if (next[ni] < 0) next[ni] = v;
      else next[i] = 0;
    }
  }
  return next;
}

function _hasRoomInIntersection(inter, seg, lane, ds) {
  if (lane === 0) {
    const pocket = (seg.dir === 'NS' || seg.dir === 'SN')
      ? inter.pocketNS : inter.pocketEW;
    for (let p = 0; p < pocket.length; p++) {
      if (pocket[p] < 0) return true;
    }
  }

  const { dir } = seg;
  if (dir === 'EW') {
    for (let c = 0; c < INTER_CELLS; c++)
      if (inter.grid[lane][c] < 0) return true;
  } else if (dir === 'WE') {
    const row = INTER_CELLS - 1 - lane;
    for (let c = 0; c < INTER_CELLS; c++)
      if (inter.grid[row][c] < 0) return true;
  } else if (dir === 'NS') {
    const col = LANES + lane;
    for (let r = 0; r < INTER_CELLS; r++)
      if (inter.grid[r][col] < 0) return true;
  } else {
    const col = LANES - 1 - lane;
    for (let r = 0; r < INTER_CELLS; r++)
      if (inter.grid[r][col] < 0) return true;
  }

  if (ds) {
    for (let l = 0; l < LANES; l++)
      if (ds.cells[l][0] < 0) return true;
  }

  return false;
}

function _enterIntersection(inter, seg, lane, speed, ds) {
  const { dir } = seg;

  if (lane === 0) {
    const pocket = (dir === 'NS' || dir === 'SN') ? inter.pocketNS : inter.pocketEW;
    for (let p = 0; p < TURN_POCKET; p++) {
      if (pocket[p] < 0) { pocket[p] = speed; return; }
    }
  }

  let placed = false;
  if (dir === 'EW') {
    const row = lane;
    for (let c = 0; c < INTER_CELLS && !placed; c++) {
      if (inter.grid[row][c] < 0) { inter.grid[row][c] = speed; placed = true; }
    }
  } else if (dir === 'WE') {
    const row = INTER_CELLS - 1 - lane;
    for (let c = INTER_CELLS - 1; c >= 0 && !placed; c--) {
      if (inter.grid[row][c] < 0) { inter.grid[row][c] = speed; placed = true; }
    }
  } else if (dir === 'NS') {
    const col = LANES + lane;
    for (let r = 0; r < INTER_CELLS && !placed; r++) {
      if (inter.grid[r][col] < 0) { inter.grid[r][col] = speed; placed = true; }
    }
  } else {
    const col = LANES - 1 - lane;
    for (let r = INTER_CELLS - 1; r >= 0 && !placed; r--) {
      if (inter.grid[r][col] < 0) { inter.grid[r][col] = speed; placed = true; }
    }
  }

  if (!placed && ds) {
    for (let lane2 = 0; lane2 < LANES; lane2++) {
      if (ds.cells[lane2][0] < 0) { ds.cells[lane2][0] = speed; placed = true; break; }
    }
  }
  // если placed всё ещё false — зона и ds заняты,
  // машина остаётся на последней ячейке сегмента (NS-алгоритм следующего такта
  // выставит gap=0 и она не будет пытаться въехать снова)
}

function _flushIntersections(camGrid) {
  for (let iy = 0; iy < GRID_SIZE; iy++) {
    for (let ix = 0; ix < GRID_SIZE; ix++) {
      const inter = camGrid.intersections[iy][ix];
      const p = inter.phase;
      if (p !== 'NS' && p !== 'EW') continue;

      if (p === 'NS') {
        // cols 3-5: NS-машины едут на юг (iy+1)
        const dsS = iy < GRID_SIZE - 1 ? getSeg(camGrid, ix, iy, ix, iy + 1) : null;
        // cols 0-2: SN-машины едут на север (iy-1)
        const dsN = iy > 0             ? getSeg(camGrid, ix, iy, ix, iy - 1) : null;

        for (let r = 0; r < INTER_CELLS; r++) {
          for (let c = 0; c < INTER_CELLS; c++) {
            const v = inter.grid[r][c];
            if (v < 0) continue;
            if (c >= LANES) {
              // NS → юг; lane = c - LANES
              const lane = c - LANES;
              if (dsS && dsS.cells[lane][0] < 0) { dsS.cells[lane][0] = v; inter.grid[r][c] = -1; }
              else if (!dsS) inter.grid[r][c] = -1;
            } else {
              // SN → север; lane = LANES-1-c
              const lane = LANES - 1 - c;
              if (dsN && dsN.cells[lane][0] < 0) { dsN.cells[lane][0] = v; inter.grid[r][c] = -1; }
              else if (!dsN) inter.grid[r][c] = -1;
            }
          }
        }

        // pocketNS → юг
        for (let i = 0; i < TURN_POCKET; i++) {
          if (inter.pocketNS[i] < 0) continue;
          if (dsS && dsS.cells[0][0] < 0) { dsS.cells[0][0] = inter.pocketNS[i]; inter.pocketNS[i] = -1; }
          else if (!dsS) inter.pocketNS[i] = -1;
        }

      } else {
        // rows 0-2: EW-машины едут на восток (ix+1)
        const dsE = ix < GRID_SIZE - 1 ? getSeg(camGrid, ix, iy, ix + 1, iy) : null;
        // rows 3-5: WE-машины едут на запад (ix-1)
        const dsW = ix > 0             ? getSeg(camGrid, ix, iy, ix - 1, iy) : null;

        for (let r = 0; r < INTER_CELLS; r++) {
          for (let c = 0; c < INTER_CELLS; c++) {
            const v = inter.grid[r][c];
            if (v < 0) continue;
            if (r < LANES) {
              // EW → восток; lane = r
              if (dsE && dsE.cells[r][0] < 0) { dsE.cells[r][0] = v; inter.grid[r][c] = -1; }
              else if (!dsE) inter.grid[r][c] = -1;
            } else {
              // WE → запад; lane = INTER_CELLS-1-r
              const lane = INTER_CELLS - 1 - r;
              if (dsW && dsW.cells[lane][0] < 0) { dsW.cells[lane][0] = v; inter.grid[r][c] = -1; }
              else if (!dsW) inter.grid[r][c] = -1;
            }
          }
        }

        // pocketEW → восток
        for (let i = 0; i < TURN_POCKET; i++) {
          if (inter.pocketEW[i] < 0) continue;
          if (dsE && dsE.cells[0][0] < 0) { dsE.cells[0][0] = inter.pocketEW[i]; inter.pocketEW[i] = -1; }
          else if (!dsE) inter.pocketEW[i] = -1;
        }
      }
    }
  }
}

function _updateQueues(camGrid) {
  for (let iy = 0; iy < GRID_SIZE; iy++) {
    for (let ix = 0; ix < GRID_SIZE; ix++) {
      const inter = camGrid.intersections[iy][ix];
      let qNS = 0, qEW = 0;
      const dirs = [
        { fx: ix, fy: iy-1, tx: ix, ty: iy, axis: 'NS' },
        { fx: ix, fy: iy+1, tx: ix, ty: iy, axis: 'NS' },
        { fx: ix-1, fy: iy, tx: ix, ty: iy, axis: 'EW' },
        { fx: ix+1, fy: iy, tx: ix, ty: iy, axis: 'EW' },
      ];
      for (const d of dirs) {
        const seg = getSeg(camGrid, d.fx, d.fy, d.tx, d.ty);
        if (!seg) continue;
        for (let lane = 0; lane < LANES; lane++) {
          for (let ci = 0; ci < SEG_CELLS; ci++) {
            if (seg.cells[lane][ci] >= 0) {
              if (d.axis === 'NS') qNS++;
              else qEW++;
            }
          }
        }
      }
      inter.queueNS = Math.round(inter.queueNS * 0.7 + qNS * 0.3);
      inter.queueEW = Math.round(inter.queueEW * 0.7 + qEW * 0.3);
    }
  }
}

function _websterReopt(camGrid) {
  const detectorCap = SEG_CELLS * LANES;
  for (const row of camGrid.intersections) {
    for (const inter of row) {
      const qNS = (inter.queueNS / detectorCap) * 1500 * LANES;
      const qEW = (inter.queueEW / detectorCap) * 1500 * LANES;
      const result = websterOptimizeIntersection(qNS, qEW, LANES);

      inter.greenNS = result.greenNS;
      inter.greenEW = result.greenEW;

      if (process.env.NODE_ENV === 'development' && !result.feasible) {
        console.warn(
          `Webster [${inter.ix},${inter.iy}]: overloaded` +
          ` qNS=${qNS.toFixed(0)} qEW=${qEW.toFixed(0)} → NS=${result.greenNS}т EW=${result.greenEW}т`
        );
      }
    }
  }
}

function _resolveGridlock(camGrid) {
  for (let iy = 0; iy < GRID_SIZE; iy++) {
    for (let ix = 0; ix < GRID_SIZE; ix++) {
      const inter = camGrid.intersections[iy][ix];

      let occupied = 0;
      for (let r = 0; r < INTER_CELLS; r++)
        for (let c = 0; c < INTER_CELLS; c++)
          if (inter.grid[r][c] >= 0) occupied++;

      if (occupied === INTER_CELLS * INTER_CELLS) {
        const neighbors = [
          ix < GRID_SIZE-1 ? getSeg(camGrid, ix, iy, ix+1, iy) : null,
          ix > 0           ? getSeg(camGrid, ix, iy, ix-1, iy) : null,
          iy < GRID_SIZE-1 ? getSeg(camGrid, ix, iy, ix, iy+1) : null,
          iy > 0           ? getSeg(camGrid, ix, iy, ix, iy-1) : null,
        ].filter(Boolean);

        for (let r = 0; r < INTER_CELLS; r++) {
          for (let c = 0; c < INTER_CELLS; c++) {
            if (inter.grid[r][c] < 0) continue;
            let placed = false;
            for (const nb of neighbors) {
              for (let lane = 0; lane < LANES && !placed; lane++) {
                for (let ci = 0; ci < 3 && !placed; ci++) {
                  if (nb.cells[lane][ci] < 0) {
                    nb.cells[lane][ci] = inter.grid[r][c];
                    inter.grid[r][c] = -1;
                    placed = true;
                  }
                }
              }
            }
            // Если некуда — НЕ удаляем, машина остаётся и ждёт следующей проверки
          }
        }
      }

      // pocketNS
      for (let p = 0; p < TURN_POCKET; p++) {
        if (inter.pocketNS[p] < 0) continue;
        const ds = iy < GRID_SIZE - 1 ? getSeg(camGrid, ix, iy, ix, iy + 1) : null;
        if (ds) {
          for (let lane = 0; lane < LANES; lane++) {
            if (ds.cells[lane][0] < 0) {
              ds.cells[lane][0] = inter.pocketNS[p];
              inter.pocketNS[p] = -1;
              break;
            }
          }
        }
        if (!ds) inter.pocketNS[p] = -1;
      }

      // pocketEW
      for (let p = 0; p < TURN_POCKET; p++) {
        if (inter.pocketEW[p] < 0) continue;
        const ds = ix < GRID_SIZE - 1 ? getSeg(camGrid, ix, iy, ix + 1, iy) : null;
        if (ds) {
          for (let lane = 0; lane < LANES; lane++) {
            if (ds.cells[lane][0] < 0) {
              ds.cells[lane][0] = inter.pocketEW[p];
              inter.pocketEW[p] = -1;
              break;
            }
          }
        }
        if (!ds) inter.pocketEW[p] = -1;
      }
    }
  }
}

function _spawnBoundaryVehicles(camGrid) {
  const totalCells = camGrid.segments.size * SEG_CELLS * LANES;
  let currentVehicles = 0;
  for (const seg of camGrid.segments.values())
    for (let lane = 0; lane < LANES; lane++)
      for (const v of seg.cells[lane]) if (v >= 0) currentVehicles++;

  const targetDensity = 0.18;
  if (currentVehicles / totalCells >= targetDensity) return;

  const spawnCandidates = [];
  for (let ix = 0; ix < GRID_SIZE; ix++) {
    const segNS = getSeg(camGrid, ix, 0, ix, 1);
    if (segNS) spawnCandidates.push({ seg: segNS, ci: 0 });
    const segSN = getSeg(camGrid, ix, GRID_SIZE-1, ix, GRID_SIZE-2);
    if (segSN) spawnCandidates.push({ seg: segSN, ci: 0 });
  }
  for (let iy = 0; iy < GRID_SIZE; iy++) {
    const segEW = getSeg(camGrid, 0, iy, 1, iy);
    if (segEW) spawnCandidates.push({ seg: segEW, ci: 0 });
    const segWE = getSeg(camGrid, GRID_SIZE-1, iy, GRID_SIZE-2, iy);
    if (segWE) spawnCandidates.push({ seg: segWE, ci: 0 });
  }

  for (let i = spawnCandidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [spawnCandidates[i], spawnCandidates[j]] = [spawnCandidates[j], spawnCandidates[i]];
  }

  let spawned = 0;
  const maxSpawn = 3;
  for (const { seg, ci } of spawnCandidates) {
    if (spawned >= maxSpawn) break;
    const lane = Math.floor(Math.random() * LANES);
    if (seg.cells[lane][ci] < 0) {
      seg.cells[lane][ci] = Math.floor(Math.random() * (VMAX + 1));
      spawned++;
    }
  }
}

export function applyWaveMode(camGrid, enabled) {
  for (let iy = 0; iy < GRID_SIZE; iy++) {
    for (let ix = 0; ix < GRID_SIZE; ix++) {
      const inter = camGrid.intersections[iy][ix];
      const cycle = inter.greenNS + inter.greenEW + YELLOW_TICKS * 2;
      inter.localTick = enabled
        ? greenWaveOffset(ix, iy, WAVE_OFFSET)
        : Math.floor(Math.random() * cycle);
    }
  }
}

export function getCAMMetrics(camGrid) {
  let total = 0, sumV = 0;
  for (const seg of camGrid.segments.values()) {
    for (let lane = 0; lane < LANES; lane++) {
      for (const v of seg.cells[lane]) {
        if (v >= 0) { total++; sumV += v; }
      }
    }
  }
  const avgSpeed   = total > 0 ? sumV / total : 0;
  const totalCells = camGrid.segments.size * SEG_CELLS * LANES;
  const density    = total / totalCells;
  return {
    vehicles: total,
    avgSpeed: +avgSpeed.toFixed(2),
    flow:     +(density * avgSpeed).toFixed(3),
    tick:     camGrid.tick,
  };
}
