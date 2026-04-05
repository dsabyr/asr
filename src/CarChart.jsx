const W = 320;
const H = 160;
const PAD = { top: 12, right: 12, bottom: 28, left: 32 };
const INNER_W = W - PAD.left - PAD.right;
const INNER_H = H - PAD.top - PAD.bottom;

function polyline(points) {
  return points.map(([x, y]) => `${x},${y}`).join(' ');
}

function CarChart({ history }) {
  if (history.length < 2) {
    return (
      <div style={styles.panel}>
        <div style={styles.title}>Динамика машин</div>
        <div style={styles.empty}>Запустите симуляцию…</div>
      </div>
    );
  }

  const maxCars = Math.max(
    ...history.map((d) => Math.max(d.moving, d.waiting)),
    1
  );

  const xOf = (i) => PAD.left + (i / (history.length - 1)) * INNER_W;
  const yOf = (v) => PAD.top + INNER_H - (v / maxCars) * INNER_H;

  const movingPts = history.map((d, i) => [xOf(i), yOf(d.moving)]);
  const waitingPts = history.map((d, i) => [xOf(i), yOf(d.waiting)]);

  // Y-axis ticks
  const yTicks = [0, Math.round(maxCars / 2), maxCars];

  // X-axis: show first and last tick label
  const firstTick = history[0].tick;
  const lastTick = history[history.length - 1].tick;

  return (
    <div style={styles.panel}>
      <div style={styles.title}>Динамика машин</div>
      <div style={styles.legend}>
        <LegendDot color="#00ccff" label="Едут" />
        <LegendDot color="#ffaa00" label="Стоят" />
      </div>
      <svg width={W} height={H} style={{ display: 'block' }}>
        {/* Grid lines */}
        {yTicks.map((v) => (
          <line
            key={v}
            x1={PAD.left}
            x2={PAD.left + INNER_W}
            y1={yOf(v)}
            y2={yOf(v)}
            stroke="#2a2a4a"
            strokeWidth={1}
          />
        ))}

        {/* Y-axis labels */}
        {yTicks.map((v) => (
          <text
            key={v}
            x={PAD.left - 4}
            y={yOf(v)}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize={9}
            fill="#666"
          >
            {v}
          </text>
        ))}

        {/* X-axis labels */}
        <text x={PAD.left} y={H - 6} textAnchor="middle" fontSize={9} fill="#555">{firstTick}</text>
        <text x={PAD.left + INNER_W} y={H - 6} textAnchor="middle" fontSize={9} fill="#555">{lastTick}</text>
        <text x={W / 2} y={H - 6} textAnchor="middle" fontSize={9} fill="#444">такт</text>

        {/* Waiting line */}
        <polyline
          points={polyline(waitingPts)}
          fill="none"
          stroke="#ffaa00"
          strokeWidth={1.5}
          strokeLinejoin="round"
          opacity={0.85}
        />

        {/* Moving line */}
        <polyline
          points={polyline(movingPts)}
          fill="none"
          stroke="#00ccff"
          strokeWidth={1.5}
          strokeLinejoin="round"
          opacity={0.85}
        />

        {/* Latest value dots */}
        <circle cx={movingPts.at(-1)[0]} cy={movingPts.at(-1)[1]} r={3} fill="#00ccff" />
        <circle cx={waitingPts.at(-1)[0]} cy={waitingPts.at(-1)[1]} r={3} fill="#ffaa00" />
      </svg>
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ width: 10, height: 3, background: color, borderRadius: 2 }} />
      <span style={{ fontSize: 11, color: '#aaa' }}>{label}</span>
    </div>
  );
}

const styles = {
  panel: {
    background: '#16162a',
    borderRadius: 8,
    padding: '12px 12px 8px',
    border: '1px solid #2a2a4a',
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
    color: '#ddd',
    marginBottom: 6,
    borderBottom: '1px solid #2a2a4a',
    paddingBottom: 6,
  },
  legend: {
    display: 'flex',
    gap: 14,
    marginBottom: 6,
  },
  empty: {
    fontSize: 12,
    color: '#555',
    padding: '20px 0',
    textAlign: 'center',
  },
};

export default CarChart;
