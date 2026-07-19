# Line2 visual suite + multi-agent review

## Executive summary (Cycle 4 — Agent F4)

**Status:** multi-agent review **complete** — **20 agent cycles**. Unit suite: **189** tests (`node js/vendor/line2/tests/run-line2-tests.mjs`). Library is ready for Galaxy **overlay** wire-up; **not** for fleet trails.

### How to open the visual suite

```bash
# from repo root — build + serve + gpu-chromium (desktop flags)
./scripts/run-line2-visual.sh
```

Or manually:

```bash
./build.sh
node tests/scripts/serve.mjs
# → http://127.0.0.1:8765/js/vendor/line2/visual/index.html
```

Requires WebGPU (Chromium). Harness docs: [`visual/README.md`](./visual/README.md). Kind filters: good · residual · degen · perf · integration.

### Residual tradeoffs (R01–R05) — human accept / avoid

| ID | What you see | Product call |
|----|--------------|--------------|
| **R01** | Thickness **spike** / thrash when geometry skims the **near plane** (`offset × clip.w`) | Accept at extreme near-clip only; keep gameplay geom off the near plane |
| **R02** | Uneven width / NDC warp under **extreme FOV** (~165°) | Accept aesthetic residual; low risk for map cameras |
| **R03** | Rare freckles / endcap pop when **eye ≈ line** (`worldUnits` FS `normalize`) | Accept + well-guarded (no NaN); avoid eye-through-ribbon |
| **R04** | `worldUnits: true` — width **scales with zoom** (dolly) | **Accepted by design** — not for constant-px UI |
| **R05** | `worldUnits: false` — **constant ~px** under same dolly | **Recommended** for selection/hover/edit overlays |

Filter kind=`residual`, leave **animate** on. Side-by-side **R04 vs R05** is the zoom product decision.

### Perf rule

| Use | Line2? | Budget |
|-----|--------|--------|
| Selection / hover / edit-handle rings + sparse UI strokes | **Yes** | **≤ ~256 segs** total common-case (prefer **48**/ring); event-driven rebuild only |
| Soft ceiling (static) | Caution | ~500–1k segs |
| Fleet engine trails / high-N path rewrite | **No** | Keep GPU **`line-list`** (`fleet-trail-ref` / `fleet-trails.wgsl`); P03 8k segs = wrong-tool proof |

Full table: [Recommended budgets for Galaxy](#recommended-budgets-for-galaxy). Integration footguns + camera rules: body of this doc + [`README.md`](./README.md).

### Verification snapshot

| Item | Value |
|------|------:|
| Agent cycles | **20** (complete) |
| Unit tests | **189** |
| Visual cases | H01–H12 (+H06a/b), R01–R05, D01–D05, P01–P05, I01–I02 |
| HIGH ship blockers remaining | **None** from review cycles |

---

**Page:** `js/vendor/line2/visual/index.html`  
**Open:** `./build.sh && node tests/scripts/serve.mjs` →  
`http://127.0.0.1:8765/js/vendor/line2/visual/index.html`

Detailed cycle notes below (Cycle 1–3 appendices). Executive summary above is the durable handoff.

---

## Case index (source of truth: `visual/cases.mjs`)

| Kind | IDs |
|------|-----|
| good | H01–H12, H06a/b |
| residual | R01–R05 |
| degen | D01–D05 |
| perf | P01–P05 |
| integration | I01–I02 |

---

## Performance baseline (P01–P05)

Source: `visual/cases.mjs` (P01–P05), `visual/main.mjs` draw loop, `line-geometry.ts` template, `line2-renderer.ts` `setPositions` / `encode`.

### Geometry cost model (Line2 fat ribbon)

Each segment is **one instance** of a shared template mesh:

| Constant | Value | Source |
|----------|------:|--------|
| Template verts | 8 | `LINE2_TEMPLATE_VERT_COUNT` |
| Indices / triangles | 18 indices → **6 tris** | `LINE2_TEMPLATE_INDEX_COUNT` |
| Draw call | `drawIndexed(18, segmentCount)` | `Line2Renderer.encode` |
| Position floats / seg | 6 (start xyz + end xyz) | `LINE2_POS_FLOATS` |
| Pos upload bytes / seg | **24 B** (`6 × f32`) | `queue.writeBuffer` on instance pos |

**Per N segments (single `Line2Renderer`):**

| Metric | Formula |
|--------|---------|
| Triangles | `N × 6` |
| Index fetches | `N × 18` |
| Template VS invocations (nominal) | `N × 8` (instanced) |
| Instance pos VRAM (tight) | `N × 24 B` (+ grow-only capacity power-of-2) |
| Instance color (if used) | `N × 24 B` |
| Instance dist (dash / seed) | `N × 8 B` |
| Uniforms / frame when dirty | **192 B** (`LINE2_UNIFORM_SIZE`) |

Shared once per renderer (not × N): template VB (8×5 f32 interleaved) + 18×u16 IB.

### Theoretical counts @ 100 / 1k / 8k

Matches P01 / P02 / P03 segment counts (static mesh; same expansion for any solid Line2 draw).

| Segments (N) | Triangles | Indices | VS inv. (8×N) | Pos upload (once) | vs thin `line-list` verts |
|-------------:|----------:|--------:|--------------:|------------------:|--------------------------:|
| **100** (P01) | 600 | 1 800 | 800 | 2.4 KB | 200 |
| **1 000** (P02) | 6 000 | 18 000 | 8 000 | 24 KB | 2 000 |
| **8 000** (P03) | 48 000 | 144 000 | 64 000 | 192 KB | 16 000 |

Thin GPU `line-list` (fleet trails): **2 verts / segment**, no ribbon expand, no soft-AA endcap FS work. Line2 is ~**3×** more triangles than a filled quad strip approximation would need for body-only, and orders of magnitude heavier than `line-list` at the same N (6 tris + screen-space VS vs 1 line primitive).

### P01–P05 case map (what each measures)

| ID | Segments | Camera | Geometry path | Isolates |
|----|--------:|--------|---------------|----------|
| **P01** | 100 | orbit | upload once (`geomReady`) | Comfort baseline — expect ~60 FPS even in multi-tile grid |
| **P02** | 1 000 | orbit | upload once | Mid scale; watch HUD FPS when many tiles active |
| **P03** | 8 000 | orbit | upload once; softAA **off** | Upper stress — “when Line2 is the wrong tool” for high-N |
| **P04** | 2 000 | orbit | `animateGeometry: false` → **draw + camera only** | Pure GPU draw + 192 B uniform (orbit). No `setPositions` after first frame |
| **P05** | 1 500 | orbit | `animateGeometry: true` + `churn: true` | **CPU rebuild + full pos `writeBuffer` every frame** |

**P04 vs P05 (same ballpark N):**

| | P04 (static + orbit) | P05 (per-frame churn) |
|--|----------------------|------------------------|
| Segs | 2 000 | 1 500 |
| Tris / frame | 12 000 | 9 000 |
| `setPositions` / frame | **0** after first | **every** frame |
| Pos bandwidth / frame | 0 | **1 500 × 24 B = 36 KB** |
| CPU / frame | orbit mat4 only | `randomSegments(1500)` alloc + LCG + sin/cos phase + pack alias + `writeBuffer` |

P05 rebuilds with `randomSegments(1500, 11)` then mutates xyz with `sin/cos` phase — always a **new** `Float32Array(9000)`. `packSegmentPositions` **aliases** `Float32Array` (no extra copy), so upload cost is one `writeBuffer` of 36 KB + alloc/GC pressure from the rebuild.

Solid dashed path note: first `setPositions` seeds zero distances once (`hasDistances`); subsequent solid churn does **not** re-upload distances/colors. Only instance **positions** churn on P05.

### When Line2 is wrong vs GPU `line-list` trails

| Use case | Prefer | Why |
|----------|--------|-----|
| Selection rings, edit-handle outlines, sparse UI strokes (tens–low hundreds of segs) | **Line2** | Screen-space width, soft AA, endcaps, dash; one draw per overlay batch |
| High-N fleet engine trails (thousands of segs × many ships, every frame) | **GPU `line-list`** (`fleet-trail-ref` / `fleet-trails.wgsl`) | 2 verts/seg, integrate expand on GPU, fixed slots, no 6-tri ribbon |
| Per-frame full path rewrite at ≥1k segs (P05-style) | Avoid Line2 if avoidable | 24 B×N host→GPU + CPU pack; trails age samples in-place on GPU |
| World-space thick cables that must scale with zoom | Line2 `worldUnits` (see residual R04) | Product choice, not perf-first |

**Rule of thumb (from suite + AGENTS.md):** overlays yes; **do not** replace fleet trail `line-list` with Line2. P03 (8k × 6 = 48k tris, softAA optional) is the visual proof that fat expansion does not scale to trail density.

Rough cost multipliers vs thin `line-list` at same N (order-of-magnitude, not GPU-timed):

| Factor | Line2 | Trail line-list |
|--------|------:|----------------:|
| Raster prims | 6 triangles | 1 line |
| FS work | soft AA endcaps, dash, width | age alpha discard |
| Host churn @ N segs | 24 B/seg if rewritten | GPU ring expand (no host segment list) |
| Instance attrs | pos + color + dist streams | packed trail verts (7 f32) |

### Instrumentation already in HUD (`visual/main.mjs`)

```
FPS {fps} · tiles {cases.length} · ~segs {totalSegments} · {w}×{h} ({dpr}×) · width {scale}×
```

| Field | How measured |
|-------|----------------|
| **FPS** | Frames counted over a **500 ms** window → `frames * 1000 / dt` |
| **tiles** | Active case list length after filter / kind |
| **~segs** | Sum of segment counts: polyline → `len/3 − 1`, segments → `len/6`. Static tiles cache `lastSegs`; churn tiles recount every frame via `build` |
| Resolution / dpr | Canvas buffer size after clamp `devicePixelRatio ≤ 2` |
| width scale | Global UI multiplier on material linewidth |

**How to use for baselines:** filter `kind=perf` so HUD `~segs` ≈ sum of P01–P05 only (100+1000+8000+2000+1500 = **12 600** if all five visible and geom ready).

| Control | Effect on perf tiles |
|---------|----------------------|
| **Pause** | Early-return whole frame — no draw, no upload |
| **Animate off** | `timeSec = 0` (orbit freezes); **P05 still churns** every frame because `animateGeometry` is independent of the Animate checkbox |
| **kind=perf** | Isolates P01–P05 so HUD FPS/segs reflect only those tiles |

Orbit is on for all perf tiles: **P04** is the clean “draw + camera uniforms only” read (no `setPositions` after first frame).

**Not in HUD (future optional):** GPU timestamp queries, `writeBuffer` byte counter, per-tile encode time. Pure CPU pack microbench lives at `tests/pack-microbench.mjs`.

### Draw path summary (multi-tile)

Per active tile, each frame:

1. `setViewport` / `setScissor` for tile rect  
2. `cameraFor` → orbit (perf) updates view/proj  
3. `setMaterial` / `setResolution` / `writeCamera` → uniforms dirty → **192 B** `writeBuffer` on encode  
4. If `animateGeometry || !geomReady`: `build` → `setPositions` (+ optional colors)  
5. `renderer.encode` → `drawIndexed(18, segmentCount)`

Template buffers are static; instance pos capacity grows power-of-2 and is never shrunk.

---

## Cycle findings (appended below)

### Cycle 1 — Agent V1 (bootstrap, multi-viewport, thickness, I01)

**Scope:** `visual/*` harness + `Line2Renderer` APIs used by it.

#### Bootstrap path — OK

| Check | Result |
|-------|--------|
| Import | `main.mjs` → `/dist/vendor/line2/index.js` (absolute from repo-root static server) |
| Build | `./build.sh` emits `dist/vendor/line2/*`; serve via `node tests/scripts/serve.mjs` |
| Open | `http://127.0.0.1:8765/js/vendor/line2/visual/index.html` |

#### Multi-viewport / resolution / camera — OK

| Check | Location | Result |
|-------|----------|--------|
| `setViewport` + `setScissorRect` | `main.mjs` per tile | Isolates color + depth writes per tile |
| `setResolution(r.w, r.h)` | per tile, **device px** | Matches WGSL `offset / resolution.y` (viewport-sized NDC) — correct thickness |
| `writeCamera({ modelView, projection })` | separate mats | `writeMat4` copies into per-renderer uniform staging; shared `viewScratch`/`projScratch` safe |
| Aspect | `r.w/r.h` for proj + `resolution.x/y` in shader | Consistent |

#### Depth / I01

| Fact | Detail |
|------|--------|
| Suite pass | Always `depth24plus` attachment (one pass for all tiles) |
| Most renderers | `depthFormat: "depth24plus"` |
| **I01** (Cycle 1) | Emulated color-only via **`depthTest: false` + `depthWrite: false`** — **not** `depthFormat: null` |
| **I01** (Cycle 3 Q4) | **`depthFormat: null`** — true Galaxy color-only pipeline |
| **I02** | Real depth vs occluder |

**Doc fix applied (C1):** `visual/README.md` Depth/I01 section; `cases.mjs` I01 title/hint; `main.mjs` comments.  
**Pipeline fix applied (C3 Q4):** I01 uses `depthFormatNull` → `depthFormat: null`.

#### Bugs fixed (this agent)

| Sev | File | Issue | Fix |
|-----|------|-------|-----|
| **HIGH** (perf validity) | `main.mjs` | `placeCaptionElements` rebuilt 30 DOM nodes **every rAF** — GC/layout noise invalidates P0x FPS HUD | Caption rebuild gated on case-set + buffer size key |
| **MEDIUM** (docs) | `cases.mjs`, `README.md`, `main.mjs` | I01 claimed `depthFormat null` / Galaxy color-only | Documented true behavior |

#### Residual risks (not fixed / low)

| Sev | Item |
|-----|------|
| LOW | H05 `multiWidth` re-`setPositions` 12× every frame (static geom) |
| LOW | `alphaMode: "premultiplied"` canvas + straight `LINE2_BLEND` may tint translucent H09 slightly |
| LOW | Linewidth is **device** pixels (DPR-capped at 2), not CSS px |
| INFO | True Galaxy `depthFormat: null` pipeline was untested here — **superseded by Cycle 3 Q4** (I01 now uses `depthFormat: null`) |

#### No HIGH thickness / boot blockers found

Page should load after build+serve; multi-tile screen-space width math is consistent.

### Cycle 1 — Agent V3 (residual / accepted-risk cameras)

**Scope:** R01–R05 vs `line2-wgsl.ts` screen-space `clip.w` path and `worldUnits` FS `normalize(worldPos)`.

#### Path ↔ case map

| Case | WGSL path | Camera key |
|------|-----------|------------|
| R01 | VS screen: `ndc = clip.xyz/clip.w`; `offset *= clip.w` then add to `clip.xy` | `nearClip` |
| R02 | VS screen: `dir = ndcEnd.xy - ndcStart.xy` under extreme FOV | `extremeFov` |
| R03 | VS world expand + FS `normalize(input.worldPos.xyz) * 1e5` + `closestLineToLine` | `worldNear` |
| R04 | worldUnits thickness in world space (screen size ∝ 1/distance) | `dolly` |
| R05 | same dolly, screen-space px (control / recommended) | `dolly` |

#### Pre-tweak severity (were residuals actually stressed?)

| ID | Pre-tweak | Why |
|----|-----------|-----|
| R01 | **Mild / near-untestable** | `eyeZ≈0.12`, `near=0.05` → min `clip.w` for origin ~0.13 (≫ near). NDC stayed stable; thickness spike rarely visible. |
| R02 | **Moderate** | 140° / r=3 stressed NDC some; not grazing enough for clear edge warp. |
| R03 | **Mild / near-untestable** | Eye dist ~0.37–0.66; view-space `|worldPos|≳0.25` → `normalize` well-conditioned; guards for mid≈0 never hit. |
| R04 | **Mild** | Dolly only ~2.2× (z 6.3…14); zoom scaling easy to miss. |
| R05 | OK as control | Same mild dolly; contrast vs R04 was weak. |

#### Param tweaks applied (`cameras.mjs` + residual geometry/hints in `cases.mjs`)

| Camera / case | Before | After |
|---------------|--------|-------|
| `cameraNearClipW` | eyeZ 0.12±0.02, eyeY 0.05, near 0.05, fovy 70° | eyeZ 0.028±0.01, eyeY ~0.004, **near 0.015**, fovy 80° |
| R01 geom | X + short Z | + Z arm to z=0.05 + shallow XY seg so an endpoint tracks ~near |
| `cameraExtremeFov` | 140°, r=3, y=0.8 | **165°**, r=1.6, low pitch y~0.25 |
| R02 geom | 3 segs | + Z axis for more edge NDC |
| `cameraWorldUnitsNearEye` | r 0.35±0.1 | **r 0.07±0.045**, near 0.02, fovy 70° |
| R03 geom / lw | cross, lw 0.15 | + diagonal short arm; lw 0.12 (ribbon can skim eye) |
| `cameraDollyPerspective` | z ∈ [0.45,1]·baseZ (~6…14) | z ∈ [~2, 2·baseZ] (~2…28 with baseZ=14) |

#### Expected visual failure modes (human eval checklist)

1. **R01 — thickness spike / holes near plane**  
   Animate on. Red lines should **balloon** or thrash when the toward-camera arm skims the near plane; possible one-frame fullscreen-ish quads; softAA may flash alpha holes.  
   *Accept as residual* if spike is intermittent near plane only; *escalate* if solid lines spike at comfortable distances.

2. **R02 — NDC warp**  
   Orange diagonals while orbiting: width should look **uneven** toward image edges; possible twist of ribbon orientation. Not a hard crash residual.

3. **R03 — FS conditioning**  
   Magenta worldUnits cross: look for **freckled discards**, missing endcaps, or sudden alpha collapse when camera sin-wave is closest. If still perfectly clean, residual remains hard to repro on GPU (guards working — note severity **low / guarded**).

4. **R04 vs R05 / H12 — zoom scaling**  
   Cyan R04: width **must** change dramatically through dolly (accepted worldUnits behavior). Green R05: width **must hold** ~constant px. Side-by-side is the product decision tile.

#### Reproduction plan

```bash
./build.sh
node tests/scripts/serve.mjs
# open:
# http://127.0.0.1:8765/js/vendor/line2/visual/index.html
```

1. Kind filter → **residual**; ensure **animate** checked; pause off.  
2. Spend ≥5 s on each tile (cameras are time-based).  
3. Optionally width slider ×2 on R01 to exaggerate spike.  
4. softAA force-off on R01/R03 to see hard discard holes vs soft freckles.  
5. Compare R04 ↔ R05 (and H12) under identical dolly.

#### Residual severity summary (post-tweak intent)

| ID | Testability after tweak | Product severity if seen |
|----|-------------------------|---------------------------|
| R01 | **High** (params now target w~near) | Medium for gameplay cams that clip geometry; avoid world geom through near plane |
| R02 | **High** | Low–medium aesthetic only |
| R03 | **Medium–high** (depends on how close ribbon gets to eye) | Low if only at extreme near-eye; guards prevent NaN |
| R04 | **High** (by design) | Accepted — do not use worldUnits for constant-px overlays |
| R05 | Control / pass target | N/A (recommended path) |

**Untestable residual note:** Pre-tweak R01/R03 were effectively untestable at intended residual severity; post-tweak they should be human-visible. If R03 still never freckles, classify FS normalize residual as **accepted + well-guarded** (code paths exist, numerical floor holds).

### Cycle 1 — Agent V4 (degenerate cases D01–D05)

**Scope:** D01–D05 in `visual/cases.mjs`; guards in `line2-wgsl.ts`, `line2-expand-ref.ts`, `line2-renderer.ts` grow/`setColors`; packing in `line-geometry.ts`; D05 animate path in `visual/main.mjs` `applyGeometry`.

#### Case → guard map

| ID | Geometry | Expected | Library path |
|----|----------|----------|--------------|
| **D01** | Zero-length + valid H segment | Stable stub at origin; **no** NaN fullscreen trash | VS screen: `dirLen ≤ 1e-8` → `dir=(1,0)`; expand-ref parity |
| **D02** | 3 tiny segs (≤0.02 wu) | Endcap-dominated blobs (lw=8) | Same path; short body + endcap skirts |
| **D03** | Collinear chain + full reverse + vertical | Overlapping ribbons; no black holes | Reverse is non-zero length; dir normalizes cleanly |
| **D04** | Single H, **linewidth=1**, softAA | Minimum-visible 1px body (soft only on endcaps) | softAA branch only when `abs(vUv.y)>1` |
| **D05** | Alternate 1 ↔ 12 segs + vertex colors | Colors survive grow | See applyGeometry path below |

#### D05 grow + setColors (verified)

```
build(t) → { positions, colors }   // both phases always supply colors
main: animateGeometry → every frame:
  applyGeometry(renderer, built)
    setPositions(...)              // may grow instance buffers
    if (built.colors) setColors(...)  // ALWAYS re-called after setPositions
  encode
```

Grow path (`ensureInstanceBuffers`): new color buffer → `hasColors=false` + white seed; **`material.vertexColors` left true**. Same-frame `setColors` restores RGB before `encode` — D05 cannot flash white on grow if animate path stays as written.

Initial capacity is 4 segs (`ensureSize`); first 12-seg upload grows to 16. Subsequent 1↔12 toggles do not re-grow (capacity sticks) but still re-`setColors` every frame.

#### Guards checklist

| Guard | Location | Status |
|-------|----------|--------|
| NDC dir zero-length | `line2-wgsl.ts` + `line2-expand-ref.ts` | ✓ `dirLen > 1e-8` else horizontal |
| worldUnits worldDir / mid / cross | `line2-wgsl.ts` VS | ✓ (D01–D05 are screen-space; still present) |
| closestLineToLine denom | `line2-wgsl.ts` FS | ✓ |
| linewidth floor (world FS) | `max(u.linewidth, 1e-6)` | ✓ |
| zero-length distances | `computeLineDistances` | ✓ len=0 → `[0,0]` |
| pack length / color count | `line-geometry.ts` | ✓ throws on bad strides |
| setColors before positions | `Line2Renderer.setColors` | ✓ throws |
| grow invalidates colors | `ensureInstanceBuffers` | ✓ white seed + hasColors=false |

#### Severity

| Item | Severity | Notes |
|------|----------|-------|
| NaN from zero-length screen-space | **None** (guarded + unit-tested in expand-ref) | |
| D05 missing setColors after grow | **None** in visual | applyGeometry always pairs colors |
| Shrink then expand **without** setColors (API footgun) | **Low** | Stale slot colors if capacity already large; README only documents grow→white |
| worldUnits FS `normalize(worldPos)` near origin | **Residual** (R03) | Not exercised by D01–D05 |

**HIGH bugs fixed this cycle:** none (no code changes).

#### Tests

```bash
node js/vendor/line2/tests/run-line2-tests.mjs
```

Expect expand-ref zero-length multi-corner finite + geometry-material zero-length distances. Re-run after any library edit.

### Cycle 2 — Agent P2 (GPU encode & upload path)

**Scope:** `line2-renderer.ts` `ensureInstanceBuffers` / `setPositions` / `encode`; P04 static vs P05 churn in `visual/cases.mjs` + `visual/main.mjs`. No library code changes (no HIGH bugs).

#### Call graph (library)

```
setPositions(positions, opts?)
  packSegmentPositions | polylineToSegments   // F32 alias if already Float32Array
  ensureInstanceBuffers(max(segCount, 1))     // grow-only power-of-2 caps
  queue.writeBuffer(instancePos, 0, packed)  // only if segCount > 0
  if wantDist (dashed | computeDistances):
    computeLineDistances + writeBuffer(dist)  // segCount × 8 B
  else if !hasDistances:
    seedDistancesOnly(...)                    // once for solid

writeCamera / setMaterial / setResolution
  → uniformsDirty = true  (no GPU yet)

encode(pass)
  if segmentCount == 0: return
  if uniformsDirty:
    writeMaterialUniforms(staging)
    queue.writeBuffer(uniformBuffer, 0, …, LINE2_UNIFORM_SIZE)  // 192 B
  setPipeline + setBindGroup(0, bindGroup)
  setVertexBuffer(0..3) template + pos + color + dist
  setIndexBuffer(template, uint16)
  drawIndexed(18, segmentCount)
```

#### `writeBuffer` sizes (actual upload, not VRAM capacity)

| API path | Buffer | Bytes written | When |
|----------|--------|--------------:|------|
| `setPositions` pos | instance pos | **`N × 24`** (`N × LINE2_POS_FLOATS × 4`) | every call with `N>0` |
| `setPositions` dashed dist | instance dist | **`N × 8`** | when `computeDistances` or `material.dashed` |
| `setPositions` solid first dist | instance dist | **`cap × 8`** via `seedDistancesOnly` | only while `!hasDistances` |
| `setColors` | instance color | **`N × 24`** | explicit call |
| `setDistances` | instance dist | **`N × 8`** | explicit call |
| `seedColorsOnly` (grow) | instance color | **`cap × 24`** (white fill) | pos/color buffer recreate |
| `seedDistancesOnly` (grow) | instance dist | **`cap × 8`** (zeros) | dist buffer recreate |
| `encode` uniforms | uniform | **`192`** (`LINE2_UNIFORM_SIZE`) | when `uniformsDirty` |

Important: pos/color/dist **instance** uploads use the packed view’s `byteLength` (= live `segmentCount` stride), **not** the full power-of-2 capacity. Grow seeds fill the **new capacity** once.

`packSegmentPositions(Float32Array)` **aliases** (no CPU copy). Non-`Float32Array` → one host copy. P05 always builds `Float32Array` → alias → one pos `writeBuffer`.

#### Capacity doubling (`ensureInstanceBuffers` + `ensureSize`)

```ts
// ensureSize(needed, current): start 4 if empty; while (cap < needed) cap *= 2
```

| Field | Unit | Stride (bytes/seg) | Shrink? |
|-------|------|-------------------:|---------|
| `posCapacity` | segments | 24 | never |
| `colorCapacity` | segments | 24 | never |
| `distCapacity` | segments | 8 | never |

Independent grow per stream. On grow: `old?.destroy()` → `createBuffer(cap × stride)` → color grow clears `hasColors` + white seed; dist grow sets `hasDistances=true` + zero seed.

**Init:** `ensureInstanceBuffers(1)` → capacity **4** each stream (dummy seed so vertex slots always exist).

**P04 first upload (N=2000):** 4 → 8 → … → **2048**.  
VRAM after grow (tight formula = capacity, not N):

| Stream | VRAM @ cap 2048 |
|--------|----------------:|
| pos | 2048 × 24 = **48 KB** |
| color (white seed, unused draw path) | 2048 × 24 = **48 KB** |
| dist (zero seed) | 2048 × 8 = **16 KB** |
| **instance total** | **112 KB** |

**P05 first upload (N=1500):** same ladder → **2048**. Steady-state churn never re-grows (fixed N).

Subsequent same-N `setPositions` do **not** destroy/recreate buffers.

#### Bind group stability

| Object | Lifetime | Recreated when |
|--------|----------|----------------|
| `bindGroup` | long-lived | **only** `maybeRebuildPipeline` (depthTest / depthWrite flip) |
| Bind group entry | `uniformBuffer` only | — |
| Instance pos/color/dist | vertex slots 1–3 | **not** in bind group |

Growing instance buffers does **not** touch the bind group. `encode` rebinds vertex buffers every draw (`setVertexBuffer`), so new GPUBuffer handles after grow are picked up automatically. Pipeline + bind group stay hot across P04/P05 steady state (orbit only dirties uniforms, not depth flags).

**Stability verdict:** bind group is stable for geometry churn; vertex buffer rebinding is the intended hot path.

#### P04 (static encode) vs P05 (churn `setPositions`)

Harness (`main.mjs`):

```
if (animateGeometry || !geomReady) {
  build(t) → applyGeometry → setPositions [+ setColors if any]
  geomReady = !animateGeometry
}
renderer.encode(pass)  // every tile every frame
```

| | **P04** Static + orbit | **P05** Per-frame churn |
|--|------------------------|-------------------------|
| Case flags | `animateGeometry: false` | `animateGeometry: true` |
| N | 2000 | 1500 |
| First frame | `setPositions` once + grow to 2048 + solid dist seed once | same pattern (grow once) |
| Steady `setPositions` | **0** | **1 / frame** |
| Steady pos upload | **0 B** | **1500 × 24 = 36 KB / frame** |
| Steady dist/color upload | **0** (`hasDistances` sticks) | **0** (solid, no colors) |
| Steady uniforms | **192 B / frame** (orbit `writeCamera` + suite `setMaterial`/`setResolution` always dirty) | same 192 B |
| Draw | `drawIndexed(18, 2000)` → 12k tris | `drawIndexed(18, 1500)` → 9k tris |
| CPU extra | none after first (geomReady) | `randomSegments(1500)` **new** F32(9000) + sin/cos phase + queue write |
| Bind group | stable | stable |
| Instance buffer recreate | none after first | none after first |

P05 isolates **host rebuild + pos bandwidth**; P04 isolates **draw + camera uniforms**. Both pay the same 192 B uniform path because the visual suite always calls `setMaterial` / `setResolution` / `writeCamera` per tile per frame (even if linewidth/color unchanged — `setMaterial` always sets `uniformsDirty`).

Solid-path note (both): after first `seedDistancesOnly`, solid `setPositions` skips dist re-upload (`hasDistances === true`). P05 only rewrites **positions**.

#### Encode hot path (steady state, one tile)

**P04:**

1. `writeMaterialUniforms` + `writeBuffer(uniforms, 192)`  
2. `setPipeline` / `setBindGroup` / 4× `setVertexBuffer` / `setIndexBuffer`  
3. `drawIndexed(18, 2000)`  
No instance `writeBuffer`.

**P05:**

1. CPU: allocate + fill 9 000 floats, alias pack  
2. `writeBuffer(pos, 36 KB)`  
3. same encode as P04 with instance count 1500  

#### Findings / severity

| Sev | Item | Notes |
|-----|------|-------|
| **None (HIGH)** | — | No correctness bugs on encode/upload; capacity + bind group behavior matches design |
| INFO | Suite always dirties uniforms | Inflates both P04/P05 by 192 B; does not invalidate relative churn vs static comparison |
| INFO | Grow seeds full capacity | One-time cost; color seed unused on solid white material path |
| LOW (API) | Grow clears `hasColors` | Documented; P04/P05 do not use vertex colors |
| LOW (suite) | First static frame may call `build` twice | `lastSegs \|\| segmentCountOf(c.build(0))` after apply — harness only |
| INFO | Capacity never shrinks | Intentional grow-only; long-lived overlay with rare N spike keeps peak VRAM |

#### Recommendation (product, not code change)

- Overlays / static or rarely updated fat lines: **P04-class** path (upload once, encode + camera).  
- Per-frame full path rewrite ≥~1k segs: prefer GPU `line-list` trails (AGENTS.md); P05 is the cost proof, not a target product path for fleets.

**HIGH bugs fixed this cycle:** none.


---

## Recommended budgets for Galaxy

Derived from **Performance baseline (P01–P05)** above, AGENTS.md map-overlay intent (M4 selection/hover rings + edit-handle gizmo; **not** fleet trails), and current `map-overlay-pack` defaults (`packRingLineLoop` **48** segments/ring).

Line2 cost reminder: **6 tris / segment**, **24 B** pos upload / segment when rewritten, **1 draw** per `Line2Renderer` batch. Overlays are **few polylines, rare rebuilds** (selection change), never per-frame full rewrites at trail scale.

### Budget table

| Surface | Segments (N) | Polylines / draws | Update cadence | Status |
|---------|-------------:|-------------------|----------------|--------|
| **Selection ring** (one cluster/system) | **32–64** (prefer **48**, matches `packRingLineLoop`) | 1 closed polyline | On select only | **OK — primary** |
| **Hover ring** (one target) | **32–64** (same as select) | 1 closed polyline | On hover change | **OK — primary** |
| **Edit-handle ring** | **48** | 1 closed polyline | On enter/leave edit + drag end | **OK — primary** |
| **Edit-handle axes** | **2** (+X, +Z) | 1–2 short segs (or share ring batch) | Same as handle | **OK** |
| **Multi-select rings** (capped set) | **48 × K**, K ≤ **4** → ≤ **~192** segs | K closed polylines | On selection set change | **OK** if batched |
| **Sparse UI strokes** (dash guides, one-off outlines) | **tens** total | few | Event-driven | **OK** |
| **Comfort total (all overlays)** | **≤ ~256** segs | **≤ ~6** polylines preferred; **1–2** `Line2Renderer` batches | Static between UI events | **Target** (≪ P01 100 per busy tile; multi-item still under P02) |
| **Soft ceiling** | **~500–1 000** segs total | still few draws | Avoid full rewrite every frame | **Warn** — P02 territory; softAA on is fine if static |
| **Hard “wrong tool”** | **≥ ~8 000** segs (P03) | — | — | **Do not** use Line2 |
| **Per-frame geometry churn** | **≥ ~1 500** segs rewritten/frame (P05-style) | — | every rAF | **Do not** — 24 B×N host upload + CPU pack |
| **Fleet engine trails** (any scale; especially **~10k fleets**) | N/A for Line2 | — | every frame (GPU integrate) | **Forbidden** — keep **GPU `line-list`** (`fleet-trail-ref` / `fleet-trails.wgsl`) |

### Worked costs (Galaxy-shaped loads)

| Scenario | Approx. N | Tris | Pos VRAM | Notes |
|----------|----------:|-----:|---------:|-------|
| Select + hover (2×48) | 96 | 576 | ~2.3 KB | Comfort; one upload on change |
| Select + hover + edit ring + axes | ~98 | ~588 | ~2.4 KB | Typical editor peak |
| 4 multi-select rings @ 48 | 192 | 1 152 | ~4.6 KB | Still far below P01 stress |
| Hypothetical “fat trail” for 10k fleets × 16 trail segs | **160 000** | **960 000** | **~3.8 MB** rewrite if host-driven | **Insane** for Line2; trails stay GPU line-list |

### Rules of thumb (wire-up checklist)

1. **Rings/handles:** use Line2 at **~48 segs/ring**, screen-space width (`worldUnits: false`), softAA on; `depthFormat: null` for Galaxy color-only pass.
2. **Few polylines:** batch selection/hover/handle into **one or two** renderers / draws — do not spawn a `Line2Renderer` per entity on hot paths.
3. **Rebuild only on UI events** (select/hover/edit commit), not every frame; never P05-style full random rewrite for overlays.
4. **Do not** route high-N fleet trails through Line2 — P03 (8k segs → 48k tris) is the visual proof of the wrong tool; 10k fleets are orders of magnitude beyond that. Map overlays + topology connections are intentional Line2 use (pack-on-dirty / event-driven).

---

## Line2 vs fleet line-list

**Cycle 2 — Agent P3.** Sources: `js/vendor/line2/` (template + `drawIndexed` instanced ribbon), `js/gpu/fleet-trail-ref.ts` (`TRAIL_SEGS` / ring), `js/gpu/shaders/fleet-trails.wgsl.ts` + `fleet-integrate.wgsl.ts` (GPU expand + line-list draw).

### Comparison table

| Dimension | **Line2** (vendor fat ribbon) | **Fleet trails** (`line-list`) |
|-----------|-------------------------------|--------------------------------|
| **Topology** | `triangle-list`, **instanced** | `line-list`, non-instanced `draw` |
| **Prims / segment** | **6 triangles** (18 indices) | **1 line** (2 verts) |
| **Verts / segment** | Template **8** verts × 1 instance (shared mesh) | **2** expanded verts |
| **Draw call** | `drawIndexed(18, N)` — N = segment count | `draw(shipCount × TRAIL_VERTS_PER_SHIP)` — fixed slots |
| **Per-ship budget** | N/A (batch by overlay) | `TRAIL_RING_SIZE=8` samples → **`TRAIL_SEGS_PER_SHIP=7`** segs → **14** verts/ship |
| **Thickness** | Screen-space **`linewidth` px** (or `worldUnits`) | Hardware **1 px** hairline (no fat expand) |
| **AA / polish** | Soft `fwidth` endcaps, round-ish skirts, optional dash | Age **alpha** only; `discard` if `a ≤ 0.001`; no endcaps |
| **Expand path** | **VS** offsets template in NDC/view (`line2-wgsl.ts`) | **Compute** `cs_ships`: ring age/append → fixed-slot line verts |
| **Host vs GPU expand** | Host packs **start/end** (6 f32/seg = **24 B**); optional color/dist streams; VS expands | Host packs once at spawn; **GPU** owns ring + line expand every frame (no host segment list) |
| **Payload / seg (tight)** | Pos 24 B (+ color 24 B + dist 8 B if used); uniforms 192 B dirty | 2 × 7 f32 = **56 B** expanded line verts (+ 8×16 B sample ring / ship) |
| **Suitable scale** | Overlays: **tens–low hundreds** segs; P03 **8k** = stress / wrong tool | High-N: **ships × 7** segs every frame (formation NEAR + lead MID) |
| **Camera inputs** | Separate **view + projection** (never fused viewProj) | Fused **viewProj** mat4 uniform |
| **Galaxy wire-up** | Not yet on map; intended for selection/edit strokes | **Live** in `FleetInstanceGpuLayer.encodeTrails` |
| **Wrong use** | Per-frame full path rewrite ≥1k segs; trail density | Thick constant-px UI rings/handles (no width control) |

### Cost sketch (same N segments)

| N segs | Line2 tris | Line2 VS inv. (8×N) | Trail line prims | Trail verts |
|-------:|-----------:|--------------------:|-----------------:|------------:|
| 100 | 600 | 800 | 100 | 200 |
| 1 000 | 6 000 | 8 000 | 1 000 | 2 000 |
| 8 000 | 48 000 | 64 000 | 8 000 | 16 000 |

Trail path stays ~**1 line prim / seg** and does **GPU** ring expand; Line2 is ~**6×** more raster work plus soft-AA FS and host instance streams.

### Recommendation

| Use case | Choice | Why |
|----------|--------|-----|
| Map **overlays** (selection/hover rings, edit-handle outlines, sparse UI strokes) | **Line2** | Screen-space width, soft AA, endcaps, dash; overlay N is small |
| **Fleet engine trails** (many ships × ring segs, every frame) | **Stay `line-list`** | 2 verts/seg, integrate expand on GPU, fixed slots, age alpha — matches S1 scale |

**Rule:** wire Line2 into overlays only; **do not** replace L5b fleet trail `line-list` with Line2 fat triangles.

---

## Memory & capacity

**Cycle 2 — Agent P4.** Sources: `line2-renderer.ts` (`ensureSize`, `ensureInstanceBuffers`), `line-geometry.ts` (float strides + template), `line2-material.ts` (`LINE2_UNIFORM_SIZE`).

### `ensureSize` policy

```ts
// Pure export: ensureSize(needed, current)
if (needed <= current) return current;          // never shrink
let cap = current > 0 ? current : 4;            // empty seed = 4 segs
while (cap < needed) cap *= 2;                  // power-of-two grow
return cap;
```

| Property | Behavior |
|----------|----------|
| Grow | Double until `cap ≥ needed` |
| Shrink | **Never** — capacity sticks after peak |
| Initial seed | `current === 0` → start at **4**, then double |
| Init path | `initGpu` → `ensureInstanceBuffers(1)` → **pos/color/dist capacity = 4** |
| D05 example | 4 → need 12 → **16**; later 1↔12 reuses 16 (no re-grow) |

Unit-tested in `tests/geometry-material.test.mjs` (pure; no GPU).

### Buffer layout (bytes)

| Buffer | Formula | Bytes / seg | Notes |
|--------|---------|------------:|-------|
| **Instance pos** | `cap × LINE2_POS_FLOATS × 4` | **24** | start xyz + end xyz |
| **Instance color** | `cap × LINE2_COLOR_FLOATS × 4` | **24** | start rgb + end rgb (always allocated) |
| **Instance dist** | `cap × LINE2_DIST_FLOATS × 4` | **8** | dStart + dEnd (always allocated) |
| **Instance total** | | **56** | pos + color + dist |
| **Template VB** | `8 × 5 × 4` | — | pos3+uv2 interleaved, **160 B** once |
| **Template IB** | `18 × u16` | — | **36 B** once |
| **Uniforms** | `LINE2_UNIFORM_SIZE` | — | **192 B** once; rewrite when dirty |

Color and dist instance buffers exist even when `vertexColors` / `dashed` are false (bind layout always binds slots 2–3; solid path seeds white colors + zero distances).

### Grow invalidates colors (`hasColors = false`)

On color-buffer recreate (`need > colorCapacity` or missing buffer):

1. Destroy old color GPU buffer; allocate new power-of-2 size
2. `hasColors = false`
3. `seedColorsOnly(cap)` → full-capacity write of **1.0** (white)
4. **`material.vertexColors` is left unchanged** (may still be true)

**API footgun:** after any grow, prior per-endpoint colors are gone. Call `setColors` again (or accept white). Distances are re-seeded to zero on dist grow (`hasDistances = true` after seed so solid `setPositions` does not re-upload every frame). Positions are fully rewritten by the triggering `setPositions` write.

`clearGeometry` resets flags only — **does not** free or shrink GPU instance buffers.

### GPU memory estimate @ 8 000 segments (P03)

Needed N = 8000 → `ensureSize(8000, 0)` = **8192** capacity.

| Resource | Tight (N=8000) | Allocated (cap=8192) |
|----------|---------------:|---------------------:|
| Instance pos | 8000 × 24 = **192 000 B** (187.5 KiB) | 8192 × 24 = **196 608 B** (192 KiB) |
| Instance color | 8000 × 24 = **192 000 B** | 8192 × 24 = **196 608 B** (192 KiB) |
| Instance dist | 8000 × 8 = **64 000 B** (62.5 KiB) | 8192 × 8 = **65 536 B** (64 KiB) |
| **Instance subtotal** | **448 000 B** (~437.5 KiB) | **458 752 B** (~448 KiB) |
| Template VB+IB | 196 B | 196 B |
| Uniform buffer | 192 B | 192 B |
| **Renderer GPU total** | ~448.4 KiB | **~448.5 KiB** (≈ **0.44 MiB**) |

Power-of-two pad over tight: **10 752 B** (~10.5 KiB, ~2.4% overhead at this size).

| Other N | Capacity | Instance VRAM (56 B × cap) |
|--------:|---------:|---------------------------:|
| 100 (P01) | 128 | 7 168 B (~7.0 KiB) |
| 1 000 (P02) | 1 024 | 57 344 B (~56 KiB) |
| 2 000 (P04) | 2 048 | 114 688 B (~112 KiB) |
| 1 500 (P05) | 2 048 | 114 688 B (~112 KiB) |
| 8 000 (P03) | 8 192 | **458 752 B (~448 KiB)** |

Host-side upload on full pos rewrite: **N × 24 B** (8k → **192 KB** once; P05 churn 1.5k → **36 KB**/frame). Uniform dirty path: **192 B**/frame when camera/material changes.

### Takeaway

One Line2 renderer at P03 stress is **sub-megabyte** GPU memory — not a VRAM bottleneck. Cost is **raster** (48k tris + soft AA) and **host rewrite bandwidth**, not buffer footprint. Capacity is grow-only; peak N owns the buffer for the renderer lifetime until `dispose()`.

---

## API traps

**Cycle 3 — Agent Q3.** Sources: `line2-renderer.ts` (`assertLive`, `setResolution`, `writeCamera`, `setColors`, `encode`, `dispose`), `line2-wgsl.ts` / `line2-expand-ref.ts` (screen-space expand), pure Node tests in `tests/expand-ref.test.mjs` + `tests/geometry-material.test.mjs`.

Camera and lifecycle footguns that **do not always crash** — they produce silent wrong thickness, skip near-plane trim, or throw only after dispose. Integrators (Galaxy overlays, visual suite) must treat these as hard rules.

### Trap table

| Misuse | What happens | Fail mode | Coverage |
|--------|--------------|-----------|----------|
| **Fused `viewProj` as `modelView` + real `projection`** (double project) | `start = viewProj·p` already clip-like, then `clip = P·start` → **P·P·V·p** | Wrong pose + thickness; often still finite (silent) | **Node** expand-ref: mag/mid diverge from correct |
| **Fused `viewProj` as `modelView` + identity `projection`** | Endpoint clip can look plausible in front of camera; **`perspective` flag false** (`I[2][3]=0`) → **no camera-plane trim**; view-space `z` is wrong for `worldUnits` | Cross-camera segments not trimmed; worldUnits ribbon wrong | **Node** expand-ref: trimmed `w` diverges |
| **Swapped mats** (`modelView=proj`, `projection=view`) | NDC dir / trim / clip all in wrong spaces | Wrong pose + thickness | **Node** expand-ref |
| **`writeViewProjection(viewProj, identity)`** | Same family as fused-as-MV+I (identity model is fine only when the first mat is **view**, not fused) | Same as fused+I | Doc + expand-ref family |
| **`setResolution(0, *)` / `(*, 0)` / negative** | Renderer: `Math.max(w\|h, 1)` → **clamps to ≥1**, no throw | Safe on GPU path; thickness uses 1 px denom (odd if real buffer is 0) | **Node** geometry-material clamp contract; expand-ref shows **unclamped** `resY=0` → non-finite |
| **Raw expand-ref / WGSL with `resolution.y = 0`** | `offset /= resolution.y` → **Inf/NaN** clip | Fullscreen trash / discard | **Node** expand-ref (`resY=0`, vertical `resX=0`) |
| **`setColors` before `setPositions`** (or after `clearGeometry`) | `segmentCount === 0` → **throw** `Line2Renderer.setColors: call setPositions first` | Hard error (good) | Source + pure predicate in geometry-material; **not** visual tiles |
| **`setColors` after grow without re-upload** | Grow white-seeds color buffer; `hasColors=false`; `vertexColors` may stay true | **Silent white** lines until `setColors` again | D05 visual (always re-`setColors`); README grow caveat |
| **`encode` after `dispose`** | `assertLive()` → **throw** `Line2Renderer: disposed` | Hard error (not a silent no-op) | Source + pure `assertLive` mirror in geometry-material; visual suite never encodes after dispose |
| **`dispose` twice** | Second call returns early | **No throw** (idempotent) | Source + pure contract test |
| **Any other API after dispose** (`setPositions`, `writeCamera`, `setMaterial`, `setResolution`, `clearGeometry`, …) | Same `assertLive` throw | Hard error | Source inspection |
| **`encode` with `segmentCount === 0`** | Early `return` — **no draw**, no throw | Silent no-op | Source; harness only draws after geom ready |
| **Mutate aliased `Float32Array` after `setPositions`** | `packSegmentPositions` returns same ref; queue may read corrupted data | Geometry corruption | README critical rule #5 |

### Fused `viewProj` — why separate mats are required

WGSL (and expand-ref) always do:

```
start = modelView * instanceStart     // must be VIEW / model-view space
clip  = projection * start            // then projection only
```

Screen-space thickness uses NDC from those clips (`dir = ndcEnd − ndcStart`, `offset /= resolution.y`, `offset *= clip.w`). Perspective near trim and `worldUnits` expansion both assume **true view-space** positions in `start`/`end_` and a real projection (classic perspective has `projection[2][3] ≈ −1`).

| Pass | Result |
|------|--------|
| `writeCamera({ modelView: view, projection: proj })` | **Correct** |
| `writeViewProjection(view, proj)` | **Correct** (identity model) |
| `writeCamera({ modelView: viewProj, projection: identity })` | **Wrong** for trim / worldUnits; screen-space may look OK only when no trim needed |
| `writeCamera({ modelView: viewProj, projection: proj })` | **Wrong** — double projection |
| Invent `writeViewProj(fused)` | **Not supported** — do not add |

Galaxy fleet trails use a **fused** `viewProj` uniform; Line2 does **not**. When wiring overlays, keep the map’s separate view + projection (or factor view out of any fused product).

### Resolution 0

```ts
// line2-renderer.ts setResolution
this.material.resolutionX = Math.max(width, 1);
this.material.resolutionY = Math.max(height, 1);
```

| Path | `resolution = (0,0)` |
|------|----------------------|
| `Line2Renderer.setResolution` | Becomes **(1,1)**; uniforms dirty; no throw |
| Default material before any set | Already **1×1** |
| WGSL / expand-ref if fed 0 | **`/ resolution.y` → Inf**; aspect `x/y` NaN/Inf |

Always pass **canvas/drawingBuffer** size in the same pixel space as the render pass (device px after DPR clamp in the visual suite). Never pass CSS size without matching the buffer.

### `setColors` before `setPositions`

```ts
// line2-renderer.ts
if (this.segmentCount === 0) {
  throw new Error("Line2Renderer.setColors: call setPositions first");
}
```

Order that works:

```
setPositions(...)           // sets segmentCount
setColors(...)              // optional; enables vertexColors
// after any grow from a larger setPositions:
setColors(...)              // required again or colors go white
```

`clearGeometry()` resets `segmentCount` to 0 → next `setColors` throws until another `setPositions`.

### `assertLive` / dispose / encode

```ts
private assertLive(): void {
  if (this.disposed) throw new Error("Line2Renderer: disposed");
}
```

| Call | After `dispose()` |
|------|-------------------|
| `dispose()` again | No-op (idempotent) |
| `encode(pass)` | **Throws** `Line2Renderer: disposed` |
| `setPositions` / `setColors` / `writeCamera` / `setResolution` / `setMaterial` / `clearGeometry` / `setDistances` | **Throws** same message |
| `getSegmentCount()` / `getMaterial()` | **No** `assertLive` — still readable but buffers are destroyed (do not use) |

Contrast: live renderer + empty geometry → `encode` **returns without throwing**. Disposed renderer → `encode` **throws**. Do not rely on encode as a soft guard after teardown.

### Visual suite coverage (what is / isn’t exercised)

| Trap | Visual suite | Node pure tests |
|------|--------------|-----------------|
| Separate view + proj every tile | **Yes** (`main.mjs` `writeCamera`) | expand-ref correct baseline |
| Fused / swapped / double-proj | **No** (would look like a broken tile) | **Yes** expand-ref API traps |
| `setResolution(0)` | **No** (always tile `r.w×r.h` ≥ 1) | **Yes** clamp contract + unclamped Inf |
| `setColors` before positions | **No** (`applyGeometry` always positions first) | Predicate + message contract |
| Grow + `setColors` | **D05** | geometry pack / ensureSize |
| `encode` after dispose | **No** (`disposeUnused` drops tiles out of the active set; no encode) | assertLive pure mirror |
| Happy multi-viewport thickness | **H\*** + Cycle 1 V1 | expand-ref aspect / lw |

Run pure traps:

```bash
./build.sh   # if dist/ stale
node js/vendor/line2/tests/run-line2-tests.mjs
```

### Integrator checklist (Galaxy overlays)

1. **Camera:** `writeCamera({ modelView: view, projection: proj })` or `writeViewProjection(view, proj)` — **never** pass fused `viewProj` in either slot; never double-apply projection.  
2. **Resolution:** `setResolution(canvas.width, canvas.height)` (drawingBuffer / device px matching the pass). Do not pass 0; library clamps but 1×1 is not a substitute for a real size.  
3. **Geometry order:** `setPositions` → optional `setColors` / distances. After any larger `setPositions` that grows capacity, **re-`setColors`**.  
4. **Empty draw:** `clearGeometry` or zero segments → `encode` is a quiet no-op; `setColors` on empty **throws**.  
5. **Lifecycle:** `dispose()` when the overlay owner dies; never `encode` / upload afterward (throws). Double-`dispose` is safe.  
6. **depthFormat:** `null` for Galaxy color-only map pass; `"depth24plus"` only when the pass has depth (see I01/I02).  
7. **Budget:** tens–low hundreds of segments, event-driven rebuilds — not fleet trails (see budgets + Line2 vs line-list sections).  
8. **Pack alias:** do not mutate a `Float32Array` still owned by an in-flight `setPositions` upload.  
9. **worldUnits:** only when thickness must scale with zoom; constant-px overlays keep `worldUnits: false` (R04 vs R05).  
10. **Verify:** `node js/vendor/line2/tests/run-line2-tests.mjs` after library edits; open visual suite for thickness/camera residuals.

---

## Cycle 3 — Agent Q4 (Depth / MSAA pipeline variants)

**Scope:** `line2-pipeline.ts`, `types.ts` `depthFormat` default, visual suite pass shape vs Galaxy color-only integration risk.

### Library facts

| API | Default | Behavior |
|-----|---------|----------|
| `Line2RendererOptions.depthFormat` / `Line2PipelineOptions.depthFormat` | **`null`** (`undefined` → null) | **No `depthStencil`** on `GPURenderPipeline` |
| `depthFormat: "depth24plus"` (etc.) | opt-in | `depthStencil.format` set; `depthWrite` default **false**; `depthCompare` default **less** (or **always** if material `depthTest: false`) |
| `sampleCount` | **1** | No MSAA |
| `alphaToCoverage` | **false** | Only enabled when `alphaToCoverage && sampleCount > 1` |

`createLine2Pipeline` (`line2-pipeline.ts` L101–112): when `depthFormat == null`, `depthStencil` is **`undefined`** — material `depthWrite` / `depthCompare` options are **ignored**.

### Galaxy host pass (production)

`js/gpu/webgpu-map-view.ts` `beginRenderPass` is **color-only** (no `depthStencilAttachment`). AGENTS.md / vendor README require Line2 wire-up with **`depthFormat: null`** (library default).

| Host pass | Line2 `depthFormat` | Outcome |
|-----------|---------------------|---------|
| Color-only (Galaxy today) | **`null` (default)** | ✓ correct |
| Color-only | `"depth24plus"` | ✗ **validation error** — pipeline requires depth attachment |
| Depth-bearing | `"depth24plus"` | ✓ |
| Depth-bearing | `null` | ✓ depth unused by Line2 |

### Visual suite (before this agent)

| Fact | Detail |
|------|--------|
| Pass | Always `depth24plus` attachment (one multi-tile pass for I02) |
| All renderers | Were `depthFormat: "depth24plus"` |
| **I01** | Emulated color-only via **`depthTest: false` + `depthWrite: false`** (compare `always`) — **not** true `depthFormat: null` |
| MSAA / A2C | Untested (`sampleCount: 1`) |

### Integration risk assessment (if visual never tests `depthFormat: null`)

| Risk | Severity | Why |
|------|----------|-----|
| Integrator copies suite constructor (`depthFormat: "depth24plus"`) into Galaxy color-only pass | **MEDIUM** | Immediate WebGPU validation failure on first encode — loud, not silent wrong pixels |
| Visual quality / thickness / softAA differ on null vs depth-disabled | **LOW** | Same WGSL; only pipeline descriptor differs. I01-with-always-compare was a reasonable *appearance* stand-in |
| Silent wrong occlusion if depthFormat null but product later adds depth | **LOW** | Lines never depth-test; product must opt into `depthFormat` + pass depth together |
| MSAA / pipeline alphaToCoverage | **LOW** (Galaxy) | Map is sampleCount 1; softAA is fragment `fwidth`, independent of A2C |
| `maybeRebuildPipeline` on depthTest flip when `depthFormat: null` | **INFO** | Rebuilds a still-no-depthStencil pipeline (wasteful no-op shape change) |

**Pre-fix overall risk:** **MEDIUM** for wire-up footgun (wrong depthFormat on color-only pass); **LOW** for visual parity of the actual ribbon.

### Change applied (minimal — no large refactor)

I01 now exercises the **true Galaxy pipeline shape**:

| File | Change |
|------|--------|
| `visual/cases.mjs` | I01: `depthFormatNull: true`; title/hint = Galaxy color-only / `depthFormat:null` |
| `visual/main.mjs` | `ensureRenderer`: `depthFormat: c.depthFormatNull ? null : "depth24plus"`; drop I01 depthTest/depthWrite force |
| `visual/README.md` | Depth / pipeline variant matrix + wire-up checklist; note second canvas optional |

WebGPU allows encoding a **no-`depthStencil`** pipeline into a pass that still has a depth attachment (I02 needs the attachment for other tiles). So I01 tests production **pipeline** shape without a second canvas.

Optional future (not done): second canvas with **no** depth attachment for full **pass**-shape parity — low value once pipeline null is covered.

### Residual gaps after fix

| Item | Status |
|------|--------|
| Galaxy `depthFormat: null` pipeline | **Covered by I01** |
| Depth occluder path | Covered by I02 |
| Color-only **pass** (no depth attachment at all) | Still not a separate canvas — **LOW** residual |
| MSAA `sampleCount > 1` + `alphaToCoverage` | Untested — **LOW** for Galaxy (not used) |

### Risk level (return)

| Phase | Level |
|-------|-------|
| Before I01 null fix | **MEDIUM** (suite→prod copy of `depth24plus` breaks Galaxy color-only) |
| After I01 null fix | **LOW** |

**HIGH bugs:** none. No library API change required — defaults already match Galaxy.

---

## Cycle 3 — Agent Q2 (Material uniforms / softAA / dashed / vertexColors)

**Scope:** `line2-material.ts` pack layout, `line2-wgsl.ts` fragment shader, visual cases **H06a/b · H07 · H08 · H09**.

### Uniform pack ↔ WGSL struct (lockstep)

| Float index | Field | WGSL | Notes |
|------------:|-------|------|-------|
| 32–35 | `color.rgba` | `color : vec4` | Base RGB + **opacity** |
| 36–37 | `resolution.xy` | `resolution : vec2` | Device px for screen expand |
| 38 | `linewidth` | `linewidth` | |
| 39–42 | `dashScale/Size/gap/Offset` | same | All written by `writeMaterialUniforms` |
| 43–46 | `worldUnits`, `dashed`, `softAA`, `vertexColors` | 0\|1 flags | |
| 47 | pad | `_pad0` | |

`LINE2_UNIFORM_SIZE = 192` (48 f32). Unit-tested in `tests/geometry-material.test.mjs`. **No layout drift.**

### Check 1 — softAA multiplies alpha (does not overwrite)

FS base: `var alpha = u.color.a`.

| Path | Code | Semantics |
|------|------|-----------|
| Screen soft endcaps | `alpha = alpha * (1.0 - smoothstep(1.0 - dlen, 1.0 + dlen, len2))` only when `abs(vUv.y) > 1.0` | **Multiply** |
| World soft body edge | `alpha = alpha * (1.0 - smoothstep(0.5 - dnorm, 0.5 + dnorm, norm))` | **Multiply** |
| Hard (`softAA: false`) | `discard` when outside circle / half-width | No alpha write |

Classic Three GLSL LineMaterial **overwrote** `alpha = 1.0 - smoothstep(...)` (ignores material opacity on rims). This port matches **Line2NodeMaterial** multiply semantics (README §4).

**H06a / H06b:** same geom/lw/color; soft on → smooth endcap rims; soft off → hard circular discard. Body long edges stay hard either way (soft branch gated on endcap UVs only) — Three parity.

**H09 (α=0.45 + softAA):** body keeps 0.45; endcap center of disk stays 0.45 (multiply × 1); rim fades toward 0. Overwrite would flash **opaque white-red rims** — would be HIGH; **not present**.

### Check 2 — dashed uses distance attributes

| Stage | Behavior |
|-------|----------|
| VS | `lineDistanceStart/End = dashScale * instanceDistanceStart/End`; near-plane trim also mixes distances; `vLineDistance` selected by `position.y < 0.5` (start vs end), raster-interpolated along body |
| FS | Endcaps discarded (`vUv.y` outside [−1,1]); period = `dashSize + gapSize`; `(vLineDistance + dashOffset) % period` with negative-fold; discard if past `dashSize` |
| Host | `computeLineDistances` → cumulative dStart/dEnd per seg; H07 `computeDistances: true` + `dashed: true` via `applyGeometry` → `setPositions(..., { computeDistances })` |

**H07:** zigZag polyline, `dashSize=0.8`, `gapSize=0.4`, `dashScale=1` → continuous pattern along chain (not per-segment restart). Distances are real attrs, not UV length fakes.

### Check 3 — vertexColors multiplies material RGB

```wgsl
if (u.vertexColors > 0.5) {
  rgb = rgb * input.vColor;  // RGB only; alpha stays material.color.a
}
```

VS: `vColor = select(instanceColorEnd, instanceColorStart, position.y < 0.5)` → raster lerp along body (endpoint RGB lerp).

**H08:** material color white `[1,1,1,1]` + `gradientColorsForSegments(3)` + `vertexColors: true` → pure vertex gradient (white × rgb = rgb). Tint would also multiply correctly.

`setColors` sets `material.vertexColors = true` (unless `enable: false`); uniforms flag written every dirty upload.

### Case map (expected)

| ID | Expect | Status |
|----|--------|--------|
| **H06a** | Soft endcap rims (α attenuates) | ✓ code path |
| **H06b** | Harder rims / aliasing (discard) | ✓ code path |
| **H07** | Dash/gap along cumulative distance | ✓ attrs + FS |
| **H08** | Endpoint RGB lerp (× material white) | ✓ multiply |
| **H09** | α=0.45 stack at crosses; soft does not restore α=1 on caps | ✓ multiply |

### HIGH bugs

**None.** No code change in `js/vendor/line2/`.

### Residual (not HIGH)

| Sev | Item |
|-----|------|
| LOW | Canvas `alphaMode: "premultiplied"` + straight `LINE2_BLEND` may slightly tint translucent H09 (already Cycle 1 V1) |
| INFO | Dashed skips soft endcaps (discard first) — Three parity; lateral body edges never soft-AA in screen path |
| INFO | worldUnits + dashed skips thickness `norm` discard/soft (Three-style gap; H07 is screen-space) |

---

## Cycle 3 — Agent Q5 (Unit test gaps from visual suite)

**Scope:** Deterministic pure-CPU tests still missing for visual-suite contracts (D05 grow, P05 solid dist skip, pack alias, color length throws, `clearGeometry` flags). No GPU.

### Gaps identified

| Gap | Why visual suite alone is insufficient | Fix |
|-----|----------------------------------------|-----|
| **`clearGeometry` flags** | Suite never calls `clearGeometry`; encode no-op + setColors throw after clear were source-only | `clearGeometryFlags` pure helper + attr-state tests |
| **Color length throw** | Suite always builds matching colors; bad lengths never hit | Extended `packSegmentColors` / `createLine2Geometry` throws + `assertPackedColorLength` |
| **Pack alias** | P05 documents F32 alias; only pos alias was asserted | Pos alias mutate-in-place + number[] copy independence + **color** F32 alias |
| **Solid dist skip (P05)** | `hasDistances` skip is GPU-queue residual | `distanceUploadMode` pure (`seed` / `skip` / `compute`) |
| **Grow capacity ladder** | Partially covered; D05/P04/P05 ladder numbers | `growInstanceCapacity` / `ensureSize` (attr-state + geometry-material) |
| **setColors order after clear** | Not in tiles | `assertHasPositionsForColors(0)` after clear flags |

### Code added / wired

| File | Role |
|------|------|
| `line2-attr-state.ts` | Pure helpers: grow, clear flags, invalidate colors, distance mode, color/dist length guards |
| `line2-renderer.ts` | Uses pure helpers for setPositions dist path, setColors/setDistances guards, clearGeometry |
| `tests/attr-state.test.mjs` | **New** suite for flag/capacity/throw contracts |
| `tests/geometry-material.test.mjs` | Stronger pack alias + color length throws |
| `tests/run-line2-tests.mjs` | Runs expand-ref + geometry-material + **attr-state** |

### Test count (new total)

```bash
./build.sh   # if dist/ stale
node js/vendor/line2/tests/run-line2-tests.mjs
```

| Suite | Checks |
|-------|-------:|
| expand-ref | 66 |
| geometry-material | 90 |
| attr-state | 33 |
| **Total** | **189** |

**New test count: 189**

GPU residual still not unit-tested (needs queue): `seedDistancesOnly` full buffer write after grow; white color seed bytes; encode no-op when `segmentCount === 0` with live device.

---

## Cycle 4 — Agent F2 (Lock test suite)

**Scope:** Freeze pure-CPU Line2 unit suite entrypoints and documented check count. No new cases; confirm wiring only.

### Locked runner

| Entry | Role |
|-------|------|
| `tests/run-line2-tests.mjs` | Aggregates **expand-ref** + **geometry-material** + **attr-state** |
| `scripts/run-line2-tests.sh` | `./build.sh` then `node …/run-line2-tests.mjs` |

```bash
scripts/run-line2-tests.sh
# or after build:
node js/vendor/line2/tests/run-line2-tests.mjs
```

### Locked check count (green)

| Suite | Checks |
|-------|-------:|
| expand-ref | 66 |
| geometry-material | 90 |
| attr-state | 33 |
| **Total** | **189** |

**Final pure-CPU test count: 189** (all green).

Expect runner summary:

```text
line2 tests: all passed (189 checks: 66 expand-ref + 90 geometry-material + 33 attr-state)
```

Also documented under [`README.md`](./README.md) § Pure tests. GPU residual from Q5 unchanged (needs device/queue).

---

## Cycle 2 — Agent P1 (CPU pack microbench)

**Scope:** `line-geometry.ts` pack path only (`packSegmentPositions`, `polylineToSegments`, `computeLineDistances`).  
**Harness:** [`tests/pack-microbench.mjs`](./tests/pack-microbench.mjs)  
**Run (after `./build.sh` if dist stale):**

```bash
node js/vendor/line2/tests/pack-microbench.mjs
# writes js/vendor/line2/tests/pack-microbench-results.json
```

Warmup 50; iters 400 (N≥20k: 80). Brief sizes **100 / 1k / 8k / 50k** (+ suite midpoints 1500 / 2000 for P05/P04).

### Exact host payload (not timed)

| N segs | pos floats | pos B | dist floats | dist B | pos writeBuffer if every frame |
|-------:|-----------:|------:|------------:|-------:|-------------------------------:|
| **100** | 600 | **2.4 KB** | 200 | 0.8 KB | 2.4 KB |
| **1 000** | 6 000 | **24 KB** | 2 000 | 8 KB | 24 KB |
| **8 000** | 48 000 | **192 KB** | 16 000 | 64 KB | 192 KB |
| **50 000** | 300 000 | **1.2 MB** | 100 000 | 400 KB | 1.2 MB |

### Algorithm cost model

| Path | Work | Notes |
|------|------|-------|
| `packSegmentPositions(Float32Array)` | **O(1)** alias | length % 6 check only; **no copy** (Galaxy / P05 path) |
| `packSegmentPositions(number[])` | **O(N)** copy | `new Float32Array` + `set` — avoid on hot paths |
| `polylineToSegments` | **O(N)** expand | alloc `N×6` f32 + 6 stores/seg (ring polylines) |
| `computeLineDistances` | **O(N)** | `Math.hypot` × N + 2 stores/seg (dash only) |

### Wall-clock table (fill by running harness)

Machine expected: Node on host laptop. Paste stdout tables here after one run:

| Path | N=100 ms | N=1k ms | N=8k ms | N=50k ms | N=100 ns/seg | N=1k ns/seg | N=8k ns/seg | N=50k ns/seg |
|------|---------:|--------:|--------:|---------:|-------------:|------------:|------------:|-------------:|
| pack alias (Float32Array) | *(run)* | | | | | | | |
| pack copy (number[]) | | | | | | | | |
| polylineToSegments | | | | | | | | |
| computeLineDistances | | | | | | | | |

**Expected shape (order-of-magnitude, pre-run):** alias ≪ 1 µs all N (timer noise); polyline + distances linear; copy slower than typed expand. Overlay N (≤256) → pack **well under 0.1 ms** even for polyline+distances; 50k is stress/wrong-tool.

### Hot-path risk for Galaxy overlays?

| Question | Answer |
|----------|--------|
| **Is CPU pack a hot-path risk for sparse UI overlays?** | **NO** |
| Why | Comfort overlay budget ≤ **~256** segs (select+hover+edit ≈ 100); event-driven rebuild, not every rAF |
| Alias path | Default `Float32Array` input → **zero copy** |
| Polyline rings | `packRingLineLoop` **48** segs → expand ~hundreds of float stores — noise vs 8 ms frame |
| When pack **is** a risk | Per-frame full rewrite ≥**1k** segs (P05) or ≥**8k** (P03); never use Line2 pack for fleet trails |

**Verdict:** Line2 CPU pack is **safe for Galaxy overlays** (tens–low hundreds segs, rebuild on UI events). Do **not** use for high-N / every-frame trails — that stays GPU `line-list`.

---

## Final gate

**Date:** 2026-07-19  
**Agent:** Cycle 4 Agent F5  
**Status:** **PASS**

| Step | Result |
|------|--------|
| `./build.sh` | PASS (exit 0) |
| `node js/vendor/line2/tests/run-line2-tests.mjs` | PASS — 189 checks (66 expand-ref + 90 geometry-material + 33 attr-state) |
| `node js/vendor/line2/tests/pack-microbench.mjs` | PASS — completed; results written to `tests/pack-microbench-results.json` |
| `dist/vendor/line2/visual/index.html` exists | PASS |
| Spot-check `main.mjs` imports under `dist` | PASS — `/dist/vendor/line2/index.js` + `./cameras.mjs` `./cases.mjs` `./layout.mjs` all resolve; `index.js` exports `Line2Renderer` and related public API |

**Notes:** No library fixes required. Dist mirrors source visual suite and compiled `js/vendor/line2/*` modules. Gate closed green.
