function StatsPanel({ state }) {
  const { stats, accidents, cars, tick } = state;

  const avgWait =
    stats.completedTrips > 0
      ? (stats.totalWaitTime / stats.completedTrips).toFixed(1)
      : '—';
  const avgTravel =
    stats.completedTrips > 0
      ? (stats.totalTravelTime / stats.completedTrips).toFixed(1)
      : '—';

  const currentWaiting = cars.filter((c) => c.waiting).length;
  const currentMoving = cars.filter((c) => !c.waiting).length;
  const flowRate =
    tick > 0 ? ((stats.exited / tick) * 60).toFixed(1) : '0';

  const throughput =
    stats.entered > 0
      ? ((stats.exited / stats.entered) * 100).toFixed(0)
      : '0';

  return (
    <div style={styles.panel}>
      <h3 style={styles.title}>Статистика</h3>

      <div style={styles.grid}>
        <StatCard label="Такт" value={tick} color="#888" />
        <StatCard label="Въехало" value={stats.entered} color="#00ccff" />
        <StatCard label="Выехало" value={stats.exited} color="#00ff88" />
        <StatCard label="На сетке" value={stats.carsInGrid} color="#ffaa00" />
        <StatCard label="Едут" value={currentMoving} color="#00ccff" />
        <StatCard label="Стоят" value={currentWaiting} color="#ff8844" />
        <StatCard label="Среднее ожидание" value={`${avgWait} т`} color="#ff6666" />
        <StatCard label="Среднее время пути" value={`${avgTravel} т`} color="#aa88ff" />
        <StatCard
          label="Поток"
          value={`${flowRate} авт/60т`}
          color="#44ddaa"
        />
        <StatCard label="Пропускная способность" value={`${throughput}%`} color="#ffdd44" />
        <StatCard
          label="Активные аварии"
          value={accidents.length}
          color={accidents.length > 0 ? '#ff4444' : '#666'}
        />
        <StatCard label="Завершено поездок" value={stats.completedTrips} color="#88ccff" />
      </div>

      {accidents.length > 0 && (
        <div style={styles.accidentList}>
          <h4 style={{ margin: '8px 0 4px', color: '#ff6666', fontSize: 13 }}>
            Места аварий
          </h4>
          {accidents.map((a, i) => (
            <div key={i} style={styles.accidentItem}>
              Перекрёсток ({a.row}, {a.col}) — осталось {state.grid[a.row]?.[a.col]?.accidentTimer ?? 0} тактов
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div style={styles.card}>
      <div style={{ ...styles.value, color }}>{value}</div>
      <div style={styles.label}>{label}</div>
    </div>
  );
}

const styles = {
  panel: {
    background: '#16162a',
    borderRadius: 8,
    padding: 16,
    minWidth: 280,
    border: '1px solid #2a2a4a',
  },
  title: {
    margin: '0 0 12px',
    color: '#ddd',
    fontSize: 16,
    fontWeight: 600,
    borderBottom: '1px solid #2a2a4a',
    paddingBottom: 8,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
  },
  card: {
    background: '#1e1e38',
    borderRadius: 6,
    padding: '10px 12px',
    textAlign: 'center',
  },
  value: {
    fontSize: 20,
    fontWeight: 700,
    fontFamily: 'monospace',
  },
  label: {
    fontSize: 11,
    color: '#888',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  accidentList: {
    marginTop: 8,
    borderTop: '1px solid #2a2a4a',
    paddingTop: 4,
  },
  accidentItem: {
    fontSize: 12,
    color: '#ff8888',
    padding: '2px 0',
    fontFamily: 'monospace',
  },
};

export default StatsPanel;
