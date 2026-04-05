import { useState, useEffect, useRef, useCallback } from 'react';
import TrafficGrid from './TrafficGrid';
import StatsPanel from './StatsPanel';
import { createSimState, simulateTick, addAccident } from './simulation';

function App() {
  const [state, setState] = useState(createSimState);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(100);
  const intervalRef = useRef(null);

  const tick = useCallback(() => {
    setState((prev) => simulateTick(prev));
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

  const handleReset = () => {
    setRunning(false);
    setState(createSimState());
  };

  const handleSpawnRate = (val) => {
    setState((prev) => ({ ...prev, spawnRate: Number(val) }));
  };

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <h1 style={styles.h1}>Умная система управления светофорами</h1>
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
            max={8}
            value={state.spawnRate}
            onChange={(e) => handleSpawnRate(e.target.value)}
            style={styles.slider}
          />
        </div>
      </div>

      <div style={styles.main}>
        <div style={styles.gridContainer}>
          <TrafficGrid state={state} onCellClick={handleCellClick} speed={speed} />
          <div style={styles.legend}>
            <LegendItem color="#00ff88" label="Зелёный свет" />
            <LegendItem color="#ff4444" label="Красный свет" />
            <LegendItem color="#00ccff" label="Едет" />
            <LegendItem color="#ffaa00" label="Стоит" />
            <LegendItem color="#ff2222" label="Авария" />
          </div>
        </div>
        <StatsPanel state={state} />
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
    justifyContent: 'center',
    gap: 20,
    flexWrap: 'wrap',
    alignItems: 'flex-start',
  },
  gridContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  legend: {
    display: 'flex',
    gap: 16,
    justifyContent: 'center',
    flexWrap: 'wrap',
    padding: '8px 0',
  },
};

export default App;
