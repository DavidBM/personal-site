/** Immutable numeric content. A hash verifies bytes, never permission to read them. */
export const PLANET_PAGE_BYTES = 4096;
export const PLANET_HASH_BYTES = 32;
export const PLANET_INDEX_FANOUT = PLANET_PAGE_BYTES / PLANET_HASH_BYTES;
export const PLANET_METADATA_BYTES = 65536;
export const PLANET_LEAF_DOMAIN = 0;
export const PLANET_INDEX_DOMAIN = 1;
export function assertPlanetIdentity(identity) {
    for (const key of ["worldId", "systemId", "bodyId"]) {
        if (!/^[0-9a-f]{32}$/.test(identity[key]) || /^0+$/.test(identity[key]))
            throw new Error(`Invalid opaque ${key}`);
    }
    if (!Number.isSafeInteger(identity.profileVersion) || identity.profileVersion < 1) {
        throw new Error("Invalid planet profile version");
    }
}
export function assertPlanetFieldName(name) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name))
        throw new Error("Invalid planet field name");
}
export function bytesPerCell(field) { return field.encoding === "f32le" ? 4 : 1; }
/** Each level holds hashes of the preceding data/index pages; the root hashes the final page. */
export function planetIndexLayout(pageCount) {
    if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 32768)
        throw new Error("Invalid planet page count");
    const levels = [];
    let count = pageCount, offset = 0;
    for (;;) {
        const byteLength = count * PLANET_HASH_BYTES;
        levels.push({ offset, byteLength });
        if (byteLength <= PLANET_PAGE_BYTES)
            return levels;
        offset += byteLength;
        count = Math.ceil(byteLength / PLANET_PAGE_BYTES);
    }
}
//# sourceMappingURL=contracts.js.map