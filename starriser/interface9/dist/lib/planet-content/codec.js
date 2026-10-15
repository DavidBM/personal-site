import { PLANET_PAGE_BYTES, PLANET_INDEX_FANOUT, PLANET_LEAF_DOMAIN, PLANET_INDEX_DOMAIN, bytesPerCell, planetIndexLayout, } from "./contracts.js";
export async function planetPageHash(bytes, domain) {
    if (domain !== PLANET_LEAF_DOMAIN && domain !== PLANET_INDEX_DOMAIN)
        throw new Error("Invalid planet hash domain");
    if (!bytes.length || bytes.length > PLANET_PAGE_BYTES)
        throw new Error("Invalid planet page length");
    const input = new Uint8Array(bytes.length + 1);
    input[0] = domain;
    input.set(bytes, 1);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
    return hashHex(digest);
}
function hashHex(bytes) {
    return Array.from(bytes, n => n.toString(16).padStart(2, "0")).join("");
}
async function checkedRange(read, kind, offset, length, expected) {
    const bytes = await read(kind, offset, length);
    if (!(bytes instanceof Uint8Array) || bytes.length !== length)
        throw new Error("Truncated planet range");
    const actual = await planetPageHash(bytes, kind === "data" ? PLANET_LEAF_DOMAIN : PLANET_INDEX_DOMAIN);
    if (actual !== expected)
        throw new Error("Planet page integrity mismatch");
    return bytes;
}
/** Root must come from an authenticated, identity-bound manifest; this does not grant access. */
export async function readVerifiedPlanetPage(level, page, read) {
    if (!Number.isSafeInteger(page) || page < 0 || page >= level.pageCount)
        throw new Error("Invalid planet page index");
    if (level.pageCount !== Math.ceil(level.byteLength / PLANET_PAGE_BYTES))
        throw new Error("Invalid planet byte length");
    const layout = planetIndexLayout(level.pageCount);
    let expected = level.root;
    for (let index = layout.length - 1; index >= 0; index--) {
        const entry = layout[index];
        const digestIndex = Math.floor(page / PLANET_INDEX_FANOUT ** index);
        const offset = Math.floor(digestIndex / PLANET_INDEX_FANOUT) * PLANET_PAGE_BYTES;
        const bytes = await checkedRange(read, "index", entry.offset + offset, Math.min(PLANET_PAGE_BYTES, entry.byteLength - offset), expected);
        const slot = digestIndex % PLANET_INDEX_FANOUT * 32;
        expected = hashHex(bytes.subarray(slot, slot + 32));
    }
    const offset = page * PLANET_PAGE_BYTES;
    return checkedRange(read, "data", offset, Math.min(PLANET_PAGE_BYTES, level.byteLength - offset), expected);
}
/** One page only; callers own accumulation/eviction. Scalars preserve Float32 values, including -0. */
export function decodePlanetPage(bytes, field) {
    if (!bytes.length || bytes.length > PLANET_PAGE_BYTES || bytes.length % bytesPerCell(field)) {
        throw new Error("Invalid encoded planet page");
    }
    if (field.kind === "category") {
        for (const id of bytes)
            if (id >= field.labels.length)
                throw new Error("Unknown planet category");
        return bytes.slice();
    }
    const values = new Float32Array(bytes.length / 4);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < values.length; i++) {
        const value = view.getFloat32(i * 4, true);
        if (!Number.isFinite(value))
            throw new Error("Non-finite planet scalar");
        values[i] = value;
    }
    return values;
}
//# sourceMappingURL=codec.js.map