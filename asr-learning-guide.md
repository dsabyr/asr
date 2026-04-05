# Smart Traffic Light Control System — Study & Implementation Guide

## How to Use This Document

This guide is structured as a **learning ladder**. Each level builds on the previous one. For each topic you'll find: *what it is → why you need it → the math → how to implement it → what to study*. Don't skip levels — Level 0 vocabulary shows up everywhere.

---

## Level 0 — Foundations You Need First

Before touching any algorithm, you need three mental models: **graphs**, **traffic flow physics**, and **queuing**.

### 0.1 Graph Theory (Your City Is a Graph)

**What it is.** Every road network is a directed weighted graph. Intersections are **nodes**, road segments are **edges**, and weights can represent travel time, distance, or congestion cost.

**Core concepts to study:**

- **Directed graph (digraph):** Edges have direction (one-way streets, turn restrictions).
- **Weighted edges:** Each edge carries a cost. In traffic, cost = `(free_flow_travel_time) × (1 + α(volume/capacity)^β)` — this is the **BPR function** (Bureau of Public Roads). Study the BPR formula carefully: `t(v) = t₀ × [1 + α(v/c)^β]`, where `t₀` = free-flow time, `v` = volume, `c` = capacity, `α` = 0.15, `β` = 4 (standard values).
- **Adjacency matrix / adjacency list:** How you store the graph in code. For a 10×10 grid that's 100 nodes, an adjacency list is more memory-efficient than a matrix.
- **Shortest path algorithms:** Dijkstra's (single source, non-negative weights) and A* (heuristic-guided, faster for geographic networks). These are the backbone of all rerouting logic.
- **Connected components:** If an accident severs the graph, can vehicles still reach their destination? Check reachability.

**Study resources:**
- "Introduction to Algorithms" (CLRS), Chapters 22–25 (BFS, DFS, Dijkstra, Bellman-Ford)
- For A*: Red Blob Games' visual tutorial (redblobgames.com) — the best intuitive explanation available

**Implementation note:** In TypeScript, represent your grid as:
```
type Node = { id: string; x: number; y: number; };
type Edge = { from: string; to: string; weight: number; capacity: number; };
type Graph = Map<string, Edge[]>;  // adjacency list
```

### 0.2 Traffic Flow Theory

**What it is.** The physics of how vehicles move through roads. Three fundamental variables form the **fundamental diagram of traffic flow:**

1. **Flow (q):** vehicles per hour passing a point. Unit: veh/hr.
2. **Density (k):** vehicles per km on a road segment. Unit: veh/km.
3. **Speed (v):** average speed of the traffic stream. Unit: km/hr.

**The fundamental relationship:** `q = k × v` (flow = density × speed). This is analogous to fluid dynamics.

**Key concepts to study:**

- **Free-flow speed (vf):** Speed when road is empty. Typically the speed limit.
- **Jam density (kj):** Density when traffic is completely stopped. Bumper-to-bumper.
- **Critical density (kc):** Density at which flow is maximized. `kc = kj / 2` in the Greenshields model.
- **Capacity (qmax):** Maximum flow = `vf × kj / 4` (Greenshields model). This is the road's throughput ceiling.
- **Greenshields model:** The simplest speed-density relationship: `v = vf × (1 - k/kj)`. Linear, easy to implement, good enough for an MVP.
- **Saturation flow rate (s):** Maximum flow that can pass through an intersection during green. Typically ~1800–1900 veh/hr/lane. This is the single most important parameter for signal timing.

**Study resources:**
- "Traffic Flow Fundamentals" by Adolf May — the canonical reference
- Highway Capacity Manual (HCM) Chapter 16 for signalized intersections

### 0.3 Queuing Theory at Intersections

**What it is.** Vehicles arrive at red lights and form queues. Understanding queue dynamics is essential for calculating delay.

**Key concepts:**

- **Arrival rate (λ):** Vehicles arriving per unit time. Unit: veh/sec.
- **Service rate (μ):** Vehicles departing during green per unit time. `μ = s/3600` where `s` = saturation flow (veh/hr).
- **Degree of saturation (x):** `x = λ/(μ × g/C)` = demand / capacity, where `g` = green time and `C` = cycle length. When `x > 1.0`, the queue grows without bound — the intersection is **oversaturated**.
- **Webster's delay formula:** Average delay per vehicle:
  ```
  d = C(1 - g/C)² / [2(1 - x·g/C)] + x² / [2λ(1 - x)] - 0.65(C/λ²)^(1/3) × x^(2+5g/C)
  ```
  You've already studied this one. The first term is **uniform delay** (due to the signal cycling), the second is **overflow delay** (due to random arrivals), and the third is a correction factor.

**Why it matters:** Every optimization algorithm you'll use is trying to minimize some form of delay. Webster's delay is your objective function.

---

## Level 1 — Single Intersection Optimization

**Goal:** Given known traffic demands on each approach, find the optimal signal timing for ONE intersection.

### 1.1 Signal Timing Basics

**Concepts to master:**

- **Phase:** A set of compatible (non-conflicting) traffic movements that receive green simultaneously. Example: North-South through + right turns.
- **Cycle length (C):** Total time for all phases to complete one rotation. Typically 60–120 seconds.
- **Green time (gᵢ):** Duration of green for phase i.
- **Amber/intergreen time (Iᵢ):** Yellow + all-red clearance between phases. Typically 4–6 seconds. This is "lost time" — no one moves.
- **Effective green:** `gₑ = g + amber - start_loss - end_gain ≈ g - lost_time_per_phase`. In practice, total lost time per cycle `L = Σ(lost_time per phase)`.
- **Phase conflict matrix:** A boolean matrix indicating which movements conflict (cannot be green simultaneously). This is the foundation for determining valid phase combinations.

### 1.2 Webster's Optimal Cycle Length

**The formula:** `C₀ = (1.5L + 5) / (1 - Y)`

Where:
- `L` = total lost time per cycle (sum of intergreens)
- `Y` = sum of critical flow ratios = `Σ(yᵢ)` where `yᵢ = qᵢ/sᵢ` for the critical (heaviest) movement in each phase
- `qᵢ` = demand flow for critical movement i
- `sᵢ` = saturation flow for that movement

**Green splits:** Allocate green proportionally to demand: `gᵢ = (yᵢ/Y) × (C₀ - L)`

**Constraints to enforce:**
- Minimum green for pedestrians: `g_ped = W/1.2 + 7` (W = crosswalk width in meters, 1.2 = walking speed m/s, 7 = startup buffer)
- Maximum cycle length: typically 150s (driver patience limit)
- Minimum cycle length: typically 40s

**Implementation step:** Write a `websterOptimize(demands, saturationFlows, lostTimes)` function that returns `{ cycleLength, greenTimes[] }`.

### 1.3 Phase Design via Smart Enumeration (ILP Without a Solver)

**When you need this:** When phase structure isn't fixed — e.g., should you include a Barnes Dance (exclusive pedestrian phase)? Should left turns get a protected phase or share with through traffic?

**Algorithm:**
1. Build a **conflict matrix** from intersection geometry
2. Enumerate all **maximal compatible movement sets** (phases) — use a backtracking algorithm
3. Filter to valid phase combinations that cover all required movements
4. For each valid combination, run Webster to get optimal timing and total delay
5. Select the combination with minimum delay

**This is the ILP solved by exhaustion**, which is tractable for typical intersections (2–8 phases).

### 1.4 Actuated / Adaptive Control

**What it is.** Instead of fixed timers, the signal responds to real-time detector data.

**Key mechanisms:**
- **Gap-out:** Extend green as long as vehicles keep arriving (gap < threshold, typically 3s). End green when a gap exceeds the threshold.
- **Max-out:** Hard upper limit on green extension to prevent starvation of other phases.
- **Min recall:** Guaranteed minimum green for every phase (safety).

**Implementation:** This is event-driven logic. Each phase has a state machine: `MIN_GREEN → EXTENSION → GAP_OUT/MAX_OUT → YELLOW → RED`.

---

## Level 2 — Corridor Coordination (Green Waves)

**Goal:** Synchronize signals along an arterial so a platoon of vehicles hits green at every intersection.

### 2.1 The Green Wave Concept

**Offset (Δᵢ):** The time delay between when intersection i starts its green phase and when the reference intersection (first one) starts its green. If you set offsets correctly, a vehicle traveling at speed `v` along the corridor will arrive at each intersection exactly when it turns green.

**Basic offset calculation:** `Δᵢ = dᵢ / v` where `dᵢ` = distance from reference intersection to intersection i, and `v` = design speed (progression speed).

**Bandwidth (B):** The width of the "green band" — the window of time during which a vehicle can travel the entire corridor without stopping. Maximizing bandwidth = maximizing the number of vehicles that get a free run.

### 2.2 MAXBAND Algorithm

**What it solves:** Maximizes bandwidth for a two-way arterial (both directions simultaneously), which is harder because the offset that's ideal for one direction may be terrible for the other.

**The optimization problem:**
```
Maximize:  b₁ + b₂  (bandwidth in each direction)
Subject to:
  For each consecutive pair of intersections (i, i+1):
    Δᵢ₊₁ - Δᵢ ≡ tᵢ,ᵢ₊₁  (mod C)     [forward direction]
    Δᵢ - Δᵢ₊₁ ≡ tᵢ₊₁,ᵢ  (mod C)     [reverse direction]
  Where tᵢ,ᵢ₊₁ = travel time between intersections
  b₁ + b₂ ≤ gₑ  (bandwidth can't exceed effective green)
```

**This is a Mixed-Integer Linear Program.** For your MVP, simplify:
1. Fix cycle length across all intersections (required for coordination)
2. Assume uniform spacing and speed → uniform offset increment
3. Solve the 1-D offset optimization via exhaustive search over offset values (discrete, in 1-second steps)

**Critical insight you already know:** Barnes Dance phases at intersections along the corridor reduce achievable bandwidth because they consume green time. This is a design tradeoff, not a bug.

### 2.3 Time-Space Diagram

**What it is.** A 2D plot with distance on the Y-axis and time on the X-axis. Each intersection is a horizontal band showing red/green periods. Diagonal lines represent vehicle trajectories. The **green band** is the diagonal corridor where vehicles can travel without stopping.

**Why you need it:** This is your primary visualization tool for corridor coordination. It makes bandwidth, offsets, and platoon dispersion immediately visible.

**Implementation:** Draw this in your Three.js visualization or as a 2D overlay in the admin panel.

---

## Level 3 — Network-Wide Optimization

**Goal:** Optimize all intersections simultaneously, accounting for the fact that upstream signals affect downstream demand.

### 3.1 The Network Problem

Individual intersection optimization fails at the network level because:
- **Spillback:** A queue at intersection B can block intersection A (gridlock).
- **Demand dependency:** Vehicles released by intersection A become arrivals at intersection B.
- **Competing objectives:** A green wave on one arterial may conflict with cross-street arterials.

### 3.2 Store-and-Forward Model

**What it is.** A macroscopic network model that treats road links as "stores" of vehicles and intersections as "valves" controlling flow between stores.

**State variable:** `xₗ(t)` = number of vehicles on link l at time t.

**Dynamics:**
```
xₗ(t+1) = xₗ(t) + Σ(inflows from upstream links) - Σ(outflows to downstream links) + external_demand(t)
```

**Outflow from a link** = `min(demand, capacity × green_ratio)` where green_ratio = `gᵢ/C`.

**Optimization:** Minimize total network delay = `Σ xₗ(t)` over all links and time steps, subject to:
- Signal timing constraints (min/max green, cycle length)
- Capacity constraints (flow ≤ saturation × green_ratio)
- Queue storage constraints (vehicles on link ≤ max_queue_storage = link_length × lanes × jam_density)

**This is a Linear Program** solvable with standard LP methods. For your 10×10 grid, it has ~400 links and ~100 nodes — very tractable.

### 3.3 Multi-Agent Reinforcement Learning (MARL)

**What it is.** Each intersection is an **agent** that learns a signal control policy through trial and error in simulation.

**Components (per agent):**

| Component | Definition |
|-----------|-----------|
| **State (sᵢ)** | Queue lengths on each approach, current phase, time since last phase change, neighboring intersection phases |
| **Action (aᵢ)** | Which phase to activate next (or: extend current phase / switch) |
| **Reward (rᵢ)** | Negative of: total delay + queue length + (penalty for queue spillback). `rᵢ = -(w₁·delay + w₂·queue + w₃·spillback_penalty)` |
| **Policy (πᵢ)** | Neural network mapping state → action probabilities |

**Algorithm choices (study in this order):**

1. **Independent Q-Learning (IQL):** Each agent learns independently. Simple but ignores coordination. Good baseline.
2. **Deep Q-Network (DQN):** Q-learning with a neural network approximator. Study the original DeepMind paper (Mnih et al., 2015).
3. **Multi-Agent Actor-Critic:** Agents share a centralized critic (which sees all states) but have decentralized actors (each sees only local state). This is the **CTDE** paradigm — Centralized Training, Decentralized Execution.
4. **MAPPO (Multi-Agent PPO):** Currently the most practical MARL algorithm. PPO is stable, sample-efficient, and scales well. Use this for your implementation.

**State representation for the 10×10 grid:**
```
state_i = [
  queue_N, queue_S, queue_E, queue_W,        // 4 queue lengths
  current_phase,                                // one-hot encoded
  time_in_phase,                                // seconds
  neighbor_phases[4],                           // N, S, E, W neighbor phases
  // Optional: upstream queue lengths for spillback awareness
]
// Dimension: ~20-30 values per intersection
```

**Training loop pseudocode:**
```
for episode in range(num_episodes):
    reset simulation
    for t in range(max_steps):
        for each agent i:
            observe state sᵢ
            select action aᵢ = πᵢ(sᵢ)
        step simulation with all actions
        for each agent i:
            observe reward rᵢ, next state s'ᵢ
            store (sᵢ, aᵢ, rᵢ, s'ᵢ) in replay buffer
        update all policies using sampled batches
```

**Study resources:**
- "An Introduction to Deep Reinforcement Learning" by Vincent François-Lavet et al. (free PDF)
- The IntelliLight paper (Wei et al., 2018) — RL for traffic signal control specifically
- PressLight paper (Wei et al., 2019) — uses max-pressure theory with DRL

### 3.4 Model Predictive Control (MPC)

**What it is.** At each decision step, solve an optimization problem over a short prediction horizon (e.g., 30–60 seconds ahead), apply the first step's decision, then re-solve at the next step (rolling horizon).

**Why it's powerful:** Combines the rigor of mathematical optimization with adaptability — you're constantly re-planning based on new data.

**Formulation:**
```
At time t, solve:
  Minimize Σ(over τ = t to t+H) Σ(over all links l) xₗ(τ)
  Subject to:
    xₗ(τ+1) = xₗ(τ) + inflow - outflow    (store-and-forward dynamics)
    Signal timing constraints
    Queue storage constraints
  Using predicted demands over the horizon H
Apply only the decision for time t
At time t+1, re-solve with updated measurements
```

**Prediction horizon (H):** 30–60 seconds is typical. Longer = better plans but slower computation.

**For your MVP:** MPC with the store-and-forward model is arguably the most principled approach and is what real systems like TUC (Traffic-responsive Urban Control) use.

---

## Level 4 — Accident Detection & Rerouting

**Goal:** When an incident occurs, detect it, update the network model, and reroute traffic.

### 4.1 Incident Detection

**In your simulation (synthetic data):** You trigger incidents manually or randomly. An incident = reduce capacity of affected link(s) to zero or near-zero.

**In real systems, detection methods include:**
- **California Algorithm:** Compare upstream and downstream detector occupancy. If upstream occupancy spikes and downstream drops, there's likely a blockage between them.
- **Anomaly detection:** If travel time on a link suddenly exceeds `mean + 3σ` of historical values, flag it.

**Data model for an incident:**
```
type Incident = {
  id: string;
  link_id: string;           // affected road segment
  severity: 0..1;            // 0 = full blockage, 1 = no effect
  capacityMultiplier: number; // multiply link capacity by this
  detectedAt: number;        // simulation timestamp
  estimatedDuration: number;  // seconds
  position: [x, y];          // for visualization
};
```

### 4.2 Dynamic Shortest Path Rerouting

**Algorithm: Modified Dijkstra / A***

When an incident is detected:
1. **Update edge weights** in the graph: set affected edge cost to very high value (or remove edge entirely for full blockage).
2. **Recompute shortest paths** from all origins to all destinations using Dijkstra or A*.
3. **Apply new routes** to vehicles currently in the network.

**Efficient recomputation — you don't need to recompute everything:**
- **D* Lite (Dynamic A*):** An incremental shortest-path algorithm that efficiently updates paths when edge costs change. Only recomputes the affected portion of the path tree.
- Study: Koenig & Likhachev, "D* Lite" (2002). Pseudocode is clean and directly implementable.

**For your 10×10 MVP:** Full Dijkstra recomputation is fast enough (100 nodes = microseconds). D* Lite becomes important for larger networks.

### 4.3 Network Capacity Reduction & Signal Re-optimization

An accident doesn't just require rerouting — it changes optimal signal timings everywhere:

1. **Immediate response (0–30 seconds):** Extend green for approach roads receiving rerouted traffic. Reduce green for the blocked direction.
2. **Short-term adaptation (30s – 5 min):** Re-run signal optimization (Webster or MPC) with updated demand patterns.
3. **Medium-term (5+ min):** If using MARL, the agents will naturally adapt as they observe new queue patterns.

**Implementation pattern:**
```
function handleIncident(incident: Incident, network: Graph, signals: SignalState[]) {
  // 1. Update graph
  network.updateEdgeCapacity(incident.link_id, incident.capacityMultiplier);
  
  // 2. Reroute affected vehicles
  const affectedRoutes = findRoutesUsing(incident.link_id);
  for (const route of affectedRoutes) {
    route.path = dijkstra(network, route.current_position, route.destination);
  }
  
  // 3. Re-optimize signals
  const newDemands = estimateNewDemands(network, reroutedVehicles);
  for (const intersection of affectedIntersections(incident)) {
    intersection.signalTiming = websterOptimize(newDemands[intersection.id]);
  }
}
```

### 4.4 Congestion Propagation Awareness

Rerouting traffic to alternative paths can **create new congestion** on those paths. Naive rerouting causes oscillation (everyone reroutes to the same road, overloading it).

**Solutions:**

- **System-Optimal (SO) routing:** Instead of routing each vehicle to its individual shortest path (User Equilibrium), route vehicles to minimize *total* network delay. This requires solving a traffic assignment problem.
- **Wardrop's principles:** Study User Equilibrium (UE) vs System Optimal (SO). At UE, no driver can unilaterally improve their route. At SO, total system delay is minimized.
- **Frank-Wolfe algorithm:** The standard method for solving static traffic assignment (finding UE or SO).
- **For your MVP:** Implement **incremental assignment** — reroute vehicles one at a time, updating edge weights after each assignment. This converges toward equilibrium without needing Frank-Wolfe.

---

## Level 5 — Putting It All Together (Architecture)

### 5.1 System Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                    Admin Panel (React)                │
│  Controls / Parameters / Incident Injection / Stats  │
└──────────────┬───────────────────────┬───────────────┘
               │ Zustand Store         │
┌──────────────▼───────────────────────▼───────────────┐
│              Simulation Engine (TypeScript)           │
│  ┌───────────┐  ┌────────────┐  ┌─────────────────┐  │
│  │ Traffic    │  │ Signal     │  │ Incident        │  │
│  │ Flow Model │  │ Controller │  │ Manager         │  │
│  │ (Vehicles, │  │ (Webster,  │  │ (Detection,     │  │
│  │  Queues,   │  │  MAXBAND,  │  │  Rerouting,     │  │
│  │  Routes)   │  │  MPC/MARL) │  │  Re-optimization│ │
│  └───────────┘  └────────────┘  └─────────────────┘  │
└──────────────┬───────────────────────────────────────┘
               │ State updates every tick
┌──────────────▼───────────────────────────────────────┐
│          3D Visualization (React Three Fiber)         │
│  10×10 Grid / Vehicles / Signals / Heatmaps          │
└──────────────────────────────────────────────────────┘
```

### 5.2 Simulation Loop (The Heartbeat)

Every simulation tick (e.g., every 1 second of sim-time):

```
function simulationTick(dt: number) {
  // 1. Generate new vehicles at entry points (Poisson process)
  generateDemand(dt);
  
  // 2. Update vehicle positions along their routes
  moveVehicles(dt);
  
  // 3. Process queues at intersections (vehicles stop at red)
  updateQueues();
  
  // 4. Update signal controllers
  for (const intersection of grid.intersections) {
    intersection.controller.update(dt);  // may change phase
  }
  
  // 5. Check for / handle incidents
  incidentManager.update(dt);
  
  // 6. Collect metrics
  metrics.record(grid);  // delays, queue lengths, throughput
  
  // 7. Push state to Zustand store → triggers React re-render
  store.setState(grid.getState());
}
```

### 5.3 Recommended Implementation Order

Here is the sequence that minimizes rework and gives you testable milestones:

**Phase 1 — Foundation (Week 1–2)**
1. Build the 10×10 graph data structure
2. Implement Dijkstra/A* for routing
3. Create a basic vehicle spawner (Poisson arrivals) and mover
4. Implement fixed-time signal control (hardcoded timings)
5. **Milestone:** Vehicles spawn, follow routes, stop at red lights

**Phase 2 — Single Intersection Intelligence (Week 2–3)**
6. Implement Webster's formula
7. Implement phase conflict matrix and smart enumeration
8. Wire up: each intersection auto-optimizes its timing based on observed demand
9. **Milestone:** Intersections adapt timings to demand

**Phase 3 — Corridor Coordination (Week 3–4)**
10. Implement offset-based green wave for one arterial
11. Build the time-space diagram visualization
12. **Milestone:** Visible green wave on main arterials

**Phase 4 — Incident Response (Week 4–5)**
13. Implement incident model (capacity reduction)
14. Implement dynamic rerouting (Dijkstra recomputation)
15. Implement signal re-optimization post-incident
16. **Milestone:** Inject accident → see traffic reroute and signals adapt

**Phase 5 — Network Optimization (Week 5–7)**
17. Implement store-and-forward model
18. Implement MPC rolling-horizon optimizer
19. OR: Implement MARL (if you prefer the ML route)
20. **Milestone:** Demonstrate network-wide coordination beats local optimization

**Phase 6 — Visualization & Polish (Week 7–8)**
21. Build 3D visualization (Three.js / R3F)
22. Build admin panel with real-time metrics
23. Add heatmap overlay (delay / congestion)
24. **Milestone:** Complete demo

---

## Level 6 — Key Metrics & How to Measure Success

### 6.1 Performance Metrics

| Metric | Formula | Target |
|--------|---------|--------|
| **Average delay** | `Σ(vehicle_delay) / num_vehicles` | Minimize |
| **Max queue length** | `max(queue_length)` across all links | < link storage capacity |
| **Throughput** | Vehicles completing trips per hour | Maximize |
| **Average speed** | `Σ(trip_distance / trip_time) / num_vehicles` | Maximize |
| **Queue spillback events** | Count of times queue exceeds link length | = 0 ideally |
| **Incident recovery time** | Time from incident to metrics returning to baseline | Minimize |

### 6.2 Comparison Benchmarks

Run each scenario with three control strategies and compare:
1. **Fixed-time (no optimization):** Baseline. Equal green splits, no coordination.
2. **Webster-optimized (local only):** Each intersection optimizes independently.
3. **Coordinated + adaptive:** Your full system (green wave + MPC/MARL + rerouting).

The improvement from (1) → (2) → (3) tells the story of your project.

---

## Appendix A — Mathematical Quick Reference

### Greenshields Speed-Density Model
```
v(k) = vf × (1 - k/kj)
q(k) = k × vf × (1 - k/kj)
qmax = vf × kj / 4  (at k = kj/2)
```

### BPR Travel Time Function
```
t(v) = t₀ × [1 + 0.15 × (v/c)⁴]
```

### Webster's Optimal Cycle Length
```
C₀ = (1.5L + 5) / (1 - Y)
Y = Σ yᵢ,  yᵢ = qᵢ/sᵢ  (critical lane flow ratio per phase)
L = Σ lᵢ  (total lost time per cycle)
```

### Webster's Delay Formula
```
d = C(1 - λ)² / [2(1 - λx)] + x² / [2q(1 - x)]
where λ = g/C (green ratio), x = q/(s × λ) (degree of saturation)
```

### Pedestrian Minimum Green
```
g_ped = W/1.2 + 7
```

### Offset for Green Wave
```
Δᵢ = dᵢ / v_progression
```

### Poisson Vehicle Generation
```
P(n arrivals in Δt) = (λΔt)ⁿ × e^(-λΔt) / n!
// In code: if Math.random() < λ × dt, spawn a vehicle
```

### Dijkstra Complexity
```
O((V + E) log V) with a binary heap
For 10×10 grid: V = 100, E ≈ 360, so ≈ microseconds
```

---

## Appendix B — Recommended Study Sequence & Resources

### Books (in order of priority)
1. **"Traffic Flow Fundamentals"** — Adolf May → Flow theory, queuing, basics
2. **"CLRS: Introduction to Algorithms"** → Graph algorithms, shortest paths
3. **"Reinforcement Learning: An Introduction"** — Sutton & Barto (free online) → RL foundations for MARL
4. **"Urban Operations Research"** — Larson & Odoni → Network optimization, traffic assignment

### Papers (read in this order)
1. **Webster (1958)** — "Traffic Signal Settings" — the original optimal cycle length paper
2. **Little et al. (1981)** — "MAXBAND" — the green wave bandwidth maximization paper
3. **Diakaki et al. (2002)** — "TUC: Traffic-responsive Urban Control" — store-and-forward + MPC
4. **Wei et al. (2018)** — "IntelliLight" — first practical DRL for traffic signal control
5. **Wei et al. (2019)** — "PressLight" — combines max-pressure theory with deep RL
6. **Koenig & Likhachev (2002)** — "D* Lite" — incremental shortest path algorithm

### Real Systems to Reference
- **SCATS** (Sydney Coordinated Adaptive Traffic System) — adaptive, cycle-by-cycle optimization
- **SCOOT** (Split Cycle Offset Optimization Technique) — British, incremental optimization
- **SUMO** (Simulation of Urban Mobility) — open-source traffic simulator, your validation benchmark

---

## Appendix C — Glossary

| Term | Definition |
|------|-----------|
| **BPR function** | Bureau of Public Roads travel time formula relating volume to delay |
| **Bandwidth** | Width of the green wave band (seconds of unimpeded travel) |
| **Barnes Dance** | Exclusive pedestrian phase where all vehicle movements stop |
| **Conflict matrix** | Boolean matrix defining which movements cannot be green simultaneously |
| **CTDE** | Centralized Training, Decentralized Execution (MARL paradigm) |
| **Cycle length (C)** | Total duration of one complete signal cycle |
| **D* Lite** | Incremental version of A* for dynamic graph changes |
| **Degree of saturation (x)** | Ratio of demand to capacity (>1 = oversaturated) |
| **Effective green** | Actual usable green time after accounting for start/end losses |
| **Green ratio (λ)** | Green time divided by cycle length (g/C) |
| **Intergreen** | Yellow + all-red time between conflicting phases |
| **Lost time** | Time during which no vehicles effectively move (startup, clearance) |
| **MAPPO** | Multi-Agent Proximal Policy Optimization |
| **MAXBAND** | Algorithm to maximize two-way green wave bandwidth |
| **MPC** | Model Predictive Control — rolling-horizon optimization |
| **Offset** | Time shift of a signal's green start relative to a reference signal |
| **Phase** | A set of compatible movements served simultaneously |
| **Platoon** | Group of vehicles traveling together (released by an upstream signal) |
| **Saturation flow (s)** | Maximum departure rate during green (~1800 veh/hr/lane) |
| **Spillback** | Queue from downstream intersection blocking upstream intersection |
| **Store-and-forward** | Macroscopic model treating links as vehicle storage units |
| **Webster's formula** | Optimal cycle length = (1.5L + 5) / (1 - Y) |
