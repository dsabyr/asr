export const SAT_FLOW_VPH  = 1500;
export const LOST_TIME_SEC = 4;
export const MIN_CYCLE     = 40;
export const MAX_CYCLE     = 150;
export const MIN_GREEN     = 10;
export const MAX_GREEN     = 60;
export const FREE_FLOW_KMH = 60;
export const JAM_DENSITY   = 100;

export function websterCycleLength(Y, L) {
  if (Y >= 1.0) return MAX_CYCLE;
  const C0 = (1.5 * L + 5) / (1 - Y);
  return Math.max(MIN_CYCLE, Math.min(MAX_CYCLE, Math.round(C0)));
}

export function websterGreenTime(C, L, yi, Y) {
  const g = ((C - L) * yi) / Y;
  return Math.max(MIN_GREEN, Math.min(MAX_GREEN, Math.round(g)));
}

export function websterDelay(C, g, q, s) {
  const lambda = g / C;
  const x      = q / (s * lambda);
  if (x >= 1) return Infinity;
  const term1 = (C * Math.pow(1 - lambda, 2)) / (2 * (1 - lambda * x));
  const term2 = Math.pow(x, 2) / (2 * q * (1 - x));
  return term1 + term2;
}

export function criticalFlowRatio(qVph, lanes, satFlow = SAT_FLOW_VPH) {
  return qVph / (satFlow * lanes);
}

export function websterOptimizeIntersection(qNS, qEW, lanes, nPhases = 2) {
  const L   = LOST_TIME_SEC * nPhases;
  const yNS = criticalFlowRatio(qNS, lanes);
  const yEW = criticalFlowRatio(qEW, lanes);
  const Y   = yNS + yEW;

  if (Y >= 1.0) {
    const L2   = LOST_TIME_SEC * nPhases;
    const eff  = MAX_CYCLE - L2;
    const frac = Y > 0 ? yNS / Y : 0.5;
    const greenNS = Math.max(MIN_GREEN, Math.min(MAX_GREEN, Math.round(eff * frac)));
    const greenEW = Math.max(MIN_GREEN, Math.min(MAX_GREEN, eff - greenNS));
    return { greenNS, greenEW, cycleLength: MAX_CYCLE, feasible: false };
  }

  const C       = websterCycleLength(Y, L);
  const greenNS = websterGreenTime(C, L, yNS, Y);
  const greenEW = websterGreenTime(C, L, yEW, Y);

  return { greenNS, greenEW, cycleLength: C, feasible: true };
}

export function nsUpdateSpeed(v, gap, vmax, pRand) {
  let vNew = Math.min(v + 1, vmax);
  vNew     = Math.min(vNew, gap);
  if (Math.random() < pRand && vNew > 0) vNew--;
  return vNew;
}

export function computeGap(cells, i, vmax, red, blockCell = -1) {
  const n = cells.length;
  for (let d = 1; d <= vmax; d++) {
    const fi = i + d;
    if (fi >= n) return red ? (n - 1 - i) : d;
    if (blockCell >= 0 && fi === blockCell) return d - 1;
    if (cells[fi] >= 0) return d - 1;
  }
  return vmax;
}

export function fundamentalFlow(density, speed) {
  return density * speed;
}

export function greenshieldsSpeed(density, freeFlow = FREE_FLOW_KMH, jamDensity = JAM_DENSITY) {
  return freeFlow * Math.max(0, 1 - density / jamDensity);
}

export function greenWaveOffset(ix, iy, waveOffset) {
  return (ix + iy) * waveOffset;
}
