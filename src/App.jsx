import { useState, useEffect, useRef, useCallback } from 'react';
import TrafficGrid from './TrafficGrid';
import StatsPanel from './StatsPanel';
import CarChart from './CarChart';
import { createSimState, simulateTick, addAccident } from './simulation';
import CAMCanvas from './components/CAMCanvas.jsx';
import { createCAMGrid, seedVehicles, syncAccidents } from './cam/grid.js';
import { camStep, applyWaveMode, getCAMMetrics } from './cam/simulator.js';

const HISTORY_MAX = 120;

function App() {
  const [state, setState] = useState(createSimState);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(100);
  const [history, setHistory] = useState([]);
  const intervalRef = useRef(null);

  const [viewMode, setViewMode]     = useState('svg');
  const [camGrid, setCamGrid]       = useState(() => { const g = createCAMGrid(); seedVehicles(g, 18); return g; });
  const [camMetrics, setCamMetrics] = useState({});
  const [waveMode, setWaveMode]     = useState(false);
  const [camDensity, setCamDensity] = useState(18);
  const [selInter, setSelInter]     = useState(null);
  const camIntervalRef              = useRef(null);

  const tick = useCallback(() => {
    setState((prev) => {
      const next = simulateTick(prev);
      const moving = next.cars.filter((c) => !c.waiting).length;
      const waiting = next.cars.filter((c) => c.waiting).length;
      const greenCorridor = next.stats.greenCorridorCount;
      setHistory((h) => {
        const entry = { tick: next.tick, moving, waiting, greenCorridor };
        return h.length >= HISTORY_MAX ? [...h.slice(1), entry] : [...h, entry];
      });
      return next;
    });
  }, []);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(tick, speed);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [running, speed, tick]);

  const handleCellClick = (row, col) => {
    setState((prev) => addAccident(prev, row, col));
  };

  useEffect(() => {
    if (!running || viewMode !== 'cam') {
      clearInterval(camIntervalRef.current);
      return;
    }
    camIntervalRef.current = setInterval(() => {
      setCamGrid(prev => {
        camStep(prev);
        setCamMetrics(getCAMMetrics(prev));
        return { ...prev, tick: prev.tick };
      });
    }, speed);
    return () => clearInterval(camIntervalRef.current);
  }, [running, viewMode, speed]);

  useEffect(() => {
    setCamGrid(prev => { syncAccidents(prev, state.grid); return { ...prev }; });
  }, [state.grid]);

  const handleReset = () => {
    setRunning(false);
    setState(createSimState());
    setHistory([]);
  };

  const handleSpawnRate = (val) => {
    setState((prev) => ({ ...prev, spawnRate: Number(val) }));
  };

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <h1 style={styles.h1}>Умная система управления светофорами X12</h1>
        <p style={styles.subtitle}>
          Нажмите на любой перекрёсток, чтобы создать аварию. Машины автоматически
          перестраивают маршрут, а ближайшие светофоры корректируют фазы.
        </p>
      </header>

      <div style={styles.controls}>
        <button
          onClick={() => setRunning(!running)}
          style={{
            ...styles.btn,
            background: running ? '#ff4444' : '#00cc66',
          }}
        >
          {running ? 'Пауза' : 'Старт'}
        </button>
        <button onClick={tick} style={styles.btn} disabled={running}>
          Шаг
        </button>
        <button onClick={handleReset} style={{ ...styles.btn, background: '#666' }}>
          Сброс
        </button>

        <div style={styles.sliderGroup}>
          <label style={styles.sliderLabel}>
            Скорость: {speed}мс
          </label>
          <input
            type="range"
            min={20}
            max={2000}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            style={styles.slider}
          />
        </div>

        <div style={styles.sliderGroup}>
          <label style={styles.sliderLabel}>
            Частота появления: {state.spawnRate}
          </label>
          <input
            type="range"
            min={1}
            max={20}
            value={state.spawnRate}
            onChange={(e) => handleSpawnRate(e.target.value)}
            style={styles.slider}
          />
        </div>

        <div style={styles.modeGroup}>
          <label style={styles.sliderLabel}>Вид</label>
          <div style={{ display: 'flex', gap: 4 }}>
            {[{ id: 'svg', label: 'SVG' }, { id: 'cam', label: 'CAM-2D' }].map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setViewMode(id)}
                style={{ ...styles.modeBtn, background: viewMode === id ? '#3366ff' : '#2a2a4a', borderColor: viewMode === id ? '#5588ff' : '#3a3a5a' }}
              >{label}</button>
            ))}
          </div>
        </div>

        {viewMode === 'cam' && (
          <>
            <div style={styles.modeGroup}>
              <label style={styles.sliderLabel}>Плотность: {camDensity}%</label>
              <input type="range" min={3} max={35} value={camDensity}
                onChange={e => { const v = +e.target.value; setCamDensity(v); setCamGrid(prev => { seedVehicles(prev, v); return { ...prev }; }); }}
                max={35}
                style={styles.slider} />
            </div>
            <button
              onClick={() => { const next = !waveMode; setWaveMode(next); setCamGrid(prev => { applyWaveMode(prev, next); return { ...prev }; }); }}
              style={{ ...styles.modeBtn, background: waveMode ? '#1D9E75' : '#2a2a4a', borderColor: waveMode ? '#1D9E75' : '#3a3a5a' }}
            >~ Волна</button>
          </>
        )}

        <div style={styles.modeGroup}>
          <label style={styles.sliderLabel}>Режим светофора</label>
          <div style={{ display: 'flex', gap: 4 }}>
            {[
              { id: 'standard', label: 'Стандарт' },
              { id: 'webster', label: 'Вебстер' },
              { id: 'adaptive', label: 'Адаптив' },
            ].map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setState((prev) => ({ ...prev, controlMode: id }))}
                style={{
                  ...styles.modeBtn,
                  background: state.controlMode === id ? '#3366ff' : '#2a2a4a',
                  borderColor: state.controlMode === id ? '#5588ff' : '#3a3a5a',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={styles.main}>
        <div style={styles.gridContainer}>
          {viewMode === 'svg'
            ? <TrafficGrid state={state} onCellClick={handleCellClick} speed={speed} />
            : <CAMCanvas camGrid={camGrid} onSelectIntersection={(ix, iy) => setSelInter(ix !== null ? [ix, iy] : null)} />
          }
          {viewMode === 'cam' && selInter && (() => {
            const inter = camGrid.intersections[selInter[1]][selInter[0]];
            return (
              <div style={{ fontSize: 12, color: '#aaa', fontFamily: 'monospace', textAlign: 'center', padding: '4px 0' }}>
                [{selInter[0]},{selInter[1]}] — {inter.phase} — NS {inter.greenNS}т / EW {inter.greenEW}т
                {camMetrics.vehicles !== undefined && ` | авт: ${camMetrics.vehicles} | v̄: ${camMetrics.avgSpeed}`}
              </div>
            );
          })()}
          {viewMode === 'svg' && (
            <div style={styles.legend}>
              <LegendItem color="#00ff88" label="Зелёный свет" />
              <LegendItem color="#ff4444" label="Красный свет" />
              <LegendItem color="#00ccff" label="Едет" />
              <LegendItem color="#ffaa00" label="Стоит" />
              <LegendItem color="#ff2222" label="Авария" />
            </div>
          )}
          {viewMode === 'cam' && (
            <div style={styles.legend}>
              <LegendItem color="#3B8BD4" label="Стоит" />
              <LegendItem color="#1D9E75" label="Едет" />
              <LegendItem color="#EF9F27" label="Быстро" />
              <LegendItem color="#D4537E" label="Карман" />
              <LegendItem color="#E24B4A" label="Авария" />
            </div>
          )}
        </div>

        <div style={styles.bottomPanel}>
          <StatsPanel state={state} />
          <CarChart history={history} />
        </div>
      </div>
    </div>
  );
}

function LegendItem({ color, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: color,
        }}
      />
      <span style={{ fontSize: 12, color: '#aaa' }}>{label}</span>
    </div>
  );
}

const styles = {
  app: {
    minHeight: '100vh',
    background: '#0d0d1a',
    color: '#eee',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    padding: '20px 24px',
  },
  header: {
    textAlign: 'center',
    marginBottom: 16,
  },
  h1: {
    margin: 0,
    fontSize: 24,
    fontWeight: 700,
    background: 'linear-gradient(90deg, #00ccff, #00ff88)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  subtitle: {
    margin: '6px 0 0',
    fontSize: 13,
    color: '#888',
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 16,
    padding: '12px 16px',
    background: '#16162a',
    borderRadius: 8,
    border: '1px solid #2a2a4a',
  },
  btn: {
    padding: '8px 18px',
    border: 'none',
    borderRadius: 6,
    color: '#fff',
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
    background: '#3366ff',
    transition: 'opacity 0.2s',
  },
  sliderGroup: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
  },
  sliderLabel: {
    fontSize: 11,
    color: '#888',
    fontFamily: 'monospace',
  },
  slider: {
    width: 120,
    accentColor: '#00ccff',
  },
  main: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  gridContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    width: '100%',
  },
  bottomPanel: {
    display: 'flex',
    gap: 20,
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  legend: {
    display: 'flex',
    gap: 16,
    justifyContent: 'center',
    flexWrap: 'wrap',
    padding: '8px 0',
  },
  modeGroup: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
  },
  modeBtn: {
    padding: '5px 10px',
    border: '1px solid',
    borderRadius: 5,
    color: '#fff',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
};

export default App;
