/**
 * Meshes the model viewer can show, organised for the ship picker:
 * new ships by game class, and old ships (the previous game hulls and the
 * legacy attach fighter) in their own category.
 *
 * Per new class the picker shows, in order: the in-game LOD chain (the actual
 * runtime files in models/fleet-v2, full detail first and selected by default),
 * a "Low Poly" section whose method selector switches between reduction
 * pipelines with their own budgets, and a collapsed "Other models" section
 * grouped by generator.
 *
 * Legacy fighter entries keep their raw coordinates and the shared model scale,
 * because thruster attach picks are recorded in that space. Review entries are
 * recentred and scaled to a common radius; runtime entries keep the catalog's
 * shared origin (unit radius) so switching LOD does not shift the hull.
 *
 * Art-workspace meshes, thumbnails and concepts live in art/i3d/CLASS/ and
 * art/ship-concepts/; missing files fail per entry. See art/i3d/README.md.
 */
import { GLB_MESH_YAW_HALF } from "../../lib/fleet-sim/visual/mesh-yaw-facing.js";
import { SHIP_MODEL_CATALOG_URL } from "../../lib/fleet-sim/visual/ship-model-catalog.js";
/** Bounding radius of normalized review meshes, in viewer world units. */
export const VIEWER_REVIEW_RADIUS = 0.85;
const I3D = "art/i3d/";
const THUMBS = "art/i3d/thumbs/";
const AV = "models/aster-vale/";
const GAME = SHIP_MODEL_CATALOG_URL.slice(0, SHIP_MODEL_CATALOG_URL.lastIndexOf("/") + 1);
function review(id, label, detail, url, thumb = `${THUMBS}${id}.png`) {
    // Generated ships are turned nose-forward (+Z) in the file itself (art/i3d/orient.mjs).
    return { id, label, detail, url, yawHalf: 0, normalize: "fit", thumb };
}
function legacy(id, label, detail, url) {
    return { id, label, detail, url, procedural: url ? undefined : "paper-dart", yawHalf: url ? GLB_MESH_YAW_HALF : 0,
        normalize: false, thumb: url ? `${THUMBS}${id}.png` : null };
}
const CLASS_NAMES = ["Interceptor", "Fighter", "Bomber", "Frigate", "Battleship", "Colossus"];
function gameThumb(key, label) {
    return `${key}--${key === "fighter" ? "swept" : "tripo-h31"}-${label}`;
}
/**
 * The runtime chain for one class, most detailed first; thumbnails come from
 * the art sources of each level. Pixel ranges are tuned in the viewer's LOD
 * mode (hull-lod-tuning.ts), so cards show budgets only.
 */
function gameLods(key) {
    const level = (lod, label, detail, file, thumb) => ({
        id: `${key}--game-${lod}`, label, detail, url: file && `${GAME}${file}`, procedural: file ? undefined : "game-point",
        yawHalf: 0, normalize: "unit", thumb: thumb && `${THUMBS}${thumb}.png`, lod,
    });
    return [
        level("full", "Full · Tripo H3.1", "~4K tris", `${key}-high.glb`, gameThumb(key, "4k")),
        level("mid", "Mid · hard edges", "~1K tris", `${key}-low.glb`, gameThumb(key, "1k")),
        level("low", "Low · hard edges", "~300 tris", `${key}-far.glb`, gameThumb(key, "300")),
        level("dart", "Dart · class shape", "≤20 tris · flat", `${key}-dart.glb`, `${key}--game-dart`),
        level("point", "Point", "1 tri · faces the camera", null, null),
    ];
}
function variants(key, rows) {
    return rows.map(([v, label, detail, file]) => review(`${key}--${v}`, label, detail, `${I3D}${key}/${file}`));
}
function lowPoly(key) {
    const hard = [2000, 1000, 500, 300, 150].map((t) => [`hard-${t}`, `~${t} tris`, "hard-edge normals", `lod/hard-${t}.glb`]);
    const smooth = [300, 1000, 3000].map((t) => [`tripo-rebaked-${t}`, `~${t} tris`, "smooth normals", `lowpoly/tripo-rebaked-${t}.glb`]);
    return {
        label: "Low Poly", entries: [],
        methods: [
            { key: "hard", label: "Hard edges", entries: variants(key, hard),
                note: "Meshopt from the game model; normals split at 40° and face-weighted; colour, normal and metal/rough baked (scripts/art/bake_ship_lod.py)." },
            { key: "smooth", label: "Legacy smooth", entries: variants(key, smooth),
                note: "Legacy 3% method from the 2M-triangle Tripo model; all-smooth normals shade large facets with false gradients." },
        ],
    };
}
function otherModels(key) {
    const rebaked = (src) => [300, 1000, 3000].map((t) => [`${src}-rebaked-${t}`, `~${t} tris`, "legacy rebake", `lowpoly/${src}-rebaked-${t}.glb`]);
    const groups = [
        ["Tripo H3.1", [["tripo-h31-flat", "Full detail", "~2M tris · bake source", "runs/tripo-h31-flat--model_mesh.glb"]]],
        ["Tripo P1", [["tripo-p1", "Native low-poly", "~5k tris", "runs/tripo-p1--model_mesh.glb"]]],
        ["Meshy 7", [["meshy7-flat", "Full detail", "~1.4M tris", "runs/meshy7-flat--model_glb.glb"],
                ["meshy7-smart", "Smart topology", "≤15k tris", "runs/meshy7-smart--model_glb.glb"], ...rebaked("meshy")]],
        ["Rodin 2.5", [["rodin25-flat", "High", "500k tris", "runs/rodin25-flat--model_mesh.glb"],
                ["rodin25-4kquad", "4K quad", "~9k tris", "runs/rodin25-4kquad--model_mesh.glb"], ...rebaked("rodin")]],
        ["Hunyuan 3.1 Pro", [["hunyuan31", "Full detail", "500k tris", "runs/hunyuan31-single--model_glb.glb"]]],
        ["TRELLIS.2", [["trellis2", "Full detail", "~500k tris", "runs/trellis2-1536--model_glb.glb"]]],
    ];
    return groups.map(([label, rows]) => ({ label, entries: variants(key, rows), other: true }));
}
function symmetryReviews(key) {
    if (key !== "fighter")
        return [];
    return [{
            label: "Symmetry review",
            entries: [
                review("fighter--symmetry-original", "Original · asymmetric", "14,929 tris", `${I3D}fighter/lod/tripo-h31-15k.glb`, `${THUMBS}fighter--tripo-h31-15k.png`),
                review("fighter--symmetry-straight", "Symmetric · straight joins", "15,256 tris · mirrored half", `${I3D}fighter/symmetry/tripo-h31-straight.glb`),
                review("fighter--symmetry-swept", "B · Swept joins · chosen", "16,330 tris · reduction source", `${I3D}fighter/symmetry/tripo-h31-swept.glb`),
            ],
            note: "B is the chosen hull. Its symmetric reductions now supply the game LODs. A and the original remain here for comparison.",
        }, {
            label: "Swept Fighter · symmetric source bakes", other: true,
            entries: ["15k", "4k", "1k", "300"].map(label => review(`fighter--swept-${label}`, `${label.toUpperCase()} · symmetric`, "4K textures · mirrored half bake", `${I3D}fighter/symmetry/lod/tripo-h31-${label}.glb`)),
            note: "Freshly unwrapped and baked half hulls, reflected after reduction so every level remains symmetric.",
        }];
}
/** New ship designs by game class (art/i3d/CLASS/ and the runtime catalog). */
export const NEW_SHIP_CLASSES = CLASS_NAMES.map((name, i) => {
    const key = name.toLowerCase();
    return {
        key, name,
        concept: `art/ship-concepts/production/${i + 1}-${key}/concept-thumb.jpg`,
        groups: [
            { label: "In-game LODs", entries: gameLods(key), note: "Runtime files (models/fleet-v2) at their shared origin." },
            {
                label: "Selected ship",
                entries: [{ ...review(`${key}--game-very-high`, "Very high · 15K", "~15K tris · selected ship only", `${GAME}${key}-very-high.glb`, `${THUMBS}${gameThumb(key, "15k")}.png`),
                        normalize: "unit", selectedOnly: true }],
                note: "Used at full-detail range for the individually followed ship. Auto LOD previews the same ranges.",
            },
            ...symmetryReviews(key),
            {
                label: "Tripo H3.1 · source bakes", other: true,
                entries: ["15k", "4k", "1k", "300"].map(label => review(`${key}--tripo-h31-${label}`, `${label.toUpperCase()} triangles`, "4K textures · source bake", `${I3D}${key}/lod/tripo-h31-${label}.glb`)),
                note: "Reduced from the Tripo H3.1 ~2M source, with new UVs and rebaked maps. All use 4K textures to compare geometry.",
            },
            lowPoly(key),
            ...otherModels(key),
        ],
    };
});
const ASTER_VALE_TRIANGLES = {
    interceptor: ["3.4k", "348"], fighter: ["3.8k", "412"], bomber: ["4.5k", "428"],
    frigate: ["6.0k", "392"], battleship: ["4.9k", "388"], colossus: ["13.8k", "504"],
};
/** Old assets: the previous game hulls and the legacy thruster-attach fighter. */
export const OLD_SHIP_SETS = [
    {
        key: "fighter-asymmetric", name: "Fighter · asymmetric", concept: null,
        groups: [{ label: "Previous asymmetric Fighter", entries: [["very-high", "15k", "Very high"], ["high", "4k", "Full"], ["low", "1k", "Mid"], ["far", "300", "Low"]].map(([file, label, name]) => ({
                    ...review(`fighter--asymmetric-${file}`, `${name} · previous`, `${label} tris · asymmetric`, `${GAME}old/fighter-asymmetric/fighter-${file}.glb`, `${THUMBS}fighter--tripo-h31-${label}.png`),
                    normalize: "unit",
                })) }],
    },
    ...CLASS_NAMES.map((name) => {
        const key = name.toLowerCase();
        return {
            key: `previous-${key}`, name: `Previous ${name}`, concept: null,
            groups: [{ label: `Previous in-game ${name}`, entries: [
                        { ...review(`${key}--old-full`, "Full · previous", "~5K tris", `${GAME}old/${key}-high.glb`, `${THUMBS}${key}--tripo-h31-5k.png`), normalize: "unit" },
                        { ...review(`${key}--old-mid`, "Mid · previous", "~1K tris", `${GAME}old/${key}-low.glb`, `${THUMBS}${key}--hard-1000.png`), normalize: "unit" },
                        { ...review(`${key}--old-low`, "Low · previous", "~300 tris", `${GAME}old/${key}-far.glb`, `${THUMBS}${key}--hard-300.png`), normalize: "unit" },
                    ] }],
        };
    }),
    {
        key: "aster-vale",
        name: "Previous game hulls",
        concept: null,
        groups: CLASS_NAMES.map((name) => {
            const key = name.toLowerCase();
            const [high, low] = ASTER_VALE_TRIANGLES[key];
            const entry = (lod, tris) => review(`av-${key}-${lod}`, `${name} · ${lod.toUpperCase()}`, `${tris} tris`, `${AV}${key}-${lod}.glb`, `${AV}previews/${key}${lod === "low" ? "-low" : ""}.png`);
            return { label: `${name} · Aster Vale`, entries: [entry("high", high), entry("low", low)] };
        }),
    },
    {
        key: "legacy",
        name: "Test fighter",
        concept: null,
        groups: [
            {
                label: "Legacy fighter · thruster attach space",
                entries: [
                    legacy("simplify3", "Low-poly 3%", "272 tris, rebaked UVs", "models/spaceship_fighter_simplify3.glb"),
                    legacy("simplify50", "Game high-poly 50%", "4.6k, original UVs", "models/spaceship_fighter_simplify50.glb"),
                    legacy("glb", "Source high-poly", "9.1k tris", "models/spaceship_fighter__-_version_1_meshy_6.glb"),
                    legacy("simplify5", "Smart 5%", "456 tris, original UVs", "models/spaceship_fighter_simplify5.glb"),
                    legacy("simplify10", "Smart 10%", "913 tris, original UVs", "models/spaceship_fighter_simplify10.glb"),
                    legacy("simplify1", "Smart 1%", "90 tris, original UVs", "models/spaceship_fighter_simplify1.glb"),
                    legacy("voxel_chunky", "Voxel remesh chunky", "0.7k, baked", "models/spaceship_fighter_voxel_chunky.glb"),
                    legacy("lowpoly", "Dart (8 tris)", "procedural", null),
                ],
            },
        ],
    },
];
export const VIEWER_CATEGORIES = { new: NEW_SHIP_CLASSES, old: OLD_SHIP_SETS };
/** Every card of a group, across all its methods. */
export function groupEntries(group) {
    return [...group.entries, ...(group.methods ?? []).flatMap((m) => m.entries)];
}
export const VIEWER_MESHES = [...NEW_SHIP_CLASSES, ...OLD_SHIP_SETS].flatMap((s) => s.groups.flatMap(groupEntries));
export const VIEWER_DEFAULT_MESH = "interceptor--game-full";
export function viewerMeshEntry(id) {
    return VIEWER_MESHES.find((m) => m.id === id) ?? VIEWER_MESHES.find((m) => m.id === VIEWER_DEFAULT_MESH);
}
function newShipClass(id) {
    return NEW_SHIP_CLASSES.find((s) => s.groups.some((g) => groupEntries(g).some((e) => e.id === id)));
}
/** The runtime LOD chain of the class containing `id` (empty for old ships). */
export function viewerLodChain(id) {
    return newShipClass(id)?.groups.flatMap(groupEntries).filter((e) => e.lod) ?? [];
}
/** Game class (catalog key and name) of a new-ship mesh; null for old ships and ?glb reviews. */
export function viewerShipClass(id) {
    const set = newShipClass(id);
    return set ? { key: set.key, name: set.name } : null;
}
/** Category and set (class or old asset set) that contain a mesh id. */
export function viewerMeshPlace(id) {
    for (const category of ["new", "old"]) {
        for (const set of VIEWER_CATEGORIES[category]) {
            if (set.groups.some((g) => groupEntries(g).some((e) => e.id === id)))
                return { category, set: set.key };
        }
    }
    return { category: "new", set: NEW_SHIP_CLASSES[0].key };
}
/**
 * Recentre interleaved positions on their bounding-box centre (in place) and
 * return the uniform scale that brings the bounding radius to `radius`.
 */
export function normalizeInterleaved(interleaved, floatsPerVertex, radius) {
    const n = Math.floor(interleaved.length / floatsPerVertex);
    if (n === 0)
        return 1;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
        for (let a = 0; a < 3; a++) {
            const v = interleaved[i * floatsPerVertex + a];
            if (v < lo[a])
                lo[a] = v;
            if (v > hi[a])
                hi[a] = v;
        }
    }
    const centre = [0, 1, 2].map((a) => (lo[a] + hi[a]) / 2);
    let r2 = 0;
    for (let i = 0; i < n; i++) {
        let d2 = 0;
        for (let a = 0; a < 3; a++) {
            const v = interleaved[i * floatsPerVertex + a] - centre[a];
            interleaved[i * floatsPerVertex + a] = v;
            d2 += v * v;
        }
        if (d2 > r2)
            r2 = d2;
    }
    return r2 > 0 ? radius / Math.sqrt(r2) : 1;
}
/**
 * Line-list indices for every triangle edge. Shared edges are drawn once when
 * the mesh is small enough to deduplicate cheaply; very dense meshes draw each
 * triangle's three edges (identical pixels, no visible difference when opaque).
 */
export function buildEdgeIndices(indices, vertexCount, dedupeTriangleLimit = 400000) {
    const triangles = Math.floor(indices.length / 3);
    if (triangles > dedupeTriangleLimit) {
        const out = new Uint32Array(triangles * 6);
        for (let t = 0; t < triangles; t++) {
            const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
            out.set([a, b, b, c, c, a], t * 6);
        }
        return out;
    }
    const seen = new Set();
    const out = [];
    for (let t = 0; t < triangles; t++) {
        for (let k = 0; k < 3; k++) {
            const a = indices[t * 3 + k], b = indices[t * 3 + ((k + 1) % 3)];
            const lo = Math.min(a, b), hi = Math.max(a, b);
            const key = lo * vertexCount + hi;
            if (seen.has(key))
                continue;
            seen.add(key);
            out.push(lo, hi);
        }
    }
    return Uint32Array.from(out);
}
//# sourceMappingURL=viewer-catalog.js.map