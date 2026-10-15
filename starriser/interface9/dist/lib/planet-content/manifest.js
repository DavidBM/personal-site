import { PLANET_METADATA_BYTES, PLANET_PAGE_BYTES, assertPlanetIdentity, assertPlanetFieldName, bytesPerCell, } from "./contracts.js";
function text(value) { return typeof value === "string" && value.length > 0 && value.length <= 256; }
function hash(value) { return typeof value === "string" && /^[0-9a-f]{64}$/.test(value); }
function grid(width, height) {
    return Number.isSafeInteger(width) && width >= 2 && width <= 8192 && width % 2 === 0 && height === width / 2;
}
function validateMetadata(field) {
    if (field.kind === "scalar") {
        if (field.encoding !== "f32le" || !text(field.units))
            throw new Error("Invalid scalar field metadata");
        return;
    }
    if (field.kind !== "category" || field.encoding !== "u8" || !Array.isArray(field.labels)
        || !field.labels.length || field.labels.length > 256 || !field.labels.every(text)) {
        throw new Error("Invalid category field metadata");
    }
}
function validateLevel(level, field, manifest) {
    if (!grid(level.width, level.height) || level.width > manifest.masterWidth || manifest.masterWidth % level.width
        || level.byteLength !== level.width * level.height * bytesPerCell(field)
        || level.pageCount !== Math.ceil(level.byteLength / PLANET_PAGE_BYTES) || !hash(level.root)) {
        throw new Error("Invalid planet level");
    }
}
function validateFields(manifest) {
    const entries = Object.entries(manifest.fields);
    if (!entries.length || entries.length > 16)
        throw new Error("Invalid planet field count");
    for (const [name, field] of entries) {
        assertPlanetFieldName(name);
        validateMetadata(field);
        if (!Array.isArray(field.levels) || !field.levels.length || field.levels.length > 16)
            throw new Error("Invalid planet level count");
        if (field.levels[0].width !== manifest.masterWidth)
            throw new Error("Missing planet master level");
        const seen = new Set();
        for (const level of field.levels) {
            validateLevel(level, field, manifest);
            if (seen.has(level.width))
                throw new Error("Duplicate planet level");
            seen.add(level.width);
        }
    }
}
function validateFormat(manifest, allowFixture) {
    if (manifest.schemaVersion !== 1 || manifest.codec !== "planet-numeric-pages-v1"
        || manifest.coordinates !== "equirectangular-row-major-north-south" || manifest.pageBytes !== PLANET_PAGE_BYTES) {
        throw new Error("Unsupported planet artifact format");
    }
    const fixture = allowFixture && manifest.purpose === "codec-fixture";
    if (!fixture && (manifest.purpose !== "canonical" || manifest.masterWidth !== 8192 || manifest.masterHeight !== 4096)) {
        throw new Error("Canonical planet artifact required");
    }
}
/** Parse only a bounded manifest fetched under an authorized identity/version; hashes alone are not grants. */
export function parsePlanetManifest(bytes, allowFixture = false) {
    if (!(bytes instanceof Uint8Array) || bytes.length > PLANET_METADATA_BYTES)
        throw new Error("Planet manifest exceeds budget");
    const manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    validateFormat(manifest, allowFixture);
    assertPlanetIdentity(manifest.identity);
    if (!grid(manifest.masterWidth, manifest.masterHeight) || !hash(manifest.provenanceSha256)
        || !["rocky", "ocean", "temperate", "gas", "ice", "exotic"].includes(manifest.planetClass)) {
        throw new Error("Invalid planet manifest metadata");
    }
    validateFields(manifest);
    if (manifest.planetClass === "gas" && ("elevation" in manifest.fields || "biome" in manifest.fields)) {
        throw new Error("Gas has no land fields");
    }
    return manifest;
}
//# sourceMappingURL=manifest.js.map