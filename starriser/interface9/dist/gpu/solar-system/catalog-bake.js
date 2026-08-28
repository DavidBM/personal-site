/**
 * Browser GPU catalog baker — 30 planets, product path, resume-safe.
 *
 * Entry: solar-catalog-bake.html → dist/gpu/solar-system/catalog-bake.js
 *
 * Query:
 *   resolution=4096  preview=1024  from=0  count=30
 *   force=1          rebake even if 4K albedo exists
 *   check=           dry-run (skip bake; report exists)
 *
 * Writes via POST /__catalog_write (Node scripts/bake-solar-catalog.mjs).
 * 4K albedo is the resume sentinel and is written last per planet.
 */
import { bakePlanetTexturesAuto, requestPlanetBakeDevice, } from "../planet-texture/bake-gpu.js";
import { buildNightEmissiveRgba } from "../planet-texture/authoring-planet-gpu.js";
import { attachBiomeIntermediates, downsampleRgba, finishPlanetProduct, loadProductFinishBanks, rasterizeExtraPoleProducts, } from "../planet-texture/product-finish.js";
import { PLANET_CATALOG, paramsForCatalogPlanet, } from "./planet-catalog.js";
import { CATALOG_MANIFEST_URL, catalogAlbedoRelpath, catalogMapRelpath, catalogMapsRecord, emptyCatalogManifest, parseCatalogManifest, sanitizeCatalogRelpath, } from "./catalog-assets.js";
const EMPTY_CLOUD_W = 4;
const EMPTY_CLOUD_H = 2;
const bakeState = {
    done: false,
    error: null,
    current: null,
    finishedIds: [],
};
function exposeState() {
    if (typeof window !== "undefined") {
        window.__catalogBake = bakeState;
    }
}
exposeState();
function queryFlag(q, name) {
    if (!q.has(name))
        return false;
    const v = q.get(name);
    if (v == null || v === "")
        return true;
    return v !== "0" && v !== "false" && v !== "no";
}
function evenAtLeast(n, fallback, min, max) {
    let v = Number.isFinite(n) ? Math.floor(n) : fallback;
    if (v % 2 !== 0)
        v -= 1;
    return Math.max(min, Math.min(max, v));
}
export function parseCatalogBakeQuery(search) {
    const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const resolution = evenAtLeast(Number(q.get("resolution") ?? 4096), 4096, 64, 8192);
    const preview = evenAtLeast(Number(q.get("preview") ?? 1024), 1024, 4, 8192);
    const fromRaw = Number(q.get("from") ?? 0);
    const countRaw = Number(q.get("count") ?? 30);
    const from = Number.isFinite(fromRaw) ? Math.max(0, Math.floor(fromRaw)) : 0;
    const count = Number.isFinite(countRaw) ? Math.max(0, Math.floor(countRaw)) : 30;
    return {
        resolution,
        preview,
        from,
        count,
        force: queryFlag(q, "force"),
        check: queryFlag(q, "check"),
    };
}
function el(id) {
    return typeof document !== "undefined" ? document.getElementById(id) : null;
}
function setText(id, text, error = false) {
    const node = el(id);
    if (!node)
        return;
    node.textContent = text;
    node.classList.toggle("error", error);
}
function paintUi() {
    const cur = bakeState.current;
    setText("status", bakeState.error ? bakeState.error : cur?.stage ?? "Starting…", !!bakeState.error);
    setText("error", bakeState.error ?? "", !!bakeState.error);
    if (cur) {
        setText("planet", `${cur.name} (${cur.id})  ${cur.index + 1}/${cur.total}`);
        setText("progress", `${Math.round(cur.frac * 100)}%  ${cur.stage}`);
    }
    else if (bakeState.done) {
        setText("planet", "—");
        setText("progress", bakeState.error ? "failed" : "100%");
        if (!bakeState.error)
            setText("status", "Done.");
    }
    setText("finished", bakeState.finishedIds.join(", ") || "—");
}
function setStage(partial) {
    const prev = bakeState.current;
    bakeState.current = {
        id: partial.id ?? prev?.id ?? "",
        name: partial.name ?? prev?.name ?? "",
        index: partial.index ?? prev?.index ?? 0,
        total: partial.total ?? prev?.total ?? 0,
        stage: partial.stage,
        frac: partial.frac ?? prev?.frac ?? 0,
    };
    paintUi();
}
function emptyClouds() {
    return {
        width: EMPTY_CLOUD_W,
        height: EMPTY_CLOUD_H,
        rgba: new Uint8ClampedArray(EMPTY_CLOUD_W * EMPTY_CLOUD_H * 4),
    };
}
function isEmptyClouds(buf) {
    if (!buf || buf.width < 1 || buf.height < 1 || !buf.rgba)
        return true;
    const a = buf.rgba;
    for (let i = 3; i < a.length; i += 4) {
        if ((a[i] ?? 0) > 0)
            return false;
    }
    return true;
}
function cloudsOrEmpty(buf) {
    return isEmptyClouds(buf) ? emptyClouds() : buf;
}
async function catalogFileExists(rel) {
    const safe = sanitizeCatalogRelpath(rel);
    if (!safe)
        return false;
    try {
        const r = await fetch(`/__catalog_exists?rel=${encodeURIComponent(safe)}`, {
            cache: "no-store",
        });
        if (r.ok) {
            const j = (await r.json());
            if (typeof j.exists === "boolean")
                return j.exists;
        }
    }
    catch {
        /* fall through to static HEAD */
    }
    try {
        const r = await fetch(`/${safe}`, { method: "HEAD", cache: "no-store" });
        return r.ok;
    }
    catch {
        return false;
    }
}
async function writeCatalogFile(rel, body) {
    const safe = sanitizeCatalogRelpath(rel);
    if (!safe)
        throw new Error(`refusing catalog write: ${rel}`);
    const res = await fetch("/__catalog_write", {
        method: "POST",
        headers: {
            "X-Catalog-Relpath": safe,
            "Content-Type": "application/octet-stream",
        },
        body,
    });
    if (!res.ok && res.status !== 204) {
        const t = await res.text().catch(() => "");
        throw new Error(`write ${safe} failed: HTTP ${res.status} ${t}`);
    }
}
async function deleteCatalogFile(rel) {
    const safe = sanitizeCatalogRelpath(rel);
    if (!safe)
        return;
    await fetch("/__catalog_write", {
        method: "DELETE",
        headers: { "X-Catalog-Relpath": safe },
    }).catch(() => null);
}
/** Compressed PNG via canvas — uncompressed stored-block PNG is too huge at 4K. */
async function encodePngBlob(rgba, width, height) {
    const w = width | 0;
    const h = height | 0;
    if (w < 1 || h < 1)
        throw new Error(`encodePngBlob: bad size ${w}×${h}`);
    if (rgba.length < w * h * 4) {
        throw new Error(`encodePngBlob: buffer short for ${w}×${h}`);
    }
    const copy = new Uint8ClampedArray(w * h * 4);
    copy.set(rgba.subarray(0, w * h * 4));
    const image = new ImageData(copy, w, h);
    if (typeof OffscreenCanvas !== "undefined") {
        const canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext("2d");
        if (!ctx)
            throw new Error("OffscreenCanvas 2d unavailable");
        ctx.putImageData(image, 0, 0);
        return canvas.convertToBlob({ type: "image/png" });
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx)
        throw new Error("canvas 2d unavailable");
    ctx.putImageData(image, 0, 0);
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))), "image/png");
    });
}
async function writePng(rel, buf) {
    const blob = await encodePngBlob(buf.rgba, buf.width, buf.height);
    await writeCatalogFile(rel, blob);
}
function previewOf(buf, pw, ph) {
    if (buf.width === pw && buf.height === ph)
        return buf;
    return {
        width: pw,
        height: ph,
        rgba: downsampleRgba(buf.rgba, buf.width, buf.height, pw, ph),
    };
}
async function loadExistingManifest() {
    try {
        const r = await fetch(`/${CATALOG_MANIFEST_URL}`, { cache: "no-store" });
        if (!r.ok)
            return null;
        return parseCatalogManifest(await r.json());
    }
    catch {
        /* none */
    }
    return null;
}
function upsertPlanet(manifest, entry) {
    const row = {
        id: entry.id,
        name: entry.name,
        kind: entry.kind,
        planetClass: entry.planetClass,
        seed: entry.seed,
        orbitT: entry.orbitT,
        maps: catalogMapsRecord(entry.id),
    };
    const i = manifest.planets.findIndex((p) => p.id === entry.id);
    if (i >= 0)
        manifest.planets[i] = row;
    else
        manifest.planets.push(row);
    const order = new Map();
    for (let k = 0; k < PLANET_CATALOG.length; k++) {
        order.set(PLANET_CATALOG[k].id, k);
    }
    manifest.planets.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
}
async function writeManifest(manifest) {
    manifest.bakedAt = new Date().toISOString();
    await writeCatalogFile(CATALOG_MANIFEST_URL, JSON.stringify(manifest, null, 2));
}
async function writePlanetMaps(entry, set, night, extraPoles, previewW, previewH, onStage) {
    const id = entry.id;
    const albedo = set.albedo;
    const normal = set.normal;
    const spec = set.liquidMask;
    const nightBuf = {
        width: set.albedo.width,
        height: set.albedo.height,
        rgba: night,
    };
    const clouds = cloudsOrEmpty(set.clouds);
    const height = set.height;
    // Gas has no land biomes — skip the diagnostic biome plate.
    const skipBiome = entry.planetClass === "gas";
    const biomeSrc = set.intermediates?.pureBiomeSplit ?? set.intermediates?.heightHeat;
    if (!skipBiome && !biomeSrc) {
        throw new Error(`${id}: biome map missing after attachBiomeIntermediates`);
    }
    const poleN = set.poleNorth;
    const poleS = set.poleSouth;
    const cloudsPN = cloudsOrEmpty(set.cloudsPoleNorth ?? null);
    const cloudsPS = cloudsOrEmpty(set.cloudsPoleSouth ?? null);
    const writes = [
        { key: "normal", buf: normal },
        { key: "spec", buf: spec },
        { key: "night", buf: nightBuf },
        { key: "clouds", buf: clouds },
        { key: "height", buf: height },
    ];
    if (!skipBiome && biomeSrc) {
        writes.push({ key: "biome", buf: biomeSrc });
    }
    else if (skipBiome) {
        await deleteCatalogFile(catalogMapRelpath(id, "biome"));
    }
    writes.push({ key: "pole_n", buf: poleN }, { key: "pole_s", buf: poleS }, { key: "clouds_pole_n", buf: cloudsPN }, { key: "clouds_pole_s", buf: cloudsPS }, { key: "normal_pole_n", buf: extraPoles.normalPoleNorth }, { key: "normal_pole_s", buf: extraPoles.normalPoleSouth }, { key: "night_pole_n", buf: extraPoles.nightPoleNorth }, { key: "night_pole_s", buf: extraPoles.nightPoleSouth });
    const emptyCloud = clouds.width === EMPTY_CLOUD_W && clouds.height === EMPTY_CLOUD_H;
    const previewJobs = [
        { key: "preview_normal", buf: previewOf(normal, previewW, previewH) },
        { key: "preview_spec", buf: previewOf(spec, previewW, previewH) },
        { key: "preview_night", buf: previewOf(nightBuf, previewW, previewH) },
        {
            key: "preview_clouds",
            buf: emptyCloud ? emptyClouds() : previewOf(clouds, previewW, previewH),
        },
        { key: "preview_albedo", buf: previewOf(albedo, previewW, previewH) },
    ];
    const total = writes.length + previewJobs.length + 1;
    let n = 0;
    for (const job of writes) {
        onStage(`encode ${job.key}`, 0.82 + (n / total) * 0.16);
        await writePng(catalogMapRelpath(id, job.key), job.buf);
        n++;
    }
    for (const job of previewJobs) {
        onStage(`encode ${job.key}`, 0.82 + (n / total) * 0.16);
        await writePng(catalogMapRelpath(id, job.key), job.buf);
        n++;
    }
    // Resume sentinel last.
    onStage("encode albedo", 0.98);
    await writePng(catalogMapRelpath(id, "albedo"), albedo);
}
function yieldBrowser() {
    return new Promise((r) => setTimeout(r, 0));
}
export async function runCatalogBake(search) {
    exposeState();
    bakeState.done = false;
    bakeState.error = null;
    bakeState.finishedIds = [];
    bakeState.current = null;
    paintUi();
    const q = parseCatalogBakeQuery(search ?? (typeof location !== "undefined" ? location.search : ""));
    const start = Math.min(PLANET_CATALOG.length, q.from);
    const end = Math.min(PLANET_CATALOG.length, start + q.count);
    const slice = PLANET_CATALOG.slice(start, end);
    const previewW = q.preview;
    const previewH = Math.max(2, q.preview >> 1);
    if (slice.length === 0) {
        bakeState.done = true;
        bakeState.error = "empty catalog range";
        paintUi();
        return bakeState;
    }
    setStage({
        id: slice[0].id,
        name: slice[0].name,
        index: 0,
        total: slice.length,
        stage: "Requesting WebGPU device…",
        frac: 0,
    });
    const device = await requestPlanetBakeDevice();
    device.lost.then((info) => {
        if (!bakeState.done) {
            bakeState.error = `GPU device lost (${info.reason}): ${info.message}`;
            paintUi();
        }
    });
    setStage({ stage: "Loading AI product-finish banks…", frac: 0.02 });
    const banks = await loadProductFinishBanks();
    let manifest = (await loadExistingManifest()) ?? emptyCatalogManifest(q.resolution, previewW);
    manifest.resolution = q.resolution;
    manifest.previewResolution = previewW;
    try {
        for (let i = 0; i < slice.length; i++) {
            const entry = slice[i];
            setStage({
                id: entry.id,
                name: entry.name,
                index: i,
                total: slice.length,
                stage: q.check ? "check" : "prepare",
                frac: i / slice.length,
            });
            const albedoRel = catalogAlbedoRelpath(entry.id);
            const exists = await catalogFileExists(albedoRel);
            if (q.check || (exists && !q.force)) {
                upsertPlanet(manifest, entry);
                await writeManifest(manifest);
                bakeState.finishedIds.push(entry.id);
                paintUi();
                await yieldBrowser();
                continue;
            }
            const params = paramsForCatalogPlanet(entry, q.resolution);
            setStage({
                stage: `GPU bake ${q.resolution}×${q.resolution >> 1}`,
                frac: i / slice.length,
            });
            let set = null;
            const baked = await bakePlanetTexturesAuto(params, {
                onProgress: (msg, frac) => {
                    setStage({
                        stage: msg,
                        frac: (i + frac * 0.62) / slice.length,
                    });
                },
            }, device);
            if (baked.backend !== "webgpu-full") {
                throw new Error(`catalog bake requires WebGPU (got ${baked.backend}; no CPU product fallback)`);
            }
            set = baked.set;
            setStage({
                stage: "finishPlanetProduct (stamps + clouds)",
                frac: (i + 0.64) / slice.length,
            });
            await finishPlanetProduct(set, { banks });
            setStage({
                stage: "night emissive",
                frac: (i + 0.74) / slice.length,
            });
            const night = buildNightEmissiveRgba(set);
            setStage({
                stage: "biome intermediates",
                frac: (i + 0.76) / slice.length,
            });
            attachBiomeIntermediates(set, q.resolution);
            setStage({
                stage: "extra poles",
                frac: (i + 0.8) / slice.length,
            });
            const extraPoles = rasterizeExtraPoleProducts(set, night);
            await writePlanetMaps(entry, set, night, extraPoles, previewW, previewH, (stage, frac) => setStage({ stage, frac: (i + frac) / slice.length }));
            upsertPlanet(manifest, entry);
            await writeManifest(manifest);
            bakeState.finishedIds.push(entry.id);
            paintUi();
            set = null;
            await yieldBrowser();
        }
        bakeState.done = true;
        bakeState.current = {
            id: "",
            name: "",
            index: slice.length,
            total: slice.length,
            stage: "Done.",
            frac: 1,
        };
        paintUi();
        return bakeState;
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        bakeState.error = msg;
        bakeState.done = true;
        paintUi();
        throw e;
    }
}
function boot() {
    void runCatalogBake().catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        bakeState.error = msg;
        bakeState.done = true;
        paintUi();
        console.error("[catalog-bake]", e);
    });
}
if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot, { once: true });
    }
    else {
        boot();
    }
}
//# sourceMappingURL=catalog-bake.js.map