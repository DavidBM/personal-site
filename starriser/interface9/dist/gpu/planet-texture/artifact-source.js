import { PLANET_PAGE_BYTES, assertPlanetIdentity, assertPlanetFieldName, } from "../../lib/planet-content/contracts.js";
import { iteratePlanetSurfaceFieldPages } from "./surface-fields.js";
function encodeNumericPage(values) {
    if (values instanceof Uint8Array)
        return values;
    const bytes = new Uint8Array(values.length * 4);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < values.length; i++)
        view.setFloat32(i * 4, values[i], true);
    return bytes;
}
function fieldMetadata(surface) {
    const entries = Object.entries(surface.fields).sort(([a], [b]) => a.localeCompare(b));
    if (!entries.length || entries.length > 16)
        throw new Error("Invalid planet field count");
    const fields = Object.create(null);
    for (const [name, field] of entries) {
        assertPlanetFieldName(name);
        if (surface.planetClass === "gas" && ["elevation", "biome"].includes(name))
            throw new Error("Gas has no land fields");
        fields[name] = field.kind === "scalar" ? { kind: "scalar", encoding: "f32le", units: field.units }
            : { kind: "category", encoding: "u8", labels: [...field.labels] };
    }
    return fields;
}
function artifactSource(master, options, purpose) {
    assertPlanetIdentity(options.identity);
    if (!/^[0-9a-f]{64}$/.test(options.generatorSha256))
        throw new Error("Invalid generator SHA-256");
    const width = master.surface.width;
    const widths = [width, ...new Set(options.derivedWidths ?? [])].filter((v, i, a) => a.indexOf(v) === i);
    for (const level of widths) {
        if (!Number.isSafeInteger(level) || level < 2 || level % 2 || level > width || width % level) {
            throw new Error("Invalid derived planet width");
        }
    }
    widths.sort((a, b) => b - a);
    const fields = fieldMetadata(master.surface);
    return {
        descriptor: { schemaVersion: 1, codec: "planet-numeric-pages-v1", purpose,
            identity: { ...options.identity }, coordinates: "equirectangular-row-major-north-south",
            masterWidth: width, masterHeight: master.surface.height, planetClass: master.surface.planetClass,
            pageBytes: PLANET_PAGE_BYTES },
        provenance: { generator: master.generator, generatorSha256: options.generatorSha256,
            params: structuredClone(master.params) },
        fields, widths,
        *pages(name, level) {
            if (!Object.prototype.hasOwnProperty.call(fields, name) || !widths.includes(level))
                throw new Error("Unknown artifact field/level");
            for (const values of iteratePlanetSurfaceFieldPages(master.surface, name, level))
                yield encodeNumericPage(values);
        },
    };
}
/** Pass the actual bakeCanonicalPlanetMaster result here, then stream it into the Node artifact writer. */
export function createCanonicalPlanetArtifactSource(master, options) {
    if (master.schemaVersion !== 1 || master.params.resolution !== 8192
        || master.surface.width !== 8192 || master.surface.height !== 4096)
        throw new Error("Canonical artifact requires an 8192x4096 master");
    return artifactSource(master, options, "canonical");
}
/** Explicit small-fixture seam. Its artifacts cannot be opened or published as canonical content. */
export function createPlanetCodecFixtureSource(master, options) {
    return artifactSource(master, options, "codec-fixture");
}
//# sourceMappingURL=artifact-source.js.map