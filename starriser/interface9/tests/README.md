# Galaxy browser test harness

Scenario tests that run production modules from `dist/` inside Chromium (WebGPU).
Agents and CI drive them via CDP over Node 22 built-ins — **no npm test dependencies**.

## Working in parallel

`./tests/run.sh <scenario>` builds into an owned temporary directory, mounts that
directory at `/dist/`, uses OS-assigned HTTP and CDP ports, and removes its build
when the run exits. It does not rebuild the user's `dist/` or attach to the desktop
browser. An occupied explicit HTTP port fails; killing its owner requires the
explicit `--kill-port` option. CPU checks can run concurrently; serialize GPU
measurements on one laptop so results describe the workload being measured.

```bash
./tests/run.sh fleet-integrate-step --artifacts-dir /tmp/galaxy-results
./build.sh --out-dir /tmp/galaxy-my-feature
./tests/run.sh --skip-build --dist-dir /tmp/galaxy-my-feature solar-orbit-mode --headed
node scripts/run-module-tests.mjs features --dist-dir /tmp/galaxy-my-feature
node scripts/run-module-tests.mjs infrastructure
node scripts/run-module-tests.mjs --list
node scripts/check-architecture.mjs
```

Alternate build directories must be new, empty, or marked by a previous Galaxy
build. The builder refuses to clear unrelated nonempty directories, repository
ancestors, or symlink outputs. Use separate outputs for concurrent agents.
`--dist-dir` on `tests/run.sh` selects the build output; combine it with
`--skip-build` to reuse an existing build.

Focused Node suites run through one entrypoint: `features` covers feature
contracts, queued cross-feature events, deterministic fleet domain behavior, and
the actual fleet worker shell. `infrastructure` proves build/server isolation
and architecture-gate failures. Add independent modules under
`tests/modules/<name>/*.test.mjs`, import production code with
`tests/node/build-path.mjs`, and run by module name. Legacy checks with hardcoded
`dist/` imports can also use the selected build:

```bash
GALAXY_BUILD_DIR=/tmp/galaxy-my-feature node --import ./tests/node/register-build.mjs scripts/check-invariants.mjs
```

The architecture checker follows source imports, type imports, re-exports, and
literal dynamic imports. It enforces feature contract boundaries and rejects
host dependencies in domain code. It uses the same global parser tooling as
`scripts/check-complexity.mjs` (`@typescript-eslint/parser` and TypeScript).

Artifacts are optional. `--artifacts-dir` creates a unique child directory containing the manifest and
per-scenario JSON results. `GALAXY_TEST_RUN` and `GALAXY_TEST_SESSION` report the
build, HTTP port, CDP port, profile, and artifact paths. Temporary Chromium
profiles are owned by the test process and cleaned after Chromium exits.

The final atlas-lifetime build passed 183 focused Node tests, including 19
loader lifetime cases, plus invariants and the architecture gate (355 modules,
zero violations). The lifetime suite fails 15 cases against the prior loader.
Its headed hardware run passed 40 of the 41 default scenarios and 8,462 of
8,463 executed assertions. The sole failure is the pre-existing
`planet-gpu-bake` fidelity check: GPU peaks must reach 50% of the JS reference,
but both the final and immutable baseline builds produce 1,229 versus 3,037.
The threshold remains unchanged. Raw results are in
`/tmp/galaxy-final-headed-all.log` and
`/tmp/galaxy-final-regression-artifacts/run-M6KsNW/`.

## Prerequisites

1. **Node 22+** (`node --version`)
2. **Chromium** on PATH or `/snap/bin/chromium` (override with `CHROME_PATH`)
3. **Build production modules** when a test imports them:
   ```bash
   ./build.sh
   ```
   (`smoke-webgpu` does not need `dist/`; most scenarios will.)

### WebGPU launch flags

Chromium on this machine needs a known flag set for WebGPU + remote DevTools.
Those flags are mirrored from the local desktop helper
`~/.local/share/applications/gpu-chromium.desktop` / `~/.local/bin/gpu-chromium`
(**reference only** — the harness launches plain Chromium with the same args,
not the wrapper script):

- `--enable-unsafe-webgpu`
- `--enable-features=Vulkan,ForceEnableWebGpuInterop`
- `--ozone-platform=x11`
- `--remote-debugging-address=127.0.0.1` + `--remote-allow-origins=*`
- temp `--user-data-dir` per run (isolated from any desktop session)

Optional: `GALAXY_WEBGPU_SWIFTSHADER=1` forces a software WebGPU adapter (CI without GPU).

## Quick start

```bash
# One shot: build + serve + Chromium + all scenarios
./tests/run.sh

# One scenario / headed / debug (leave browser open)
./tests/run.sh fleet-jump-then-orbit
./tests/run.sh all --headed
./tests/run.sh --debug fleet-orbit-decouple
./tests/run.sh --skip-build smoke-webgpu

# List scenarios
node tests/scripts/list-tests.mjs

# Lower-level runners (if you already built)
node tests/scripts/run-test.mjs smoke-webgpu
node tests/scripts/run-test.mjs all --timeout 180000
node tests/scripts/debug-test.mjs fleet-integrate-continuous --run
```

### CLI options (`run-test.mjs`)

| Flag | Default | Meaning |
|------|---------|---------|
| `[name\|all]` | `all` | Scenario folder name under `tests/` |
| `--port N` | `0` | OS-assigned static server port; explicit ports supported |
| `--kill-port` | off | Explicitly free busy port (kill listener) then bind |
| `--no-kill-port` | on | Fail immediately on EADDRINUSE with pid list |
| `--dist-dir PATH` | `dist/` | Build mounted at `/dist/` (wrapper uses a temporary build) |
| `--artifacts-dir PATH` | none | Save manifest/results in a unique child directory |
| `--headed` | off | Show browser |
| `--timeout MS` | `60000` | Wait for harness `done`/`error` |
| `--keep-server` | off | Do not close static server on exit |

Exit code **0** if all ran tests `ok`, else **1**.

Machine-readable line for agents:

```text
GALAXY_TEST_RESULT:{"ok":true,"name":"smoke-webgpu",...}
```

## Trail config (game vs tests)

Production map trails stay short (`DEFAULT_TRAIL_CONFIG` in
`js/gpu/fleet-trail-ref.ts` — ring **8**, lifetime **1s**).

Scenario hosts pass `DEBUG_TRAIL_CONFIG` (ring **512**, lifetime **12s**) into
`FleetInstanceGpuLayer` via `createFleetSimHost`. That is **layer init only** —
it does not mutate game module constants or the map view.

Perf/scale scenarios may pass a custom trail (e.g. ring **16**) and raise
`maxShips` above the game ceiling (`GLOBAL_MAX_INSTANCES` = 500k) via
`FleetInstanceGpuLayer` options — still layer-init only; map view never sets these.

## Perf / scale scenarios

Names matching `fleet-perf-*` are **excluded from `all`** (too long / GPU-heavy).
Run explicitly:

```bash
./tests/run.sh fleet-perf-orbit-5m --timeout 600000
./tests/run.sh fleet-perf-renderer --headed --timeout 600000 --artifacts-dir /tmp/galaxy-perf
# list including perf: node tests/scripts/list-tests.mjs --include-perf
```

| Name | Purpose |
|------|---------|
| **fleet-perf-orbit-5m** | ~5M pure-orbit ships, trail ring 16; clamp to device storage limit; report integrate ms + ships/s |
| **fleet-perf-renderer** | Actual map renderer at 960×640 and 1920×1080; 10,000 fleets / 480,000 packed ships; 256 local fleets / 12,288 scene agents; solar overview, focused 4K planet with textured models and trails, galaxy icons |
| **fleet-perf-large-topology** | Separate synthetic strategic workload: 7,000 clusters / 280,000 systems / 286,999 canonical connections plus 10,000 fleet icons / 480,000 packed ships; 2719×1822, height 1e6 and moving pan, 24 warmups / 64 timestamped frames. Verifies actual impostor LOD and no camera-driven geometry writes. This is not a replay of the user's galaxy or a substitute for the canonical scene workload. |

The renderer benchmark uses 24 warm-up frames and 64 measured frames per mode,
with an injected clock advancing exactly 1/120 second each frame. It records
actual candidate/trail/agent counts, GPU indirect hull/emitter/segment counts and raw samples.
The topology is 65 clusters and 769 systems; this does not establish headroom
for every galaxy size. The focus workload retains 10,000 selected hulls and
10,000 trail ships. Hulls outside the frustum are compacted away; independently,
emitters whose complete live ribbon is outside the frustum skip expansion.
The bounds use world width for model pots and the draw's physical-pixel width
coefficient plus maximum view depth for strategic ribbons.
Sample-ring append, ship integration and all ownership lists remain unchanged.
Separate GPU replay diagnostics suppress hull or trail drawing and prove their
visible pixel contribution while holding simulation and history constant. CPU update/encode time, summed
GPU pass timestamps, first-to-last GPU elapsed time and drain-render-completion
time are separate series. CPU and GPU pass p95 must each stay within 8.33 ms;
completion includes queue/driver delivery overhead and is reported separately.
The benchmark requires hardware timestamp queries. Run performance cases alone;
a 60 Hz display does not establish 120 presented FPS.

On the AMD/RDNA3 desktop, the latest canonical 1920×1080 focus GPU p95 was
8.383 ms, above the unchanged 8.333 ms gate; the other five mode/resolution
pairs passed. These are shared-desktop measurements: read-only observation
confirmed that the user's visible 6,978-cluster game advanced 15 frames in
250 ms while an owned headed GPU scenario was running. That proves concurrent
rendering during the observation, not its exact load during earlier samples.
The same immutable benchmark build varied from 8.069 to 8.267 ms across matched
runs. Current evidence does not establish a source regression or consistent
120 FPS headroom. Preserve the failed samples and report this limit explicitly.

RGBA readback, image comparisons and GPU replay proofs run **after all 64 timed
frames**, then restore the saved GPU state. Earlier artifacts placed these heavy
operations between warmup and timing, creating a readback/copy gap and leaving
one extra zero-dt simulation step. Those raw results are retained but should not
be compared directly with the corrected ordering. Compare revisions by running
the same current fixture against each isolated build; retain every measured sample.

For an immutable build predating the injected clock and profiler, use
`--query baseline=1`. This comparison keeps the same workload and resolutions
but uses live simulation time and externally times `renderOnce`. It reports CPU
and completion time only; it cannot establish GPU headroom for that revision.

`--query reference=1` disables model frustum compaction and trail rejection for each measured
frame and uses the original uncached vertex calculation, with the same production
mesh, material and selected candidates. Both paths use the original vertex
calculation; the normal path draws only the GPU-compacted visible indices.
All three visibility compute passes remain included in measured GPU time. The reference's
direct draw count includes offscreen hulls and is not a visible-hull count.
Trail rejection runs inside the existing integrate/expand dispatch; it adds no
compute pass, storage buffer or draw. GPU emitter counts describe expanded
ribbons and remain separate from the 10,000 ships that own trails.

`--query ablation=1` is a separate diagnostic run: each variant gets a fresh
deterministic fixture, the same moving clock and the same 88-frame solar prelude
as the normal benchmark. Keep all agents and selected model indices, and compare
the complete focused frame with only hull encoding or only depth-aware pot trail encoding suppressed.
Each override is restored. These removed-pass timings attribute cost and do not
count as renderer acceptance or replace the complete-workload gates.
`--query ablation=depth` runs only focused planet depth suppression with the same
moving workload; it measures that pass's cost without treating its altered
occlusion as an acceptable image.

`FleetInstanceGpuLayer({ maxShips })` raises grow-only capacity for the test host only.

## Visual demos (`demo-*`, not in `all`)

Names matching `demo-*` are **excluded from `all`**. Run by name (headed recommended for draw+trails):

```bash
./tests/run.sh demo-fleet-2d-30k --timeout 300000
./tests/run.sh demo-fleet-3d-30k --timeout 300000
node tests/scripts/debug-test.mjs demo-fleet-2d-30k --run   # watch
# list including demos: node tests/scripts/list-tests.mjs --include-demo
```

| Name | Purpose |
|------|---------|
| **demo-fleet-2d-30k** | 300 fleets × 100 ships, planar y=0, multi-target hop/cruise, trails |
| **demo-fleet-3d-30k** | Same scale with space3d / y≠0 + angled camera |
| **demo-scenic-3d** | **Tech reel** (~30s): scripted camera + 3D hops/orbits/trails (showcase, not scale test) |

Headless auto-run uses GPU `stepIntegrate` (trail append on, ribbon expand off). Headed draws ships + trails. Shared pack/runner: `tests/common/demo-fleet-30k-run.mjs`.

### Scenic tech demo

```bash
# Watch (recommended) — real-time ~30s camera path + trails
node tests/scripts/debug-test.mjs demo-scenic-3d --run

./tests/run.sh demo-scenic-3d --headed --timeout 300000
# CI-style (full script clock, draw off unless headed):
./tests/run.sh demo-scenic-3d --timeout 300000
```

Camera path: `tests/common/scenic-camera.mjs`. Runner: `tests/common/scenic-demo-run.mjs`.

## Layout

```text
tests/
  README.md                 # this file
  common/
    harness.mjs             # createHarness → window.__galaxyTest
    assert.mjs              # assert / assertEq / assertApprox
    url-params.mjs          # getUrlParams
    fleet-sim-fixture.mjs   # WebGPU fleet pack / step / readback helpers
  scripts/
    serve.mjs               # static server (repo root)
    cdp.mjs                 # CDP WebSocket client + Chromium launch
    run-test.mjs            # normal: launch → run → results → exit
    debug-test.mjs          # headed + leave open
    list-tests.mjs          # discover scenarios
  smoke-webgpu/             # first green test (adapter + device)
    index.html              # docs: purpose, good result, assertions
    main.mjs
  fleet-integrate-step/     # GPU integrate vs CPU fleet-pos golden (stepped)
    index.html              # docs + small canvas
    main.mjs
  fleet-integrate-continuous/  # multi-frame integrate + ship invariants
    index.html              # docs + large canvas (watch ships when headed)
    main.mjs
  fleet-jump-then-orbit/    # JUMP cruise → ORBIT capture at pathEnd → settle
    index.html
    main.mjs
  fleet-orbit-decouple/     # ships orbit pathEnd while fleet marker mid-hop
    index.html
    main.mjs
  ship-dt50-long-hop/       # F1: dt=50ms long hop no tunnel past pathEnd
    index.html
    main.mjs
  ship-heading-180/         # F2: reverse heading wrong-way bound
    index.html
    main.mjs
  ship-capture-R2/          # F5: R=2 enter at 0.2R not ARRIVE_EPS=2
    index.html
    main.mjs
  ship-residual-circulate-under-jump/  # F3: residual dump while fleet JUMPING
    index.html
    main.mjs
  ship-fast-arrival-turn-starved/  # hop-speed entrance; R_turn ≫ R
    index.html
    main.mjs
  <scenario>/               # one folder per scenario
    index.html              # human/agent docs: what / good / assertions
    main.mjs
```

## Scenario catalogue

`all` discovers the default scenarios, including the large galaxy regression.
Dedicated fleet performance scenarios and visual demos
are opt-in; list them with `--include-perf --include-demo`.

Run the large galaxy test on hardware WebGPU, with other benchmarks stopped:

```sh
./tests/run.sh galaxy-generation-large --headed --timeout 90000
```

It uses the editor's actual defaults and intentionally enforces generous but
fixed performance limits; software-rendered or overloaded hosts are not suitable
for qualifying this regression. It reports timings and checks connectivity and
renderer delivery, so a fast partial generation cannot pass. Full topology
diagnostics run after the timed portion. Domain workers use a fixed test seed;
placement is checked by workload floors and graph invariants rather than an
exact system count. This avoids intermittent rejection of random layouts whose
degree and geometry constraints cannot be satisfied.

`./tests/run.sh galaxy-fleet-generation-large --headed` additionally clicks
**Generate 50K Fleets** on that galaxy. It verifies exactly 50,000 delivered
spawns, completed renderer packing, fleet generation under 60 seconds and average
render progress of at least 40 FPS. It is also in `all`; its runner timeout
defaults to 120 seconds for both generation phases. An explicit `--timeout`
still overrides that default.

| Name | Purpose | Good result (summary) |
|------|---------|------------------------|
| **smoke-webgpu** | WebGPU adapter + device available | All ✓; metrics have adapter info |
| **render-worker** | Actual production worker with transferred OffscreenCanvas | Ordered topology/fleets, scene/planet selection and GPU readback; rendering and orbital motion continue through a blocked main thread; bounded snapshots; dispose and fresh-worker boot |
| **app-render-worker** | Production App, DOM input and render-worker integration | Initial topology reaches renderer; UI and camera input cross the worker boundary; renderer remains independent of main-thread work |
| **solar-system-interaction** | Production App, fleet menu and worker camera | Free scene pan, same-angle fleet orbit, selection release, and menu updates as fleets arrive, depart or are removed |
| **solar-planet-tracking** | Selected production camera and real planet depth at anchor 1e7 | The moving planet's opaque surface stays centered at 0, 10 and 120 simulated seconds; catches a rendered/logical orbit-clock mismatch even when atmosphere pixels remain bright |
| **solar-atmosphere-occlusion** | Actual ship pixels in front of and behind a planet rim | Scattering covers background hulls but leaves foreground hulls clear, for both triangle and textured draws |
| **model-trail-attachment** | GPU evaluation of the production model pose | Model center matches the live ship/trail origin at an inclined planet; hull and emitter scales agree |
| **solar-ship-occlusion** | Production scene passes with frozen front/back ship poses | Unselected planets and the sun hide ships behind them, while ships in front remain visible; exercises triangle and textured-model paths |
| **topology-gpu-precision** | Production point and Line2 shaders at anchors 0, 1e5 and 2^30 | Actual pixels agree under translation; fractional camera motion remains continuous; camera updates cause no geometry uploads; buffer/draw counts stay fixed |
| **galaxy-generation-large** | Production editor button, App, all generation mirrors and WebGPU; default 15,000 cluster attempts / 80 systems / 300,000 size | At least 250,000 systems, full connectivity and exact renderer system IDs; generation under 55 s, sampled renderer CPU p95 <16.7 ms, average frame progress >=45 FPS, sampled zoom CPU max <40 ms; included in `all` |
| **galaxy-fleet-generation-large** | The same large galaxy followed by the production 50K fleet button | Exactly 50K spawns delivered once, all live fleets packed, spawn phase <60 s and >=40 FPS; included in `all` |
| **scene-gpu-precision** | Actual focused 4K scene, textured models and trails with an injected frame clock | Moving GPU ship state, planet positions, rendered pixels and body picking agree at anchors 0, 1e5 and 1e7 |
| **model-visibility-gpu** | Full 10k-candidate / 12,288-agent scene, actual textured meshes and planet, GPU-only state replay | 60 cases compare frustum-compacted indirect draws with full unculled draws using the original vertex shader: 48 focus/yaw/grazing/near/inside/follow camera cases and 12 zero/tiny/nonunit-quaternion or fallback-light shader cases at 0, 1e5 and 1e7. Stable visible order/counts, unchanged masks/trails and all agent/ring bytes. Reference draws also use the original `fs_band_c` planet depth pipeline with the same live material. Paired/repeated pixel noise is capped at 4/255 per channel, 1,024 changed channels and 10ppm total signal; translation stays below 0.15%. `--query probe=1` runs only the first compile/render case. |
| **planet-depth-gpu** | Actual scene frame/material uniforms and original vertex shader, depth24plus MSAA×4 targets | Focus/halo/grazing/inside/near/below/oblique cases at 0, 1e5 and 1e7 compare quantized depth samples against original `fs_band_c` sphere math, with transparent atmosphere misses excluded. Every visible planet participates. Per-sample calibration first writes four distinct depths at every pixel; actual pairs then clear to 1. |
| **trail-visibility-gpu** | Real single-ship ribbons; eight-sample ring and ShipSim inputs copied before normal integration | 102 cases retain 21 model-pot cases and add 81 strategic cases across 0, 1e5 and 1e7. Offscreen ship/visible tail, outside endpoints crossing the screen, width grazing, near/camera crossings, oblique depth variation and follow; physical widths compared at two depths, 960×640, 1920×1080 and DPR 2. Actual atlas/solid ribbon contribution and one/three-emitter counts; fully outside ribbons skip expansion. Post-integration ShipSim and complete ring bytes match the scoped trail-only reference, which still performs append. |
| **fleet-integrate-step** | Per-step GPU fleet center ≡ CPU `integrateFleetPos` | `maxPosError` ≪ 0.01; ships finite |
| **fleet-integrate-continuous** | Multi-frame integrate (+ draw when headed); final invariants | `fleetError` ≈ 0; ships on modes; max dist bound |
| **fleet-bulk-10k** | Production worker/broker bulk generation and renderer uploads | 10,000 fleets / 480,000 packed ships; bulk under 2 seconds and galaxy-icon completion median ≤8.5 ms; no compact scene agents or models |
| **fleet-cluster-load** | In-cluster traveler load from real topology waypoints | Finite ships, bounded motion and integrate p95 <50 ms |
| **fleet-model-lod** | Production GLB/material, model selection, follow and three-emitter trail paths | Resource layouts, model cap, real GPU simulation and model/trail draws remain valid |
| **fleet-jump-then-orbit** | JUMP→ORBIT at pathEnd; settle ring + fleet ease | All ORBIT; r≤1.35R+slack; ease match |
| **fleet-orbit-decouple** | Ships orbit pathEnd while FleetGpu.pos mid-hop | mean r→pathEnd ring; ease match; marker mid-hop |
| **planet-authoring-preview** | Baked planet maps through the production authoring preview | Full-resolution GPU pixels, cloud passthrough, zoom/trackball behavior and validation scopes |
| **planet-gpu-bake** | Real GPU bake stages, readback and JS-reference fidelity | Actual fenced stages and fidelity/time limits; currently retains the known baseline peak-count failure documented above |
| **ship-cpu-gpu-parity** | Identical packed inputs through CPU and GPU agent integration | Position, speed and heading agree within float tolerances; mode agrees exactly |
| **ship-long-hop-settle** | Production-speed multi-million-unit hop and final orbit | At least 75% settle into bounded calm rings; explicit camera matrices produce visible trail-only GPU pixels without validation errors |
| **ship-dt50-long-hop** | F1 discrete CFL at dt=50ms long hop | overshoot past pathEnd ≤0.5R; ≥75% ORBIT |
| **ship-heading-180** | F2 wrong-way law (180° initial heading) | wrong-way excursion bound; ≥75% ORBIT |
| **ship-capture-R2** | F5 ρ_enter=max(ε,0.2R) for R=2 | mid rem∈(0.5,1.5) stays SEEK; contact enters |
| **ship-residual-circulate-under-jump** | F3 residual dump under domain JUMPING | after N frames v≤2.5 v_orb; r∈[0.5R,1.5R] |
| **ship-fast-arrival-turn-starved** | Hop speed at entrance; turn radius ≫ R | dump to ≤2.5 v_orb; no hot runaway; ORBIT |
| **ship-stuck-zero-speed-far** | v=0 far (soft-launch freeze) | rem progresses; no stuck-far; ORBIT |
| **ship-stuck-inside-center** | r≈0 singularity | escape ring; no permanent inside |
| **ship-stuck-retarget** | pathEnd A→B mid-mission | calm at B; left A |
| **ship-stuck-chain-hops** | A→B park → B→C | calm B then calm C |
| **ship-stuck-mixed-chaos** | All stuck poses one fleet | ≥75% calm; no singularity |
| **ship-stuck-wide-fast-orbit** | Hot residual CIRCULATE outliers | Peak radius stays bounded, residual speed drops and the final orbit is calm |
| **ship-start-inside-orbit** | Start r&lt;R (inside ring) | expand to r≈R; calm ORBIT |
| **ship-multi-hop-full-speed** | Many fleets, varied distances, full jump speed | each fleet ≥75% calm at its pathEnd |
| **fleet-arrive-formation** | Outer ring → tight inner dests; camera on arrival | each fleet orbits its dest |
| **fleet-waypoint-patrol** | On-camera hops: arrive → wait 1–3s → next point | multi-hop captures + waits |
| **fleet-ingame-cluster-jumps** | Live Cluster 59 hops; production orbit R 2–7, 3200ms domain clock | multi-hop capture + game cooldown |
| **fleet-system-scene-gate** | SCENE bit 7 + `shipsNeedAgent = useFast \|\| systemSceneActive` (no `forceLodNear`); S3B Kepler gate; Year-1 compact into `trailIndirect`; `cs_fleets` always proxies; NEAR non-SCENE `writeLodProxy` | `cs_ships` workgroups 0 at cameraY=2000 and on galaxy follow; SCENE/WARM/inbound hop agents when Kepler loaded; many packed + one SCENE → compact ≪ high-water; NEAR non-SCENE base is origin-relative icon (pad=1); leftover world-size pad=0 → ICON; hide zeros non-SCENE (SCENE `size>0`); no re-pack; 7 storage |
| **solar-scene-band-b** | Band B SCENE: one compact Kepler (sun+≤8, span=0.1) replaces a 5px system; neighbor stays 5px | Dive hides A’s 5px; `centerRel.y = −eyeY`; enter 50px / exit 35px (sun dia=5px); zoom-out + 2500 ms hold restores 5px |
| **solar-scene-band-c** | Band C click-lock + one landed 4K+pole on production `WebGpuMapView` | `tick` without lock does not steal look-at even if limb > 180px; `lockBody` boom (not `MIN_ZOOM`); eyeDist ≈ boom and ≥ R; limb ≥ short−10%; GPU `readbackColorOnce` not all-zero; `pumpHiLoad` until `hiCatalogId()===catalogId` (test does not call `promoteHi`); `lockBody` while following does not move look-at; depth attach models-off; hi release + 5px hysteresis; near ≤ 0.0004 |
| **solar-orbit-mode** | SCENE free/orbit pose on production controller | Free entry and pan; explicit sun/planet acquisition preserves angle; LMB yaw; wheel radius not MIN_ZOOM-clamped; F1 freeze/resume; wheel-out → pan; formation unchanged |
| **solar-year1-10k** | Year-1 10k fleets + one SCENE + one 4K + trails on production `WebGpuMapView` | 10000 fleets; compact `cs_ships` ≪ high-water; formation ranges unchanged on zoom; isolated drain-render-done median ≤8 ms **or** `timestamps=unavailable` + compact-dispatch; one hi pack; no `solar-system/main` |
| **line2-viewrel-thickness** | Spike 5: Line2 viewRel thickness at `\|xz\| ≳ 1e5` | Width within 10% of origin golden; two-frame positions stable; `encode(origin)` does not `setPositions` |
| **fleet-perf-orbit-5m** | Scale: pure orbit, trail ring 16, maxShips override (**not in `all`**) | integrate metrics; clamp OK; ships finite |

Each `index.html` repeats **what it does**, **good result**, **assertions**, and **URL params** for humans and agents browsing the page.


## Browser harness protocol

Each scenario page imports `createHarness` and exposes **`window.__galaxyTest`**:

```js
{
  name: string,
  status: 'idle' | 'ready' | 'running' | 'done' | 'error',
  results: null | {
    ok: boolean,
    name: string,
    durationMs: number,
    assertions: Array<{ name: string, ok: boolean, detail?: string }>,
    metrics?: Record<string, number | string>,
    steps?: Array<Record<string, unknown>>,
    error?: string,
    logs?: string[],
  },
  start: () => Promise<results>,
  getResults: () => results | null,
  getStatus: () => status,
  // optional interactive API
  step?: () => Promise<unknown>,
  getState?: () => unknown,
}
```

### Scenario page template

```js
import { createHarness } from '../common/harness.mjs';
// Production code — same modules as the app:
// import { ... } from '../../dist/gpu/fleet-integrate-ref.js';

const harness = createHarness({
  name: 'my-scenario',
  async run(ctx) {
    // ctx.params  — URL query params
    // ctx.assert(cond, msg) — hard fail (throws)
    // ctx.log(...), ctx.metric(name, value), ctx.recordStep(obj)
    // ctx.check(name, cond, detail?) — soft record
  },
  // optional:
  // step: async (ctx) => { ... },
  // getState: () => ({ ... }),
});
```

URL params:

| Param | Effect |
|-------|--------|
| `run=1` / `autorun=1` | Auto-call `start()` after load |
| others | Passed through `ctx.params` / `getUrlParams()` |

Without `run=1`, status stays **`ready`** until CDP/manual `start()`.

## How the runner works

1. Starts a static HTTP server rooted at the **repo root** (so `/dist/…` and `/tests/…` resolve).
2. Launches Chromium with remote debugging and WebGPU flags:
   - `--enable-unsafe-webgpu`
   - `--enable-features=Vulkan,UseSkiaRenderer`
   - `--disable-gpu-sandbox`
   - headless: `--headless=new` + `--use-angle=swiftshader`
3. Connects over CDP, navigates to  
   `http://127.0.0.1:<port>/tests/<name>/index.html?run=1`
4. Waits until `window.__galaxyTest.status` is `done` or `error`.
5. Reads `JSON.stringify(window.__galaxyTest.results)`, prints summary + `GALAXY_TEST_RESULT:…`, exits.
6. Kills browser and server (unless `--keep-server`).

## Debug / agent CDP control

`debug-test.mjs` leaves Chromium open and chooses a free debug port. Use the port
printed in `GALAXY_TEST_SESSION` for CDP; the user's browser on 9222 is independent.

```bash
node tests/scripts/debug-test.mjs smoke-webgpu
```

Then from another shell:

```bash
node --input-type=module -e '
  import { connectCdp, getPageWebSocketUrl } from "./tests/scripts/cdp.mjs";
  const ws = await getPageWebSocketUrl(Number(process.env.GALAXY_DEBUG_PORT));
  const cdp = await connectCdp(ws);
  await cdp.send("Runtime.enable");
  const results = await cdp.evaluate(`(async () => {
    const t = window.__galaxyTest;
    if (!t) return null;
    if (t.status === "ready" || t.status === "idle") await t.start();
    return t.getResults();
  })()`);
  console.log(JSON.stringify(results, null, 2));
  cdp.close();
'
```

Useful `cdp.mjs` exports:

- `launchChromium({ headless, debugPort, userDataDir, extraArgs })`
- `getDebuggerWebSocketUrl(port)` / `getPageWebSocketUrl(port)`
- `connectCdp(wsUrl)` → `{ send, on, evaluate, waitForFunction, close }`

## Fleet motion quick start

Fleet scenarios share `tests/common/fleet-sim-fixture.mjs` (pack jumping fleet, upload, readback, `integrateUntil`, orbit stats).

```bash
./build.sh   # required for fleet scenarios
node tests/scripts/run-test.mjs fleet-integrate-step
node tests/scripts/run-test.mjs fleet-integrate-continuous
node tests/scripts/run-test.mjs fleet-jump-then-orbit --timeout 120000
node tests/scripts/run-test.mjs fleet-orbit-decouple --timeout 120000
node tests/scripts/run-test.mjs ship-dt50-long-hop --timeout 180000
node tests/scripts/run-test.mjs ship-heading-180 --timeout 180000
node tests/scripts/run-test.mjs ship-capture-R2 --timeout 120000
node tests/scripts/run-test.mjs ship-residual-circulate-under-jump --timeout 180000
node tests/scripts/run-test.mjs ship-fast-arrival-turn-starved --timeout 120000
# optional URL params e.g. steps=20&dt=16&ships=8&eps=0.05
```

## Adding a new scenario

1. Create `tests/<name>/index.html` that loads a module entry.
2. In the module, `createHarness({ name, async run(ctx) { … } })`.
3. Import app code from **`../../dist/...`** (never hand-edit `dist/`; rebuild with `./build.sh`).
4. Prefer hard `ctx.assert` failures; use `ctx.metric` / `ctx.recordStep` for agent-readable diagnostics.
5. Run: `node tests/scripts/run-test.mjs <name>`.

Do not put shared helpers in the scenario folder — put them under `tests/common/`.


## Static server alone

```bash
node tests/scripts/serve.mjs --port 9876
# open http://127.0.0.1:9876/tests/smoke-webgpu/index.html?run=1
```

## Notes

- Chromium-first; WebGPU required (same product constraint as the app).
- Headless WebGPU may need GPU/SwiftShader; if `smoke-webgpu` fails headless but works headed, try `--headed` or adjust Chromium flags in `tests/scripts/cdp.mjs`.
- Scenario discovery: any `tests/*/index.html` except `common/` and `scripts/`.
