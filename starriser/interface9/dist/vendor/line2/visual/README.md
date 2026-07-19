# Line2 visual suite

Independent WebGPU page for **human evaluation** of the vendored fat-line library.

No Three.js. No Galaxy app. Imports built modules from `/dist/vendor/line2/`.

## Open

**One shot** (build + serve + WebGPU Chromium, same flags as `gpu-chromium.desktop`):

```bash
# from repo root
./scripts/run-line2-visual.sh
```

Uses `~/.local/bin/gpu-chromium` when present (same profile / Vulkan WebGPU flags as the desktop entry), plus remote DevTools on `127.0.0.1:9222`. Ctrl+C stops browser and server.

```bash
./scripts/run-line2-visual.sh --no-build          # reuse existing dist/
./scripts/run-line2-visual.sh --isolated          # fresh profile (no handoff to open session)
PORT=9000 ./scripts/run-line2-visual.sh           # custom static port
DEBUG_PORT=9223 ./scripts/run-line2-visual.sh     # if 9222 is busy
```

If gpu-chromium is already open, the launcher exits with “Opening in existing browser session”
and a **new window** is opened there — the script **keeps the server up** until Ctrl+C.

**Manual** (Chromium recommended):

```bash
./build.sh
node tests/scripts/serve.mjs
# → http://127.0.0.1:8765/js/vendor/line2/visual/index.html
```

## Controls

| Control | Effect |
|---------|--------|
| pause | freeze rAF draws |
| animate | cameras / churn / residual time |
| softAA | case default / force on (endcaps) / force off (hard caps). **Reloads examples** on change. Long edges: **MSAA×4 + a2c**. |
| width | global linewidth scale |
| filter | match id / title / kind / hint |
| kind | show one category (`all` / `good` / `residual` / …) |
| legend | click a kind swatch — same as kind select (colors match caption badges) |

HUD shows `kind`, tiles, FPS, segs, **MSAA×4**, softAA mode, width.

## Case kinds

| Badge | Meaning | Caption color |
|-------|---------|---------------|
| **good** | Happy path quality | green |
| **residual** | Accepted risks from `VISUAL-REVIEW.md` — evaluate tradeoffs | amber |
| **degen** | Zero-length, tiny, reverse, grow+colors | red |
| **perf** | 100 → 8k segments; FPS in HUD | blue |
| **integration** | Galaxy `depthFormat:null` (I01) vs depth occluder (I02) | purple |

Legend swatches and caption left-borders / kind-tags use the same CSS variables.

## Case catalog (IDs)

| Kind | IDs |
|------|-----|
| **good** | H01 axis H/V · H02 diagonals · H03 zig-zag · H04 circle · **H05 thickness ladder (multi-draw 1…12 px)** · H06a softAA on · H06b softAA off · H07 dashed · H08 vertex colors · H09 opacity · H10 ortho · H11 perspective · H12 dolly screen-px |
| **residual** | **R01** near clip.w · **R02** extreme FOV · **R03** worldUnits near eye · **R04** worldUnits+dolly · **R05** screen-space dolly (recommended) |
| **degen** | D01 zero-length · D02 tiny · D03 collinear+reverse · D04 1px · D05 color after grow |
| **perf** | P01 100 · P02 1k · P03 8k · P04 static orbit · P05 per-frame churn |
| **integration** | I01 `depthFormat:null` · I02 depth occluder |

## Anti-aliasing policy (this page)

| Technique | Suite default |
|-----------|----------------|
| MSAA / resolve | **On** (`sampleCount: 4`, resolve to canvas) |
| `alphaToCoverage` | **On** (depth-bearing tiles) |
| Material `softAA` | **Case default** (endcaps only — no ribbon skirts) |

No UV/ribbon-extension long-edge fades (those cause gradient artifacts).

## Depth / pipeline variants

Most tiles draw in **pass 1** with a **`depth24plus`** attachment (I02 occluder).
**I01** uses `depthFormat: null` and is drawn in **pass 2** (color-only, `loadOp: load`).

| ID | Pipeline | Pass | What it tests |
|----|----------|------|---------------|
| **I01** | **`depthFormat: null`** | Color-only (2nd) | Galaxy map default — no `depthStencil` on pipeline |
| **I02** | `depthFormat: "depth24plus"` | Depth (1st) | Depth test vs a depth-writing box |

**Bug fixed (blank suite):** putting a `depthFormat: null` pipeline into a depth-bearing pass is a **WebGPU validation error** and invalidates the whole command encoder.

### Galaxy wire-up checklist

| Host pass | Line2 `depthFormat` | Result |
|-----------|---------------------|--------|
| Color-only (Galaxy map today) | **`null` (default)** | ✓ correct |
| Color-only | `"depth24plus"` | ✗ validation error |
| Depth-bearing | `"depth24plus"` | ✓ (I02-style) |
| Depth-bearing | `null` | ✗ validation error — separate color-only pass or depth pipeline |

## Residual tiles (must-see)

Leave **animate** on. Set kind=`residual` (or click the amber **residual** legend swatch). Cameras were tightened (Cycle 1 V3) so paths are actually hit. Captions start with **TRADEOFF** so each tile states the risk.

| ID | Path stressed | Expected visual / tradeoff (human) |
|----|---------------|-------------------------------------|
| **R01** | Screen-space `offset * clip.w` + `ndc / w` near plane | Thickness **spike**, ribbon thrash — avoid grazing near plane |
| **R02** | NDC `dir = ndcEnd−ndcStart` under ~165° FOV | Warped / uneven width at edges; orientation jitter while orbiting |
| **R03** | `worldUnits` FS `normalize(worldPos)` + `closestLineToLine` | Holes, alpha freckles, endcap pop when eye ≈ line (view-space origin) |
| **R04** | `worldUnits` true + wide dolly | Thickness **grows on zoom-in / shrinks on zoom-out** (~10×) — accept only for world-true width |
| **R05** | Same dolly, `worldUnits` false | **Constant ~px width** — recommended for map overlays |

Compare **H12** / **R05** (screen px holds) vs **R04** (world units change).

**H05** multi-width ladder: 12 separate encodes (one linewidth each). Quality of 1…12 px steps is the happy path; cost is the multi-draw tradeoff.

## Perf takeaway

P03 (8k segs) shows why fleet trails stay on thin GPU `line-list`, not Line2.

## Files

| File | Role |
|------|------|
| `index.html` | Shell + CSS (badge / legend colors) |
| `main.mjs` | WebGPU bootstrap, multi-viewport tiles, kind filter + HUD |
| `cases.mjs` | Geometry / material catalog |
| `cameras.mjs` | Mat4 + residual camera presets |
| `layout.mjs` | Tile grid + caption placement |
