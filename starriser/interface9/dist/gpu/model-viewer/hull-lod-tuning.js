/**
 * Hull detail ranges being tuned in the model viewer, per game class. They
 * start from the runtime catalog (`lod` in models/fleet-v2/catalog.json, else
 * DEFAULT_HULL_LOD), are edited in the LOD timeline, survive reloads in
 * localStorage and export as JSON in the catalog's `lod` format.
 */
import { compactJson } from "./json-format.js";
import { DEFAULT_HULL_LOD, HULL_LEVELS, hullLodToJson, parseHullLod, } from "../../lib/fleet-sim/visual/hull-lod.js";
import { SHIP_MODEL_CATALOG_URL, parseShipModelCatalog } from "../../lib/fleet-sim/visual/ship-model-catalog.js";
const STORAGE_KEY = "galaxy.model-viewer.hull-lod.v1";
const EXPORT_UNIT = "projected hull diameter in render pixels; a level draws while px is in [min, max); null max = no limit; where ranges overlap a ship keeps its current level";
function sameBands(a, b) {
    return HULL_LEVELS.every((l) => a[l][0] === b[l][0] && a[l][1] === b[l][1]);
}
function readStored() {
    try {
        const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
        return value && typeof value === "object" ? value : {};
    }
    catch {
        return {};
    }
}
/** Catalog ranges per class key; a missing or invalid catalog gives the defaults for `fallbackClasses`. */
async function catalogRanges(fallbackClasses) {
    try {
        const response = await fetch(SHIP_MODEL_CATALOG_URL);
        if (!response.ok)
            throw new Error(String(response.status));
        const catalog = parseShipModelCatalog(await response.json());
        return new Map(catalog.ships.map((ship) => [ship.key, parseHullLod(ship.lod)]));
    }
    catch {
        return new Map(fallbackClasses.map((key) => [key, DEFAULT_HULL_LOD]));
    }
}
export async function loadHullLodTuning(fallbackClasses) {
    const catalog = await catalogRanges(fallbackClasses);
    const stored = readStored();
    const current = new Map();
    for (const [key, bands] of catalog) {
        try {
            current.set(key, parseHullLod(stored[key], bands));
        }
        catch {
            current.set(key, bands);
        }
    }
    const listeners = [];
    const changed = () => {
        const out = {};
        for (const [key, bands] of current)
            if (!sameBands(bands, catalog.get(key)))
                out[key] = hullLodToJson(bands);
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
        }
        catch { /* private mode: edits last for this page */ }
        for (const listener of listeners)
            listener();
    };
    const bandsOf = (key) => current.get(key) ?? DEFAULT_HULL_LOD;
    return {
        classes: [...catalog.keys()],
        bands: bandsOf,
        edited: (key) => current.has(key) && !sameBands(bandsOf(key), catalog.get(key)),
        set(key, level, band) {
            if (!current.has(key))
                return;
            current.set(key, Object.freeze({ ...bandsOf(key), [level]: band }));
            changed();
        },
        applyToAll(key) {
            const bands = bandsOf(key);
            for (const other of current.keys())
                current.set(other, bands);
            changed();
        },
        reset(key) {
            if (!catalog.has(key))
                return;
            current.set(key, catalog.get(key));
            changed();
        },
        exportJson(extra = {}) {
            const classes = Object.fromEntries([...current].map(([key, bands]) => [key, hullLodToJson(bands)]));
            return compactJson({ galaxyHullLod: 1, unit: EXPORT_UNIT, classes, ...extra });
        },
        subscribe(listener) { listeners.push(listener); },
    };
}
//# sourceMappingURL=hull-lod-tuning.js.map