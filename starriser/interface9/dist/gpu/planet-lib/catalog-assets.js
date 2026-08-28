/**
 * Catalog bake manifest + repo-root asset paths for the solar-system showcase.
 *
 * Manifest is written by the offline catalog baker. Runtime loads preview maps
 * for every planet and upgrades the focused body to 4K + pole caps.
 */
export const CATALOG_ASSET_ROOT = "assets/solar/catalog";
export const CATALOG_MANIFEST_URL = "assets/solar/catalog/manifest.json";
/** Known baker map keys (others are ignored). */
export const CATALOG_MAP_KEYS = [
    "albedo",
    "normal",
    "spec",
    "night",
    "clouds",
    "height",
    "biome",
    "pole_n",
    "pole_s",
    "clouds_pole_n",
    "clouds_pole_s",
    "normal_pole_n",
    "normal_pole_s",
    "night_pole_n",
    "night_pole_s",
    "preview_albedo",
    "preview_normal",
    "preview_spec",
    "preview_night",
    "preview_clouds",
];
/** Alias used by the baker / smoke — same list as CATALOG_MAP_KEYS. */
export const CATALOG_MANIFEST_MAP_KEYS = CATALOG_MAP_KEYS;
const ID_RE = /^[a-z][a-z0-9_-]{0,63}$/;
export function isCatalogPlanetId(id) {
    return ID_RE.test(id);
}
/** Resume sentinel — 4K albedo must be written last. */
export function catalogAlbedoRelpath(id) {
    return catalogMapRelpath(id, "albedo");
}
export function catalogMapRelpath(id, key) {
    if (!isCatalogPlanetId(id)) {
        throw new Error(`invalid catalog planet id: ${id}`);
    }
    if (key.startsWith("preview_")) {
        const file = key.slice("preview_".length);
        return `${CATALOG_ASSET_ROOT}/${id}/preview/${file}.png`;
    }
    return `${CATALOG_ASSET_ROOT}/${id}/4k/${key}.png`;
}
export function catalogMapsRecord(id) {
    const maps = {};
    for (const key of CATALOG_MAP_KEYS) {
        maps[key] = catalogMapRelpath(id, key);
    }
    return maps;
}
/**
 * Allow only repo-root relative paths under `assets/solar/catalog/`.
 * Rejects `..`, NUL, and escape. Shared by the baker POST and Node writer.
 */
export function sanitizeCatalogRelpath(rel) {
    const n = String(rel || "")
        .replace(/\\/g, "/")
        .replace(/^\/+/, "");
    if (!n || n.includes("\0") || n.includes(".."))
        return null;
    if (!n.startsWith(`${CATALOG_ASSET_ROOT}/`))
        return null;
    if (n === `${CATALOG_ASSET_ROOT}/`)
        return null;
    return n;
}
export function emptyCatalogManifest(resolution, previewResolution) {
    return {
        version: 1,
        resolution,
        previewResolution,
        planets: [],
    };
}
function isRecord(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
}
function asStringMap(v) {
    if (!isRecord(v))
        return {};
    const out = {};
    for (const [k, val] of Object.entries(v)) {
        if (typeof val === "string" && val.trim())
            out[k] = val.trim();
    }
    return out;
}
/** Validate a JSON payload; returns null when unusable. */
export function parseCatalogManifest(raw) {
    if (!isRecord(raw))
        return null;
    if (raw.version !== 1)
        return null;
    if (!Array.isArray(raw.planets))
        return null;
    const resolution = Number(raw.resolution);
    const previewResolution = Number(raw.previewResolution);
    if (!Number.isFinite(resolution) || resolution <= 0)
        return null;
    if (!Number.isFinite(previewResolution) || previewResolution <= 0)
        return null;
    const planets = [];
    for (const p of raw.planets) {
        if (!isRecord(p))
            continue;
        const id = typeof p.id === "string" ? p.id.trim() : "";
        if (!id)
            continue;
        const name = typeof p.name === "string" && p.name.trim() ? p.name.trim() : id;
        const kind = typeof p.kind === "string" ? p.kind : "";
        const planetClass = typeof p.planetClass === "string" ? p.planetClass : "";
        const seedN = Number(p.seed);
        const orbitN = Number(p.orbitT);
        planets.push({
            id,
            name,
            kind,
            planetClass,
            seed: Number.isFinite(seedN) ? seedN : 0,
            orbitT: Number.isFinite(orbitN) ? orbitN : 0,
            maps: asStringMap(p.maps),
        });
    }
    if (planets.length === 0)
        return null;
    const bakedAt = typeof raw.bakedAt === "string" ? raw.bakedAt : undefined;
    return {
        version: 1,
        resolution,
        previewResolution,
        bakedAt,
        planets,
    };
}
/**
 * Fetch `assets/solar/catalog/manifest.json`. Returns null when missing,
 * unreadable, or not a v1 catalog (showcase then uses Earth fallback).
 */
export async function fetchCatalogManifest() {
    try {
        const res = await fetch(CATALOG_MANIFEST_URL);
        if (!res.ok)
            return null;
        return parseCatalogManifest(await res.json());
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=catalog-assets.js.map