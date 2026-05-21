import { useState, useEffect, useRef, useCallback } from 'react';
import TrafficGrid from './TrafficGrid';
import StatsPanel from './StatsPanel';
import CarChart from './CarChart';
import { createSimState, simulateTick, addAccident, clearAccidents, GRID_SIZE, TOTAL_CELLS } from './simulation';

// Scenario constants — Phase A: standard control, accidents at tick 50.
// Phase B: webster takes over at tick 150, congestion clears by tick 300.
const SCENARIO_ACCIDENT_TICK = 50;
const SCENARIO_PHASE_B_TICK = 150;
const SCENARIO_END_TICK = 300;
const SCENARIO_SPAWN_RATE = 6;
const SCENARIO_ACCIDENTS = [[4, 4], [5, 6]];
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

  // Scenario state: null | 'A' | 'B' | 'done'. Use a ref alongside the
  // useState so the tick callback can read the current phase without
  // taking a dependency that would tear down the setInterval.
  const [scenarioPhase, setScenarioPhase] = useState(null);
  const scenarioPhaseRef = useRef(null);

  const tick = useCallback(() => {
    setState((prev) => {
      let next = simulateTick(prev);

      // Scenario transitions fire at exact tick boundaries.
      const phase = scenarioPhaseRef.current;
      if (phase === 'A') {
        if (next.tick === SCENARIO_ACCIDENT_TICK) {
          for (const [r, c] of SCENARIO_ACCIDENTS) {
            next = addAccident(next, r, c);
          }
        } else if (next.tick === SCENARIO_PHASE_B_TICK) {
          next = clearAccidents(next);
          next = { ...next, controlMode: 'webster' };
          scenarioPhaseRef.current = 'B';
          setScenarioPhase('B');
        }
      } else if (phase === 'B' && next.tick >= SCENARIO_END_TICK) {
        scenarioPhaseRef.current = 'done';
        setScenarioPhase('done');
        setRunning(false);
      }

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
    scenarioPhaseRef.current = null;
    setScenarioPhase(null);
  };

  const handleSpawnRate = (val) => {
    setState((prev) => ({ ...prev, spawnRate: Number(val) }));
  };

  const handleRunScenario = () => {
    setRunning(false);
    const fresh = createSimState();
    fresh.spawnRate = SCENARIO_SPAWN_RATE;
    fresh.controlMode = 'standard';
    setState(fresh);
    setHistory([]);
    scenarioPhaseRef.current = 'A';
    setScenarioPhase('A');
    setRunning(true);
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

      {scenarioPhase && (
        <ScenarioBanner phase={scenarioPhase} tick={state.tick} />
      )}

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

        <button
          onClick={handleRunScenario}
          style={{ ...styles.btn, background: '#9933cc' }}
          title="Phase A: standard control with accidents → Phase B: webster clears congestion"
        >
          ▶ Сценарий
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
            max={200}
            value={state.spawnRate}
            onChange={(e) => handleSpawnRate(e.target.value)}
            style={styles.slider}
          />
        </div>

        <div style={styles.sliderGroup}>
          <label style={styles.sliderLabel}>
            Макс. машин: {state.maxCars}
          </label>
          <input
            type="range"
            min={10}
            max={TOTAL_CELLS}
            step={50}
            value={state.maxCars}
            onChange={(e) => setState((prev) => ({ ...prev, maxCars: Number(e.target.value) }))}
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
                style={{ ...styles.modeBtn, background: viewMode === id ? '#3366ff' : '#e8eaed', color: viewMode === id ? '#fff' : '#333', borderColor: viewMode === id ? '#5588ff' : '#c5c8cd' }}
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
              style={{ ...styles.modeBtn, background: waveMode ? '#1D9E75' : '#e8eaed', color: waveMode ? '#fff' : '#333', borderColor: waveMode ? '#1D9E75' : '#c5c8cd' }}
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
                  background: state.controlMode === id ? '#3366ff' : '#e8eaed',
                  color: state.controlMode === id ? '#fff' : '#333',
                  borderColor: state.controlMode === id ? '#5588ff' : '#c5c8cd',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={styles.main}>
        <div style={styles.bottomPanel}>
          <StatsPanel state={state} scenarioPhase={scenarioPhase} />
          <CarChart history={history} />
        </div>

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
      </div>
    </div>
  );
}

function ScenarioBanner({ phase, tick }) {
  const labels = {
    A: '⚠ Фаза А: Стандартное управление (нарастание заторов...)',
    B: '✓ Фаза B: Вебстер активен (разгрузка...)',
    done: '✓ Сценарий завершён',
  };
  const colors = {
    A: '#e8542f',
    B: '#1f9d63',
    done: '#5566cc',
  };
  const cappedTick = Math.min(tick, SCENARIO_END_TICK);
  const pct = (cappedTick / SCENARIO_END_TICK) * 100;
  const phaseSplit = (SCENARIO_PHASE_B_TICK / SCENARIO_END_TICK) * 100;
  return (
    <div style={{
      background: colors[phase],
      color: '#fff',
      padding: '12px 16px',
      borderRadius: 8,
      marginBottom: 12,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{labels[phase]}</span>
        <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{cappedTick} / {SCENARIO_END_TICK}</span>
      </div>
      <div style={{ position: 'relative', width: '100%', height: 8, background: 'rgba(255,255,255,0.25)', borderRadius: 4 }}>
        <div style={{
          width: `${pct}%`,
          height: '100%',
          background: '#fff',
          borderRadius: 4,
          transition: 'width 0.2s linear',
        }} />
        {/* Phase A→B boundary tick */}
        <div style={{
          position: 'absolute',
          left: `${phaseSplit}%`,
          top: -2,
          width: 1,
          height: 12,
          background: 'rgba(255,255,255,0.7)',
        }} />
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
      <span style={{ fontSize: 12, color: '#555' }}>{label}</span>
    </div>
  );
}

const styles = {
  app: {
    minHeight: '100vh',
    background: '#f5f5f7',
    color: '#1a1a1a',
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
    color: '#666',
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 16,
    padding: '12px 16px',
    background: '#ffffff',
    borderRadius: 8,
    border: '1px solid #dde1e7',
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
    color: '#666',
    fontFamily: 'monospace',
  },
  slider: {
    width: 120,
    accentColor: '#00ccff',
  },
  main: {
    display: 'flex',
    flexDirection: 'row',
    gap: 16,
    alignItems: 'flex-start',
  },
  gridContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    flex: 3,
  },
  bottomPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
    flex: 1,
    minWidth: 0,
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
    color: '#333',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
};

export default App;
