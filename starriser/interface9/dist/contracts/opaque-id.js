/** Local identity adapter; domain IDs remain opaque 128-bit values. */
const hex = Array.from({ length: 256 }, (_, value) => value.toString(16).padStart(2, "0"));
export function isOpaqueId(value) {
    return /^[0-9a-f]{32}$/.test(value) && value !== "00000000000000000000000000000000";
}
export function opaqueIdAt(bytes, offset = 0) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + 16 > bytes.length)
        throw new Error("Invalid identity column");
    let result = "";
    let nonzero = 0;
    for (let i = offset; i < offset + 16; i++) {
        const value = bytes[i];
        result += hex[value];
        nonzero |= value;
    }
    if (!nonzero)
        throw new Error("Zero identity is reserved");
    return result;
}
export function opaqueIdBytes(value) {
    if (!isOpaqueId(value))
        throw new Error("Invalid opaque identity");
    const result = new Uint8Array(16);
    for (let i = 0; i < 16; i++)
        result[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
    return result;
}
//# sourceMappingURL=opaque-id.js.map