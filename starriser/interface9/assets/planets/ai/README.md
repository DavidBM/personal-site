# Offline AI surface patches (patch-native library)

Isolated, stamp-ready textures for the planet baker.

**Default product path:** paired **color + true normals** for major geological
features and craters; **color-only** large texturization stamps for orbit-scale
surface detail. No normals-only bank. No impact files under texturization.

**Exception — gas flow:** cloud band / current / vortex banks under
`patches/*/gas/` are authored by an offline **sphere-surface flow
simulation** (`scripts/gen-gas-flow-patches.py`), not Imagine stripes.

**Gas bake orientation + warp:**
- Gas stamps use `rotationMode: "bandAligned"` (rotation = 0) so band/current
  texture stays latitude-aligned with planetary belts — not free random spin.
- After baseline materials + stamps, bake **advects albedo** by a precomputed
  UV velocity field (`generateGasVelocityField` + `advectAlbedoByGasVelocity`).

## Layout

```
assets/planets/ai/patches/
  texturization/
    geology/00.png … 17.png   # large fine-detail color (NO impacts; QA-culled)
    terrain-features/00.png … 38.png  # green-screen mattes; structure, low color tint
    gas/00.png … 11.png       # flow / current fields (gas class)
  colorized-normals/
    impacts/00.png … 39.png   # crater albedo (2×)
    impacts/00.n.png … 39.n.png  # paired true normals (required)
    geology/00.png …            # major feature albedo (+ extras beyond texturization)
    geology/00.n.png …          # paired true normals (required)
    gas/00.png … 11.png       # vortex/storm albedo (normals optional)
  clouds/
    cyclones/00.png …                    # spiral cyclone arms (29)
    long-and-sharp/00.png …              # elongated decks (27)
    mixed/00.png …                       # mixed morphologies (16)
    spread-out-small-cluster-of-clouds/  # multi-island sparse (14)
    unique-shapes/00.png …               # irregular bodies (11)
    huge-clouds/00.png …                 # soft mega decks (13)
    # ≥110 total; native res (e.g. 1792×1008), no crop/square
    # green→α + despill + near_white_soft greyscale [0.78, 0.96]
    # (old light/heavy/cyclone/storm layouts retired)
```

### Cloud authoring (product)

Categories match Downloads zip basenames. Matte is **green→alpha + despill** then
**near_white_soft** greyscale (luma stretch into [0.78, 0.96]; alpha unchanged —
no solid-core rebuild). Bake stamps with plain straight-alpha over.

```bash
# From category zips (preferred full rebuild):
/home/david/.venvs/galaxy-rmbg/bin/python scripts/matte-cloud-downloads-bank.py \
  --zips-dir /home/david/Downloads/clouds \
  --out assets/planets/ai/patches/clouds \
  --replace-bank

# Single-image install gate:
node scripts/install-cloud-stamp.mjs --class cyclones --src /path/to.jpg

# Bank QA (green-spill / empty / dark / soft-edge):
node scripts/sweep-cloud-bank.mjs --check
```

Base prompt (adapt morphology per zip; **never** include ISS/window/planet limb):

> In the context of videogame and planet design for videogames. A asset of a
> satellite image of a cloud, seems form space, isolated and ready to be used.
> With only the cloud formation and nothing else. Background is solid green
> screen, ready to be selected and extracted. Image is what a cloud looks from
> space, a high elevation altitude. This formation of clouds are calm,
> long, and low altitude. No spacecraft, no window, no Earth surface.

| Kind | Channels | Notes |
|------|----------|--------|
| `texturization` | albedo + soft α | Large stamps, fine small-scale detail; geology + gas only — **never impacts** |
| `colorized-normals` | albedo + soft α | Major features; land pairs with `NN.n.png` true normals |

**No product `patches/normals/` tree.** Paired normals live next to color as
`colorized-normals/<family>/<idx>.n.png`.

**Authorship / provenance:** Land albedo is **Imagine-authored** (satellite top-down;
`image_edit` from normal maps for majors, `image_gen` for texturization). True
normals for land majors ship as `NN.n.png`. Gas is **sim-authored**. Manifest:
`assets/planets/ai/patches/PROVENANCE.json`.

**Rebuild helpers:**

```bash
# optional formula fallback (not product default):
python scripts/rebuild-ai-patch-bank.py --normal-ref /path/to/normals
# gas flow (product):
/home/david/.venvs/galaxy-rmbg/bin/python scripts/gen-gas-flow-patches.py
```

## Imagine / authoring rules (land product bank)

All stamps are **satellite top-down / from-space / orthographic zoom-out**:

1. **No horizon** — pure overhead; no sky, limb, or side-looking aerial.
2. **No recognizable human objects** (buildings, roads, vehicles, UI chrome).
3. **Major features (impacts / geology colorized):** crater bowls, mountain
   chains, canyons, fault scarps — each ships **color + true normal** pair.
4. **Texturization:** natural color variation only (desert varnish, sediment
   bands, rock mosaic, dry riverbeds). Does **not** include impact craters.
   Authored larger with finer detail so one stamp covers more surface.
5. After export (albedo isolation):
   - **Albedo:** soft full-bleed corner alpha (`ml-matte-ai-patches.py` default
     fullbleed, or rebuild script soft corner).
   - **Normals (`*.n.png`):** `scripts/postprocess-ai-normals.mjs` — A=255 +
     neutral flat margins `(128,128,255)`.

`scripts/gen-planet-ai-patches.mjs` is **quarantined** (equation fill must not
overwrite this bank).

### Gas flow authoring (offline sim)

```bash
/home/david/.venvs/galaxy-rmbg/bin/python scripts/gen-gas-flow-patches.py
```

Writes multi-hue palettes into `texturization/gas/` and `colorized-normals/gas/`.

## Placement rules (bake planner)

Shipped planner: `planAiPatches` in `ai-patches.ts` (same function smoke tests).

| Rule | Behavior |
|------|----------|
| **Unique sources** | Each library path/index ≤1 use per planet bake role |
| **Bank cap** | Requested count capped by remaining bank size (no silent reuse) |
| **Non-overlap** | Same-role stamps pack with angular separation ≥ sum(radii)×margin |
| **Size hierarchy** | Texturization = large radii; major features / impacts = smaller |
| **Sphere-correct** | Geodesic tangent stamps + U wrap; poles rebuilt after all rounds |

Class routing:

| Class | Large texture | Features | Impacts |
|-------|---------------|----------|---------|
| rocky / temperate / ocean / ice / exotic | geology | geology (paired) | paired color+normal |
| gas | **gas** | **gas** | **no** |

## Authoring density (`planPatchDensity`)

Requests are upper bounds; effective stamps = `min(request, bank, packing)`.

| Class | Large texture | Features | Impacts |
|-------|---------------|----------|---------|
| temperate / ocean | ≤14 | ≤6 | ≤12 |
| rocky | ≤14 | ≤8 | ≤20 (full bank) |
| ice / exotic | ≤12 | ≤6–7 | ≤14–16 |
| gas | ≤12 | ≤4 | **0** |

Vegetation on temperate/ocean is **procedural orbit canopy** (no leaf bank).
