import { GRID_SIZE } from './simulation';

const CELL = 84;
const ROAD_WIDTH = 12;
const INTERSECTION_R = 12;

function getCarPosition(car) {
  const { path, pathIndex } = car;
  const cur = path[pathIndex];
  return { row: cur.row, col: cur.col };
}

// Returns rotation angle in degrees based on car's direction of travel
function getCarAngle(car) {
  const { path, pathIndex } = car;
  // Prefer looking ahead
  if (pathIndex + 1 < path.length) {
    const cur = path[pathIndex];
    const nxt = path[pathIndex + 1];
    const dr = nxt.row - cur.row;
    const dc = nxt.col - cur.col;
    if (dc === 1)  return 0;    // East
    if (dr === 1)  return 90;   // South
    if (dc === -1) return 180;  // West
    if (dr === -1) return -90;  // North
  }
  // Fall back to looking behind
  if (pathIndex > 0) {
    const prv = path[pathIndex - 1];
    const cur = path[pathIndex];
    const dr = cur.row - prv.row;
    const dc = cur.col - prv.col;
    if (dc === 1)  return 0;
    if (dr === 1)  return 90;
    if (dc === -1) return 180;
    if (dr === -1) return -90;
  }
  return 0;
}

function TrafficGrid({ state, onCellClick, speed = 100 }) {
  const size = CELL * GRID_SIZE + ROAD_WIDTH * 2;

  const getX = (col) => ROAD_WIDTH + col * CELL + CELL / 2;
  const getY = (row) => ROAD_WIDTH + row * CELL + CELL / 2;

  // Group cars by position to compute stacking offsets
  const carPositions = {};
  for (const car of state.cars) {
    const pos = getCarPosition(car);
    const key = `${pos.row}-${pos.col}`;
    if (!carPositions[key]) carPositions[key] = [];
    carPositions[key].push(car);
  }

  // Count waiting cars per intersection
  const waitingCount = {};
  for (const car of state.cars) {
    if (!car.waiting) continue;
    const pos = getCarPosition(car);
    const key = `${pos.row}-${pos.col}`;
    waitingCount[key] = (waitingCount[key] || 0) + 1;
  }

  // Transition duration: slightly shorter than the tick interval so motion
  // always completes before the next state update arrives.
  const transDuration = Math.max(speed * 0.85, speed - 20);

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      style={{ background: '#1a1a2e', borderRadius: 8 }}
    >
      {/* Roads - horizontal */}
      {Array.from({ length: GRID_SIZE }, (_, r) => (
        <line
          key={`h-${r}`}
          x1={0}
          y1={getY(r)}
          x2={size}
          y2={getY(r)}
          stroke="#2d2d44"
          strokeWidth={ROAD_WIDTH}
        />
      ))}
      {/* Roads - vertical */}
      {Array.from({ length: GRID_SIZE }, (_, c) => (
        <line
          key={`v-${c}`}
          x1={getX(c)}
          y1={0}
          x2={getX(c)}
          y2={size}
          stroke="#2d2d44"
          strokeWidth={ROAD_WIDTH}
        />
      ))}

      {/* Intersections */}
      {Array.from({ length: GRID_SIZE }, (_, r) =>
        Array.from({ length: GRID_SIZE }, (_, c) => {
          const inter = state.grid[r][c];
          const cx = getX(c);
          const cy = getY(r);

          return (
            <g key={`i-${r}-${c}`}>
              {/* Clickable area */}
              <rect
                x={cx - CELL / 2}
                y={cy - CELL / 2}
                width={CELL}
                height={CELL}
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onClick={() => onCellClick(r, c)}
              />
              {/* Intersection circle */}
              <circle
                cx={cx}
                cy={cy}
                r={INTERSECTION_R}
                fill={inter.hasAccident ? '#ff2222' : '#333'}
                stroke={inter.hasAccident ? '#ff6666' : '#555'}
                strokeWidth={1}
              />

              {/* Traffic light indicators + per-light countdown */}
              {!inter.hasAccident && (() => {
                const remaining = inter.phaseDuration - inter.phaseTimer;
                const nsGreen = inter.phase === 'ns';
                const ewGreen = inter.phase === 'ew';
                return (
                  <>
                    {/* North light */}
                    <rect x={cx - 1.5} y={cy - INTERSECTION_R - 4} width={3} height={3} rx={1} fill={nsGreen ? '#00ff88' : '#ff4444'} />
                    <text x={cx} y={cy - INTERSECTION_R - 9} textAnchor="middle" dominantBaseline="middle" fontSize={6} fill={nsGreen ? '#00ff88' : '#ff4444'} style={{ pointerEvents: 'none' }}>{remaining}</text>

                    {/* South light */}
                    <rect x={cx - 1.5} y={cy + INTERSECTION_R + 1} width={3} height={3} rx={1} fill={nsGreen ? '#00ff88' : '#ff4444'} />
                    <text x={cx} y={cy + INTERSECTION_R + 9} textAnchor="middle" dominantBaseline="middle" fontSize={6} fill={nsGreen ? '#00ff88' : '#ff4444'} style={{ pointerEvents: 'none' }}>{remaining}</text>

                    {/* West light */}
                    <rect x={cx - INTERSECTION_R - 4} y={cy - 1.5} width={3} height={3} rx={1} fill={ewGreen ? '#00ff88' : '#ff4444'} />
                    <text x={cx - INTERSECTION_R - 9} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize={6} fill={ewGreen ? '#00ff88' : '#ff4444'} style={{ pointerEvents: 'none' }}>{remaining}</text>

                    {/* East light */}
                    <rect x={cx + INTERSECTION_R + 1} y={cy - 1.5} width={3} height={3} rx={1} fill={ewGreen ? '#00ff88' : '#ff4444'} />
                    <text x={cx + INTERSECTION_R + 9} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize={6} fill={ewGreen ? '#00ff88' : '#ff4444'} style={{ pointerEvents: 'none' }}>{remaining}</text>
                  </>
                );
              })()}

              {/* Accident icon */}
              {inter.hasAccident && (
                <text
                  x={cx}
                  y={cy + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={10}
                  fill="#fff"
                  style={{ pointerEvents: 'none' }}
                >
                  !
                </text>
              )}

              {/* Waiting car count badge — center of intersection */}
              {(() => {
                const w = waitingCount[`${r}-${c}`];
                if (!w) return null;
                return (
                  <text
                    x={cx}
                    y={cy}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={8}
                    fontWeight="bold"
                    fill={w >= 5 ? '#ff4444' : '#ffdd00'}
                    style={{ pointerEvents: 'none' }}
                  >
                    {w}
                  </text>
                );
              })()}

            </g>
          );
        })
      )}

      {/* Cars — each rendered individually for smooth CSS-transition animation */}
      {state.cars.map((car) => {
        const pos = getCarPosition(car);
        const key = `${pos.row}-${pos.col}`;
        const siblings = carPositions[key] || [];
        const idx = siblings.indexOf(car);
        const count = Math.min(siblings.length, 6);

        // Spread overlapping cars around the intersection node
        const spreadAngle = count > 1 ? (idx / count) * Math.PI * 2 : 0;
        const spread = count > 1 ? 8 : 0;
        const ox = Math.cos(spreadAngle) * spread;
        const oy = Math.sin(spreadAngle) * spread;

        const cx = getX(pos.col) + ox;
        const cy = getY(pos.row) + oy;
        const angle = getCarAngle(car);
        const color = car.waiting ? '#ffaa00' : '#00ccff';

        return (
          <g
            key={`car-${car.id}`}
            style={{
              transform: `translate(${cx}px, ${cy}px)`,
              transition: `transform ${transDuration}ms linear`,
            }}
          >
            {/* Car body — rectangle rotated in travel direction */}
            <g style={{ transform: `rotate(${angle}deg)` }}>
              {/* Body */}
              <rect
                x={-6}
                y={-3}
                width={12}
                height={6}
                rx={2}
                fill={color}
                opacity={0.92}
              />
              {/* Front headlight dot */}
              <circle cx={6} cy={0} r={1.5} fill="#fff" opacity={0.7} />
            </g>
            <title>Авто #{car.id} | Ожидание: {car.waitTime} | Путь: {car.travelTime}</title>
          </g>
        );
      })}

      {/* Accident pulse effect */}
      {state.accidents.map((a) => (
        <circle
          key={`acc-${a.row}-${a.col}`}
          cx={getX(a.col)}
          cy={getY(a.row)}
          r={INTERSECTION_R + 4}
          fill="none"
          stroke="#ff4444"
          strokeWidth={1.5}
          opacity={0.6}
        >
          <animate
            attributeName="r"
            from={INTERSECTION_R + 2}
            to={INTERSECTION_R + 12}
            dur="1.5s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            from="0.7"
            to="0"
            dur="1.5s"
            repeatCount="indefinite"
          />
        </circle>
      ))}
    </svg>
  );
}

export default TrafficGrid;
