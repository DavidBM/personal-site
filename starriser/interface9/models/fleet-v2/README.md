# Fleet v2 hulls

The production hull catalog (`SHIP_MODEL_CATALOG_URL`). Six classes, each with
four ordinary mesh files; the fifth level, below about a pixel, is one camera-facing
triangle. Every class also has a selected-only `veryHigh` mesh. Each class carries its own
pixel ranges in `lod` (see `hull-lod.ts`
and "Per-ship render budget" in the
[renderer reference](../../docs/renderer-reference.md)); the model viewer's Tune
LOD mode edits them and exports JSON in this format.

| File | Level | Source | Triangles | Textures |
| --- | --- | --- | ---: | --- |
| `veryHigh` | selected full | Tripo H3.1 ~2M, fresh UVs and rebake | ~15k | 4096² |
| `high` | full | Tripo H3.1 ~2M, fresh UVs and rebake | ~4k | 1024² |
| `low` | mid | Tripo H3.1 ~2M, hard-edge rebake | ~1000 | 1024² |
| `far` | low | Tripo H3.1 ~2M, hard-edge rebake | ~300 | 512² |
| `dart` | dart | Class outline from `high` (`hull-dart.ts`) | 10–16 | none, faction colour |

All six classes use reductions from their original Tripo H3.1 ~2M-triangle
sources: 4K full, 1K mid and 300 low, plus 15K for an individually followed ship.
Exact counts are recorded in `catalog.json` and the provenance JSONs under
`art/i3d/CLASS/lod/tripo-h31-*`. The Fighter now uses the chosen symmetric
**B — Swept joins**, with source bakes under `art/i3d/fighter/symmetry/lod/`.
Its levels have 14,918 / 3,988 / 988 / 282 triangles; each baked half is reflected
after reduction so geometry and textures stay symmetric. Other classes are
reduced directly from their original sources. All have fresh UVs and baked maps.
Normal levels retain the texture sizes
above. Catalog `veryHigh` replaces `high` only for the individually followed
ship in full-detail range (or manually set to high). Fleet selection alone does
not promote ships. Lower ranges, hysteresis, darts and points are unchanged.
The public site omits `veryHigh` (see `scripts/package-web.mjs`) until the game
loads it on demand instead of at startup.

Previous high/low/far meshes and their catalog entries are archived under
`old/`, and available in the viewer under **Old ships → Previous CLASS**.
The replaced asymmetric Fighter's four levels are additionally preserved in
`old/fighter-asymmetric/` and **Old ships → Fighter · asymmetric**.
The new **Selected ship → Very high** card also previews normal distance
transitions in Auto LOD mode. Original 4096² source bakes remain under the
viewer's collapsed **Other models** section.

`lod` holds the ranges the user tuned in the model viewer on 2026-10-11, for
example the interceptor draws full detail from 710 px, mid at 200–900, low at
17–250, the dart at 2.7–22 and a point below 3.4 px; the frigate enters full
detail at 345 px. Overlaps are hysteresis: a ship keeps its level inside them.
To retune, use Tune LOD in `model-viewer.html`, export the JSON and copy each
class's entry into its `lod`.

Each level carries base colour, a tangent normal map and a metallic-roughness
map (G roughness, B metal) as JPEG. Classes have their own textures
(`sharedMaterial: false`). The runtime shades with colour and metallic-roughness;
the normal map is kept for review tools and future use.

All levels of a class share one origin and a conservative radius-1 bound, with
+Z forward and +Y up baked into the vertices. Each class uses the 15K source's
centre and one uniform scale preserving the previous hull's length. If needed,
a small common origin adjustment fits every variant inside the unit bound;
proportions and class draw scales remain unchanged. Switching levels never
independently recentres or rescales a hull. Engine trails and glows for all six
promoted hulls come from the user's model-viewer export of 2026-10-15 (the
Colossus now has three engines).

## Engine trails and glows

Each ship's `trails` lists its engines (`at` in hull space, `width` the ribbon's
full width in hull radii, `style` a ribbon style) and `glows` its engine lights
(`at`, `size` as a diameter in hull radii, `style` a glow style). `trailStyles`
names each style's image in `fx/` (and a glow's `facing`: 1 shows only from
behind). Mid and full detail draw a ribbon per engine and, while the ship leaves
a trail (fading out as it comes to rest), the glows; low detail
draws a 1-px line per engine; dart and point keep one 1-px line per ship.
`fx/trail-textures.json` holds the generator settings the images come from and
the game's glow sprite size (`glowSizePx`: 512, sharper close up than the
viewer's 256 px preview).

All of it is authored in `model-viewer.html` (Trail emitters and Trail textures)
and imported from its Download JSON:

```sh
node scripts/import-ship-fx.mjs ~/Downloads/galaxy-hull-config.json   # catalog + fx/ images
```

The import also copies the export's `lod` ranges. To rebuild only the images:
`node scripts/bake-trail-textures.mjs models/fleet-v2/fx/trail-textures.json models/fleet-v2/fx`.

## Provenance and regeneration

The concepts are in `art/ship-concepts/production/` and the generated sources in
`art/i3d/` (tracked; see `art/i3d/README.md`). Lower levels come from
`scripts/simplify-ship.mjs` and `scripts/art/bake_ship_lod.py`, which keeps
edges sharper than 40° hard and face-weights the normals; the legacy all-smooth
rebake shaded large facets with false gradients. Reproduce a class
promotion from the repository root with numpy and Pillow installed:

```sh
.tmp/interceptor-15k/venv/bin/python scripts/art/promote_ship_lods.py bomber frigate battleship colossus
.tmp/interceptor-15k/venv/bin/python scripts/art/promote_ship_lods.py fighter --source-dir art/i3d/fighter/symmetry/lod --symmetry-x
```

This archives the original meshes once, normalizes all four reviewed reductions
together, converts maps to JPEG at the runtime sizes and updates only the
selected classes' geometry fields. It preserves the catalog's LOD ranges, effects,
scales and other classes. Source-bake reproduction is in `art/i3d/README.md`.

The historical all-class pipeline below emits a fresh catalog. Generate into a
staging directory and retain the current `lod`, scale, trail and glow fields
when adopting its results; it does not include the current source reductions:

```sh
cd art/i3d
./pipeline.sh CLASS lod thumbs            # per class: hard-edge LODs from the Tripo game model
cp build_game_catalog.mjs /tmp/meshopt-env/
ART_DIR=$PWD node /tmp/meshopt-env/build_game_catalog.mjs ../../models/fleet-v2
cd ../.. && npm run build && node scripts/art/build-hull-darts.mjs   # darts; keeps existing lod ranges
```

Darts are built from each class's normalised `high` mesh: the top-view
silhouette (mirrored, thin spikes opened away) becomes a star-shaped outline,
and an exact search keeps the fewest outline vertices whose polygon still
overlaps the silhouette by 85 % (intersection over union); a top and a bottom
apex close it, two triangles per outline vertex. `--min-overlap` and
`--max-triangles` (default 20) tune that trade. Rebuilding darts keeps existing
`lod` ranges.

`/tmp/meshopt-env` holds `@gltf-transform/core`, `functions`, `extensions` and
`meshoptimizer`, which are not repository dependencies.

Hull asset keys (`aster-vale/<class>` in `js/contracts/hull-appearance.ts`) are
class identities in the server contract and do not name this folder.
