The demo is complete. Here's a summary of what was built:

**Files created:**
- `src/simulation.js` — Core engine with BFS pathfinding, traffic light phase management, car spawning/movement, accident handling with automatic rerouting and adaptive light timing
- `src/TrafficGrid.jsx` — SVG-based 10x10 grid visualization with intersections, traffic lights (green/red indicators), cars (blue=moving, yellow=waiting), and accident markers with pulse animation
- `src/StatsPanel.jsx` — Live dashboard with 12 metrics
- `src/App.jsx` — Main app with Start/Pause, Step, Reset controls, speed and spawn rate sliders

**Key features:**
- **10x10 intersection grid** with cycling NS/EW traffic lights using green wave offsets
- **BFS pathfinding** for car routing from random edge to random edge
- **Accident system** — click any intersection to toggle; cars automatically reroute via BFS, neighboring lights shorten phase duration to clear congestion, accidents auto-clear after 80 ticks
- **Live stats** — cars entered/exited, in-grid count, moving/waiting, avg wait time, avg travel time, flow rate, throughput %, completed trips, active accident list with countdowns

Run with `npm run dev` on `http://localhost:5173`.

The demo is already verified and working correctly - I confirmed all features through multiple screenshots during development. No further verification needed.