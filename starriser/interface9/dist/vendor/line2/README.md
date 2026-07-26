# `js/vendor/line2` — fat Line2 for raw WebGPU

Screen-space (and world-unit) **thick lines** without Three.js.

Algorithm ported from **three.js** `Line2` / `LineSegments2` / `LineMaterial` / `Line2NodeMaterial` (MIT). See [`LICENSE`](./LICENSE) and the notice below.

**Visual evaluation page** (happy path, residual, degen, perf tiles): [`visual/README.md`](./visual/README.md)

```bash
./scripts/run-line2-visual.sh   # build + serve + WebGPU Chromium (gpu-chromium.desktop flags)
```

Manual: after `./build.sh` + static server → `/js/vendor/line2/visual/index.html`

**Review handoff (executive summary + budgets):** [`VISUAL-REVIEW.md`](./VISUAL-REVIEW.md) — open steps, R01–R05 tradeoffs, **overlays ≤ ~256 segs / trails no**, 189 tests, 20 agent cycles complete.  
Concrete budgets: [§ Recommended budgets for Galaxy](./VISUAL-REVIEW.md#recommended-budgets-for-galaxy) · also [§3 below](#3-overlays-yes-high-n-fleet-trails-no).

**Galaxy map:** wired for M4 overlays + topology connections. Map pass is **MSAA ×4** + **`alphaToCoverage`**. Fleet engine trails use a **GPU-expand Line2-style ribbon** (`fleet-trails.wgsl`) — not host `Line2Renderer` (would be too slow at scale).

---

## Quick start

```ts
import { Line2Renderer } from "./vendor/line2/index.js";

// depthFormat defaults to null (no depthStencil) for Galaxy color-only passes.
// Pass depthFormat: "depth24plus" when the render pass has a depth attachment.
const lines = new Line2Renderer(device, {
  format: presentationFormat, // e.g. navigator.gpu.getPreferredCanvasFormat()
  // sampleCount: 4,
  // alphaToCoverage: true,   // with MSAA
  // depthFormat: "depth24plus",
});

lines.setResolution(canvas.width, canvas.height);
lines.setMaterial({
  color: [1, 0.2, 0.1, 1],
  linewidth: 3,        // CSS / buffer pixels when worldUnits=false
  worldUnits: false,
  endcaps: true,       // round endcap skirts (false = body-only; Galaxy topology uses false)
  softAA: true,        // endcap fwidth soft when endcaps on; long edges: MSAA + alphaToCoverage
  dashed: false,
});

// Polyline (chain of points) → segment pairs automatically:
lines.setPositions(
  new Float32Array([
    0, 0, 0,
    10, 0, 0,
    10, 0, 10,
  ]),
  { polyline: true },
);

// Or raw segment pairs: [x0,y0,z0, x1,y1,z1, x2,y2,z2, x3,y3,z3, ...]
// lines.setPositions(segmentPairs);

// Each frame — separate view + projection (NEVER a fused viewProj mat4):
lines.writeCamera({ modelView: viewMat, projection: projMat });
// or (identity model): lines.writeViewProjection(viewMat, projMat);

// Inside your color render pass (after setPipeline of other layers is fine):
lines.encode(renderPassEncoder);

// When done:
lines.dispose();
```

### Dashed lines

```ts
lines.setMaterial({ dashed: true, dashSize: 2, gapSize: 1, dashScale: 1 });
lines.setPositions(polyline, { polyline: true, computeDistances: true });
```

Distances are cumulative along the segment list (Three `computeLineDistances` semantics).

### Vertex colors

```ts
lines.setPositions(segments);
lines.setColors(rgbPairs); // enables vertexColors; multiplies material.color
// rgbPairs: [r0,g0,b0, r1,g1,b1, ...] matching segment endpoints
```

**Grow caveat:** if a later `setPositions` grows the instance buffers, the color buffer is recreated and filled white (`hasColors` cleared). Call `setColors` again after any grow, or colors will silently reset to white.

---

## Critical integration rules (Galaxy)

### 1. `depthFormat` default is `null` (color-only)

Galaxy’s WebGPU map pass is **color-only** (no depth attachment). Library default is **`null`** — no `depthStencil` on the pipeline. That matches overlays out of the box:

```ts
new Line2Renderer(device, { format }); // depthFormat defaults to null
// When the pass has depth:
// new Line2Renderer(device, { format, depthFormat: "depth24plus" });
```

### 2. Camera: separate view + projection — never fused `viewProj`

Expansion math needs **model-view** and **projection** as two matrices (`writeCamera` / `writeViewProjection`). A single fused view-projection matrix is **not** supported and will produce wrong thickness / NDC offsets.

```ts
// correct
lines.writeCamera({ modelView: view, projection: proj });
// wrong — do not invent a writeViewProj(fused) API
```

Matrices are column-major, same layout as `js/gpu/math/mat4.ts`.

### 3. Overlays yes; high-N fleet trails no

| Use | Recommended |
|-----|-------------|
| Selection/hover rings, edit-handle outlines, sparse UI strokes | **Line2** (this library) — wired |
| Topology connections (jump gates + solar links) | **Line2** — wired via `ConnectionLineGpuLayer` |
| High-N fleet engine trails | **GPU expand + Line2-style ribbon** in `fleet-trails.wgsl` (variable width; not host `Line2Renderer`) |

Line2 is instanced triangle expansion (18 indices × segments). That is right for a handful of overlay polylines, not thousands of trail segments per frame.

**Galaxy overlay budgets (concrete):** rings/handles at **~32–64 segments each** (prefer **48**, same as `packRingLineLoop`); keep **few polylines** and a **total ≤ ~256 segs** across selection + hover + edit gizmo in the common case (soft ceiling ~500–1k static). Rebuild on UI events only — not every frame. **Never** use Line2 for fleet trails (including ~10k fleets): stay on GPU `line-list`. Full table and worked costs: [`VISUAL-REVIEW.md` → Recommended budgets for Galaxy](./VISUAL-REVIEW.md#recommended-budgets-for-galaxy).

### 4. `softAA` multiplies opacity (NodeMaterial parity)

Fragment soft endcap AA does **`alpha *= (1 - smoothstep(...))`**, matching Three **`Line2NodeMaterial`**, not classic GLSL LineMaterial overwrite of alpha. Material `color.a` remains the base opacity; soft AA only attenuates it toward the rim.

### 5. `packSegmentPositions` aliases `Float32Array` inputs

```ts
packSegmentPositions(float32Array); // returns the same Float32Array reference
```

Non-`Float32Array` inputs are copied. If you mutate a shared `Float32Array` after pack / after `setPositions` has queued the upload, you can corrupt geometry. Own the buffer or treat it as write-once until the queue has consumed it.

### 6. Degenerate (zero-length) segments

Guarded in WGSL:

- **Screen-space:** NDC direction uses a stable horizontal offset when `dirLen ≤ 1e-8`.
- **`worldUnits`:** zero-length `worldDir`, near-origin midpoint, vanishing cross products, parallel `closestLineToLine` denom, and tiny `linewidth` are all guarded (no NaN ribbon).

Zero-length segments still draw a stable stub rather than disappearing.

---

## Feature parity vs three.js Line2

| Feature | Three LineMaterial / Line2 | This library |
|---------|----------------------------|--------------|
| Screen-space thickness (`linewidth` px + `resolution`) | ✓ | ✓ |
| Vertex expansion → ribbon (not `line-list`) | ✓ instanced mesh | ✓ instanced triangle-list |
| Round endcaps | ✓ | ✓ |
| Soft endcap AA (`fwidth` / alphaToCoverage path) | ✓ | ✓ (`softAA`, default on; **multiplies** opacity) |
| Hard discard endcaps | ✓ when A2C off | ✓ `softAA: false` |
| `worldUnits` thickness | ✓ | ✓ (degenerate segments guarded) |
| Dashed (`dashScale/Size/gap/Offset`) | ✓ | ✓ |
| Vertex colors (per endpoint) | ✓ | ✓ |
| Transparent blending | configurable | src-alpha / one-minus-src-alpha (Galaxy style) |
| Depth test / write | material flags | ✓ (rebuilds pipeline on change) |
| Perspective near-plane segment trim | ✓ | ✓ |
| Fog / clipping planes / log depth | ✓ | ✗ (not needed for Galaxy map) |
| Raycasting helpers | ✓ on LineSegments2 | ✗ (CPU-only; add later if needed) |
| TSL / Three materials | Line2NodeMaterial | pure WGSL string |

**Which algorithm?** Classic **`LineMaterial` GLSL** (WebGL Line2), which matches the expansion math in **`Line2NodeMaterial`** (WebGPU). Resolution uses the classic `resolution.y` denominator (caller passes canvas/drawingBuffer size), not Three’s internal `viewport/DPR` node. Soft AA alpha uses **NodeMaterial multiply** semantics (see above).

**Known differences**

1. **Soft AA** — softens **endcaps** only (three.js parity). Long edges: enable `sampleCount: 4` + `alphaToCoverage` (do not expand ribbons — gradient artifacts).
2. **No fog / clipping / tone mapping** — fragment outputs premultiplied-ready straight RGBA; compose with your pass.
3. **Pipeline alpha-to-coverage** is optional (`alphaToCoverage` + `sampleCount > 1`); independent of material `softAA`. With **translucent** material alpha and heavy overlap, A2C uses a **fixed sample mask** (screen-door / checker pattern). Prefer **opaque** lines when stacking thousands of segments, or drop A2C and accept harder long edges.
4. **Degenerate segments** (zero length) get a stable horizontal / world axis offset instead of NaNs (screen + `worldUnits`).
5. **`depthFormat` default is `null`** (no depthStencil) — pass `"depth24plus"` only when the render pass has a depth attachment.

---

## Geometry / GPU layout

### Template mesh (buffer 0, per-vertex)

8 vertices, 18 indices (6 triangles) — same as Three `LineSegmentsGeometry`:

| attr | role |
|------|------|
| `position.x` | side ±1 |
| `position.y` | along-line ∈ {−1,0,1,2} (endcap skirts at &lt;0 and &gt;1) |
| `uv` | fragment endcap distance (`vUv`) |

### Instance buffers

| slot | stride | content |
|------|--------|---------|
| 1 | 24 B | `instanceStart.xyz`, `instanceEnd.xyz` |
| 2 | 24 B | `instanceColorStart.rgb`, `instanceColorEnd.rgb` (default white) |
| 3 | 8 B | `instanceDistanceStart`, `instanceDistanceEnd` (for dashes) |

Draw: `drawIndexed(18, segmentCount)`.

### Uniforms (192 bytes)

`modelView`, `projection`, `color.rgba`, `resolution`, `linewidth`, dash fields, feature flags (`worldUnits`, `dashed`, `softAA`, `vertexColors`).

Matrices are **column-major** `mat4x4<f32>` — compatible with `js/gpu/math/mat4.ts`.

---

## Module map

| File | Role |
|------|------|
| `index.ts` | Public exports |
| `types.ts` | Material / geometry / camera types |
| `line-geometry.ts` | Segment packing, polyline expand, distances, template |
| `line2-material.ts` | Defaults + uniform packing |
| `line2-wgsl.ts` | Full VS/FS WGSL |
| `line2-pipeline.ts` | Pipeline + blend + vertex layouts |
| `line2-renderer.ts` | Buffers, uploads, `encode`, `dispose` |
| `tests/` | Library unit / packing tests (not part of runtime map path) |

Low-level pieces (`createLine2Pipeline`, `LINE2_WGSL`, packing helpers) are exported if you want a custom host without `Line2Renderer`.

---

## Integration notes (Galaxy)

- Prefer this for **screen-space thick** rings, handles, selection outlines — **not** high-N fleet trails (those stay GPU line-list).
- **Overlay budgets:** ~48 segs/ring, few polylines, total ~≤256 segs common-case; do not Line2 fleet trails at any scale (see §3 and [`VISUAL-REVIEW.md`](./VISUAL-REVIEW.md#recommended-budgets-for-galaxy)).
- Topology connections are wired via `ConnectionLineGpuLayer` (Line2); fleet trails stay thin `line-list`.
- Keep workers free of this module (GPU main-thread only).
- Build: files live under `js/**/*.ts` and compile with `./build.sh`.

### Pure tests (no browser / WebGPU)

After a build, from repo root:

```bash
node js/vendor/line2/tests/run-line2-tests.mjs
# or (builds then runs):
scripts/run-line2-tests.sh
```

`run-line2-tests.mjs` runs all three pure-CPU suites (no GPU):

| Suite | File | Checks |
|-------|------|-------:|
| expand-ref | `tests/expand-ref.test.mjs` | 66 |
| geometry-material | `tests/geometry-material.test.mjs` | 90 |
| attr-state | `tests/attr-state.test.mjs` | 33 |
| **Total** | | **189** |

Covers screen-space expand reference, geometry packing / distances / template constants, material uniform layout, and attr/capacity/flag contracts. Expect:

```text
line2 tests: all passed (189 checks: 66 expand-ref + 90 geometry-material + 33 attr-state)
```

---

## Notice

> Algorithm and geometry layout ported from three.js  
> `examples/jsm/lines/LineMaterial.js`, `LineSegmentsGeometry.js`, `LineGeometry.js`,  
> `examples/jsm/lines/webgpu/LineSegments2.js`, and `src/materials/nodes/Line2NodeMaterial.js`.  
> Copyright © three.js authors — MIT License.
