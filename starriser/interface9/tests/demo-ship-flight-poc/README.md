# Ship simulation lab

Start with the [runtime integration and tuning guide](../../docs/ship-runtime.md)
for APIs, ownership, configuration, examples and the production integration boundary.

The interactive lab uses one directed WebGPU runtime for continuous individual XYZ
movement, planetary orbit/approach, cinematic warp and battle. It includes six ship
classes, moving planets, scoped density/contact avoidance and timed emitter trails.
The [runtime execution plan](../../docs/research/ship-motion/runtime-plan.md) is the
current status record: **M1–M4 complete and integrated; M5 deferred**.
Production renderer/network integration and production-frame
performance qualification remain deferred.

## Run

The current runtime uses the shared native/WASM planetary model. Prepare an isolated
build, then serve source modules with that output mounted at `/dist`:

```sh
./build.sh --wasm --out-dir /tmp/galaxy-ship-lab-build
node tests/scripts/serve.mjs --port 0 --dist-dir /tmp/galaxy-ship-lab-build
```

Open `/tests/demo-ship-flight-poc/` under the printed server URL in a WebGPU browser.
The old battle URL redirects here. Select 1,000 or 10,000 individual visual agents.
Drag to orbit, scroll to zoom, pause, retarget or follow a ship. Scenario/count/period
changes restart the fixture with a fresh runtime lifetime.

| Scenario | What to inspect |
| --- | --- |
| Moving planet | Inertial XYZ flight follows moving, inclined class rings. |
| 3D approach | Local guidance approaches a moving planet with obstacle avoidance. |
| Directed battle | Live opponent pursuit and per-type tactics obey director target permissions. |
| Warp arrival | Kinematic transit, stretch presentation, timed exit and cruise handoff. |
| Complete lifecycle | One population follows worker-planned approach, battle, reinforcement, losses, escape and return. |
| Four fleets · two battles | Independent battle permissions and pressure scopes merge and split without resetting motion. |

The fast/slow orbital-period presets use the shared planetary model; the selector
labels show the corresponding visible orbit period. Follow rendering keeps the
canonical hull undeformed. A separate cinematic camera-follow spline remains an
optional visual treatment; it is not a second simulation trajectory.

## Director and population controls

The director owns battle admission, type strategy/branches, permitted targets,
losses and event times. Ships select tactical movement and eligible opponents;
they never calculate combat outcomes. Local flight avoids planets; warp corridors
are assumed clear. Pressure membership does not grant attack permission.

- **Reinforce fleet** adds mixed-class representatives and explicit logical counts.
- **Transfer half → next fleet** regroups admitted types while retaining serials,
  poses and trails, subject to the destination's per-type capacity.
- **Pack storage** advances bounded GPU batches while the simulation continues.
- **Grow storage / Release spare storage** manage backing allocation capacity.
- **Reclaim expired ships** releases dead representatives after their display
  history expires, making their ordinals and capacity available again.

See [population ownership](../../docs/research/ship-motion/runtime-population.md)
and [regrouping](../../docs/research/ship-motion/runtime-regrouping.md) for timing,
logical/visual accounting, stable handles and bounded resource contracts.

## Shared pressure, time and ownership

Every interactive scenario uses the 192-byte directed ship state. Current/previous
poses, three 16-sample emitter histories at 60 Hz, event boundaries and sparse
correction records remain GPU-owned. Rendering interpolates without changing the
simulation; the live trail head follows the rendered emitter every frame.

Each pressure field is at most 64³. Cell size and frame expand to cover the relevant
planetary rings and hulls, with margin. The bounded pool supports fleet/planet/battle
scopes and transitions. Capital deposits cover their rotated volume. Local contact
separation also operates outside the field. **3D shared density** displays occupancy;
the timing row samples individual GPU stages asynchronously, not full frame latency.

`../demo-ship-battle-poc/engine.mjs` owns the common runtime and buffers; its director,
roster, worker planner and event/presentation modules own coarse orders, membership,
planning, timing and recovery. `main.mjs` owns the interactive controls. The original
96-byte kernel remains only as a historical comparison fixture, described below.

Current focused hardware validation can be run with:

```sh
./tests/run.sh demo-ship-battle-poc --headed --skip-build --dist-dir /tmp/galaxy-ship-lab-build --query 'test=1&mode=population-lifecycle&count=10000'
./tests/run.sh demo-ship-battle-poc --headed --skip-build --dist-dir /tmp/galaxy-ship-lab-build --query 'test=1&mode=planned-lifecycle&count=1000&population=1&packing=1&retirement=1&regroup=1' --timeout 180000
```

## Mixed-class orbit and arrival behavior

Every scenario includes interceptors, fighters, bombers, frigates, battleships
and colossi. Initial class quotas include one colossus per fleet; later
reinforcement and regrouping can change that mix. Rendered hulls, emitter offsets,
planet clearance and capital avoidance use the same dimensions as battle.

Ring height is measured above the planet surface. Relative to the former 2.4-unit
clearance, interceptor/fighter/bomber/frigate/battleship/colossus multipliers are
4/5/10/20/35/50, with a distinct inclination for each class. The flow controller
uses the ship's current ring phase, radial/plane correction and tangential motion;
it does not pull a displaced ship back to a preassigned moving point. Retarget
changes the preferred plane continuously through the existing bounded integrator.
These rings apply to orbital flight, not backend-directed battle movement.

Approaches use per-type/cohort worker-planned local corridors. Their soft lateral
boundary preserves individual displacement and density response; ring arrival
latches ordinary class guidance. The planet-centered pressure window contains
all rings, hulls and margin, with a 64³ cap and enlarged cells as needed.
Short-range contact hashing independently retains four-unit cells. All scenarios
share spatial ordering, compact contact geometry, parallel masks and event-aware
movement through the same directed engine.

See the [runtime guide](../../docs/ship-runtime.md#navigation-and-warp) and
[completion audit](../../docs/research/ship-motion/runtime-m4-audit.md) for current
behavior and checks. The [volume/arrival report](../../docs/research/ship-motion/volume-and-arrival-results.md)
records the earlier approach-plane checkpoint.

The historical sections below record earlier experiments and their narrower
measurements. Their proposed next steps and limitations do not describe today's
runtime; use the execution plan and current contracts above.

## Historical first-kernel validation and measurement

Run the opt-in browser scenario, with an existing isolated build directory for
the harness (the POC itself does not consume that build):

```sh
./tests/run.sh demo-ship-flight-poc --headed --skip-build \
  --dist-dir /tmp/galaxy-trail-review-build --query 'test=1' \
  --artifacts-dir /tmp/galaxy-flight-poc-results
```

Alternatively open `?test=1` on the served lab. The page reports the harness result.
On September 12, 2026, all **37 assertions passed** in headed Chromium on the
reported AMD RDNA 3 adapter. [Raw result](../../docs/research/ship-motion/poc-evidence/gpu-result.json)
and [source hashes](../../docs/research/ship-motion/poc-evidence/source-snapshot.json)
identify this measurement.

| Active agents | Compute p50 | Compute p95 | Compute p99 | Mean CPU encoding |
| --- | ---: | ---: | ---: | ---: |
| 1,000 | 0.01383 ms | 0.01435 ms | 0.01451 ms | 0.00667 ms |
| 10,000 | 0.05871 ms | 0.06861 ms | 0.07226 ms | 0.00500 ms |

These are **batched compute-pass timestamps**, after 120 warm-up steps over 240
measured steps. The measured kernel includes local guidance, three moving spheres,
one paired threat and three emitter histories. Rendering occurs outside the
measured batch. CPU encoding excludes end-to-end queue latency. These numbers
establish the cost of this small kernel on one adapter; they do not establish
the 2–3 ms production simulation budget or an 8.33 ms complete frame.

Assertions cover displacement/velocity consistency through retarget, sampled
acceleration and jerk bounds, vertical motion, stable IDs, absolute warp progress,
deadline rescheduling, event-straddling handoff and read-only follow rendering.
Trail checks include an independent quaternion oracle, cadence, stop/resume, a
rendered pixel regression for missing endpoints and a positive rendering control.
The battle fixture observed six evasion decisions. The 32-agent, 30-second approach
traversed both guides and had 0.8646 units minimum surface clearance at 0.5-second
sample intervals. That is sampled evidence, not swept collision certification.

Interactive inspection covered warp overview, follow transition, rapid overlapping
reset requests and battle presentation at 1440×900, with no reported GPU errors.
See [QA record](../../docs/research/ship-motion/poc-evidence/interactive-qa.json),
[warp](../../docs/research/ship-motion/poc-evidence/warp.png),
[follow](../../docs/research/ship-motion/poc-evidence/warp-follow.png) and
[battle](../../docs/research/ship-motion/poc-evidence/battle.png).
The available display reported approximately 60 FPS, so this is not a visual
120 Hz qualification. Geometry, lighting and trail art are placeholders.

## Historical next experiments (superseded by the runtime plan)

1. Compare bounded opponent discovery against brute-force reference encounters
   in dense opposing fleets. Measure missed threats, discovery delay, chatter,
   useful evasion decisions and GPU tail latency. Use the
   [independent encounter-graph proposal](../../docs/research/ship-motion/alternative-reactive.md)
   as a candidate; keep this direct paired-contact baseline for cost comparison.
2. Add the actual tactics-worker contract: 1–8 branches per fleet/type, stable
   membership, arbitrary order replacement and shared 3D planetary routes.
   Replace canned guides and soft avoidance with evaluated planning/clearance.
3. Exercise authoritative departure, entry, battle-ready and escape boundaries,
   including late commands, clock corrections, scene changes and device loss.
4. Profile full frames with production meshes, trail expansion, uploads and the
   real worker on representative hardware at 120 Hz before migration.

At that historical checkpoint there was a flat density field and bounded contact
hash, without the later route planner or population lifecycle. The current runtime
adds both; production backend integration/rendering remain deferred, and damage
authority deliberately stays outside visual simulation.
The [review and dispositions](../../docs/research/ship-motion/review-warp-poc.md)
record the independent assessment and remaining limits.
