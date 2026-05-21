import { useState, useRef } from 'react';
import { GRID_SIZE, LANES, SEG_CELLS, dirOfSeg } from './simulation';

// --- Pixel layout ---
// INTER_CELLS_PX = 2 * LANES so the intersection rect matches road width
// (no exposed background corners where the road meets the intersection).
const CELL_PX = 6;
const INTER_CELLS_PX = LANES * 2;                // 6
const INTER_PX = INTER_CELLS_PX * CELL_PX;       // 36
const SEG_PX   = SEG_CELLS * CELL_PX;            // 60
const ROAD_PX  = LANES * CELL_PX;                // 18 (one direction)
const STEP_PX  = INTER_PX + SEG_PX;              // 96 between intersection centres
const GRID_PX  = STEP_PX * (GRID_SIZE - 1) + INTER_PX; // 900

const VIEW_PAD = ROAD_PX;
const VIEW_SIZE = GRID_PX + VIEW_PAD * 2;

// --- City map palette (warm, muted OSM-style) ---
const COLOR_BLOCK     = '#C8B99A'; // city blocks / buildings
const COLOR_ROAD      = '#E8E0D0'; // asphalt in daylight
const COLOR_CELL_DIV  = '#DDD2BD'; // very subtle cell separator on the asphalt
const COLOR_CENTER    = '#D4C9B5'; // dashed centerline between opposing lanes
const COLOR_BORDER    = '#B8A898'; // outer grid border
const COLOR_LIGHT_OK  = '#3FAA66'; // traffic-light green
const COLOR_LIGHT_NO  = '#D43F3F'; // traffic-light red
const COLOR_CAR_MOVE  = '#1F5C8E'; // dark blue (good contrast on light asphalt)
const COLOR_CAR_WAIT  = '#D9701F'; // warm orange
const COLOR_ACCIDENT  = '#C8341A';

const interCenter = (ir, ic) => ({
  x: INTER_PX / 2 + ic * STEP_PX,
  y: INTER_PX / 2 + ir * STEP_PX,
});

function getPixel(p) {
  if (p.kind === 'i') return interCenter(p.ir, p.ic);
  const dir = dirOfSeg(p.fromIr, p.fromIc, p.toIr, p.toIc);
  const from = interCenter(p.fromIr, p.fromIc);
  const f = (p.pos + 0.5) / SEG_CELLS;
  const laneOff = (p.lane + 0.5) * CELL_PX;
  switch (dir) {
    case 'east':  return { x: from.x + INTER_PX / 2 + f * SEG_PX, y: from.y + laneOff };
    case 'west':  return { x: from.x - INTER_PX / 2 - f * SEG_PX, y: from.y - laneOff };
    case 'south': return { x: from.x - laneOff, y: from.y + INTER_PX / 2 + f * SEG_PX };
    case 'north': return { x: from.x + laneOff, y: from.y - INTER_PX / 2 - f * SEG_PX };
    default:      return from;
  }
}

const ANGLE = { east: 0, south: 90, west: 180, north: -90 };

function getCarAngle(car) {
  const cur = car.pos;
  const path = car.path;
  const idx = car.pathIndex;
  let from, to;
  if (idx + 1 < path.length) { from = cur; to = path[idx + 1]; }
  else if (idx > 0)          { from = path[idx - 1]; to = cur; }
  else                       { return 0; }
  const seg = to.kind === 's' ? to : (from.kind === 's' ? from : null);
  if (seg) return ANGLE[dirOfSeg(seg.fromIr, seg.fromIc, seg.toIr, seg.toIc)] ?? 0;
  return 0;
}

function TrafficGrid({ state, onCellClick, speed = 100 }) {
  const [zoom, setZoom] = useState(1.0);
  const scrollRef = useRef(null);
  const transDuration = Math.max(speed * 0.85, speed - 20);

  const handleWheel = (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1 / 1.15 : 1.15;
    const container = scrollRef.current;
    if (!container) {
      setZoom((z) => Math.max(0.4, Math.min(6, z * factor)));
      return;
    }
    const rect = container.getBoundingClientRect();
    const cx = e.clientX - rect.left + container.scrollLeft;
    const cy = e.clientY - rect.top + container.scrollTop;
    setZoom((prevZoom) => {
      const nextZoom = Math.max(0.4, Math.min(6, prevZoom * factor));
      const ratio = nextZoom / prevZoom;
      requestAnimationFrame(() => {
        container.scrollLeft = cx * ratio - (e.clientX - rect.left);
        container.scrollTop  = cy * ratio - (e.clientY - rect.top);
      });
      return nextZoom;
    });
  };

  const waitingCount = {};
  for (const car of state.cars) {
    if (!car.waiting) continue;
    if (car.pos.kind !== 'i') continue;
    const key = `${car.pos.ir}-${car.pos.ic}`;
    waitingCount[key] = (waitingCount[key] || 0) + 1;
  }

  // Road strips — filled with the asphalt+cell pattern. Centerline goes between
  // the two opposing directions.
  const roadStrips = [];
  for (let ir = 0; ir < GRID_SIZE; ir++) {
    for (let ic = 0; ic < GRID_SIZE; ic++) {
      if (ic < GRID_SIZE - 1) {
        const a = interCenter(ir, ic);
        const xs = a.x + INTER_PX / 2;
        roadStrips.push(
          <rect key={`re-${ir}-${ic}`} x={xs} y={a.y}            width={SEG_PX} height={ROAD_PX} fill="url(#asphalt)" />,
          <rect key={`rw-${ir}-${ic}`} x={xs} y={a.y - ROAD_PX}  width={SEG_PX} height={ROAD_PX} fill="url(#asphalt)" />,
          <line key={`cyl-${ir}-${ic}`} x1={xs} y1={a.y} x2={xs + SEG_PX} y2={a.y}
                stroke={COLOR_CENTER} strokeWidth={1} strokeDasharray="3,2" />
        );
      }
      if (ir < GRID_SIZE - 1) {
        const a = interCenter(ir, ic);
        const ys = a.y + INTER_PX / 2;
        roadStrips.push(
          <rect key={`rs-${ir}-${ic}`} x={a.x - ROAD_PX} y={ys}  width={ROAD_PX} height={SEG_PX} fill="url(#asphalt)" />,
          <rect key={`rn-${ir}-${ic}`} x={a.x}           y={ys}  width={ROAD_PX} height={SEG_PX} fill="url(#asphalt)" />,
          <line key={`cyv-${ir}-${ic}`} x1={a.x} y1={ys} x2={a.x} y2={ys + SEG_PX}
                stroke={COLOR_CENTER} strokeWidth={1} strokeDasharray="3,2" />
        );
      }
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={zoomBar}>
        <button style={zoomBtn} onClick={() => setZoom((z) => Math.min(6, z * 1.25))}>+</button>
        <button style={zoomBtn} onClick={() => setZoom((z) => Math.max(0.4, z / 1.25))}>−</button>
        <button style={zoomBtn} onClick={() => setZoom(1.0)}>Reset</button>
        <span style={{ fontSize: 11, color: '#666', fontFamily: 'monospace' }}>
          {(zoom * 100).toFixed(0)}%
        </span>
        <span style={{ fontSize: 10, color: '#999', marginLeft: 'auto' }}>
          Колесо мыши — масштаб
        </span>
      </div>
      <div
        ref={scrollRef}
        onWheel={handleWheel}
        style={{
          overflow: 'auto',
          maxHeight: '78vh',
          background: COLOR_BLOCK,
          borderRadius: 8,
          border: `1px solid ${COLOR_BORDER}`,
        }}
      >
        <svg
          viewBox={`-${VIEW_PAD} -${VIEW_PAD} ${VIEW_SIZE} ${VIEW_SIZE}`}
          width={VIEW_SIZE * zoom}
          height={VIEW_SIZE * zoom}
          style={{ display: 'block' }}
        >
          <defs>
            <pattern id="asphalt" width={CELL_PX} height={CELL_PX} patternUnits="userSpaceOnUse">
              <rect width={CELL_PX} height={CELL_PX} fill={COLOR_ROAD} />
              <path d={`M ${CELL_PX} 0 L ${CELL_PX} ${CELL_PX} L 0 ${CELL_PX}`}
                    stroke={COLOR_CELL_DIV} strokeWidth={0.3} fill="none" />
            </pattern>
          </defs>

          {/* City blocks — background. Road strips and intersections sit on top. */}
          <rect x={-VIEW_PAD} y={-VIEW_PAD} width={VIEW_SIZE} height={VIEW_SIZE} fill={COLOR_BLOCK} />

          {roadStrips}

          {/* Intersections — same asphalt fill so roads continue seamlessly through.
              A subtle hairline border distinguishes the junction click target. */}
          {Array.from({ length: GRID_SIZE }, (_, r) =>
            Array.from({ length: GRID_SIZE }, (_, c) => {
              const inter = state.grid[r][c];
              const { x: cx, y: cy } = interCenter(r, c);
              const ns = inter.phase === 'ns';
              const nsColor = ns ? COLOR_LIGHT_OK : COLOR_LIGHT_NO;
              const ewColor = ns ? COLOR_LIGHT_NO : COLOR_LIGHT_OK;
              const half = INTER_PX / 2;
              const cornerOff = half - 2; // pull lights slightly inside the corner
              return (
                <g key={`i-${r}-${c}`}>
                  <rect
                    x={cx - half}
                    y={cy - half}
                    width={INTER_PX}
                    height={INTER_PX}
                    fill={inter.hasAccident ? COLOR_ACCIDENT : COLOR_ROAD}
                    stroke={COLOR_BORDER}
                    strokeWidth={0.3}
                    style={{ cursor: 'pointer' }}
                    onClick={() => onCellClick(r, c)}
                  />
                  {!inter.hasAccident && (
                    <>
                      {/* Diagonal pairs share a phase: TL+BR → NS, TR+BL → EW.
                          A car approaching the intersection sees the corner on its right. */}
                      <circle cx={cx - cornerOff} cy={cy - cornerOff} r={1.5} fill={nsColor} />
                      <circle cx={cx + cornerOff} cy={cy + cornerOff} r={1.5} fill={nsColor} />
                      <circle cx={cx + cornerOff} cy={cy - cornerOff} r={1.5} fill={ewColor} />
                      <circle cx={cx - cornerOff} cy={cy + cornerOff} r={1.5} fill={ewColor} />
                    </>
                  )}
                  {inter.hasAccident && (
                    <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle"
                          fontSize={9} fill="#fff" style={{ pointerEvents: 'none' }}>!</text>
                  )}
                  {(() => {
                    const w = waitingCount[`${r}-${c}`];
                    if (!w) return null;
                    return (
                      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
                            fontSize={7} fontWeight="bold"
                            fill={w >= 5 ? '#a8281f' : '#7a5e1c'}
                            style={{ pointerEvents: 'none' }}>{w}</text>
                    );
                  })()}
                </g>
              );
            })
          )}

          {/* Cars */}
          {state.cars.map((car) => {
            const { x: cx, y: cy } = getPixel(car.pos);
            const angle = getCarAngle(car);
            const color = car.waiting ? COLOR_CAR_WAIT : COLOR_CAR_MOVE;
            return (
              <g
                key={`car-${car.id}`}
                style={{
                  transform: `translate(${cx}px, ${cy}px)`,
                  transition: `transform ${transDuration}ms linear`,
                }}
              >
                <g style={{ transform: `rotate(${angle}deg)` }}>
                  <rect x={-2.4} y={-1.4} width={4.8} height={2.8} rx={0.6}
                        fill={color} opacity={0.95} />
                  <circle cx={2.2} cy={0} r={0.6} fill="#fff" opacity={0.9} />
                </g>
                <title>Авто #{car.id} | Ожидание: {car.waitTime} | Путь: {car.travelTime}</title>
              </g>
            );
          })}

          {/* Accident pulse */}
          {state.accidents.map((a) => {
            const { x, y } = interCenter(a.row, a.col);
            return (
              <circle key={`acc-${a.row}-${a.col}`} cx={x} cy={y}
                      r={INTER_PX / 2 + 2} fill="none" stroke={COLOR_ACCIDENT}
                      strokeWidth={0.8} opacity={0.7}>
                <animate attributeName="r" from={INTER_PX / 2 + 1} to={INTER_PX / 2 + 8}
                         dur="1.5s" repeatCount="indefinite" />
                <animate attributeName="opacity" from="0.7" to="0"
                         dur="1.5s" repeatCount="indefinite" />
              </circle>
            );
          })}

          {/* Grid outline */}
          <rect x={0} y={0} width={GRID_PX} height={GRID_PX}
                fill="none" stroke={COLOR_BORDER} strokeWidth={1} />
        </svg>
      </div>
    </div>
  );
}

const zoomBar = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 10px',
  background: '#fff',
  borderRadius: 6,
  border: '1px solid #dde1e7',
};

const zoomBtn = {
  padding: '3px 10px',
  fontSize: 12,
  fontWeight: 600,
  border: '1px solid #c5c8cd',
  borderRadius: 4,
  background: '#f3f4f6',
  cursor: 'pointer',
};

export default TrafficGrid;
