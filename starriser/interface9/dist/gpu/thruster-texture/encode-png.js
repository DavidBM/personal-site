/**
 * Minimal pure PNG encoder (RGBA8, filter None, zlib stored blocks).
 * No npm deps — Node tests and browser export share this path.
 */
const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
// CRC32 table (ISO 3309 / PNG)
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        t[n] = c >>> 0;
    }
    return t;
})();
function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}
function u32be(n) {
    return new Uint8Array([
        (n >>> 24) & 0xff,
        (n >>> 16) & 0xff,
        (n >>> 8) & 0xff,
        n & 0xff,
    ]);
}
function concat(parts) {
    let len = 0;
    for (const p of parts)
        len += p.length;
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of parts) {
        out.set(p, o);
        o += p.length;
    }
    return out;
}
function chunk(type, data) {
    const typeBytes = new Uint8Array(4);
    for (let i = 0; i < 4; i++)
        typeBytes[i] = type.charCodeAt(i);
    const len = u32be(data.length);
    const crcIn = concat([typeBytes, data]);
    const crc = u32be(crc32(crcIn));
    return concat([len, typeBytes, data, crc]);
}
/** Adler-32 of uncompressed image data (zlib). */
function adler32(data) {
    let a = 1;
    let b = 0;
    const MOD = 65521;
    for (let i = 0; i < data.length; i++) {
        a = (a + data[i]) % MOD;
        b = (b + a) % MOD;
    }
    return ((b << 16) | a) >>> 0;
}
/**
 * Build zlib stream with stored (uncompressed) blocks only.
 * Max stored block payload is 65535 bytes.
 */
function zlibStore(raw) {
    const parts = [];
    // CMF/FLG: deflate, 32K window, no dict, check bits for 0x78 0x01
    parts.push(new Uint8Array([0x78, 0x01]));
    let offset = 0;
    while (offset < raw.length) {
        const remaining = raw.length - offset;
        const take = Math.min(65535, remaining);
        const isFinal = offset + take >= raw.length ? 1 : 0;
        const header = new Uint8Array(5);
        header[0] = isFinal; // BFINAL=1 or 0, BTYPE=00
        header[1] = take & 0xff;
        header[2] = (take >>> 8) & 0xff;
        const nlen = (~take) & 0xffff;
        header[3] = nlen & 0xff;
        header[4] = (nlen >>> 8) & 0xff;
        parts.push(header);
        parts.push(raw.subarray(offset, offset + take));
        offset += take;
    }
    if (raw.length === 0) {
        // Empty stored final block
        parts.push(new Uint8Array([0x01, 0x00, 0x00, 0xff, 0xff]));
    }
    parts.push(u32be(adler32(raw)));
    return concat(parts);
}
/** Scanlines with filter byte 0 (None) before each row. */
function filterNoneRgba(width, height, rgba) {
    const stride = width * 4;
    const out = new Uint8Array(height * (1 + stride));
    let o = 0;
    for (let y = 0; y < height; y++) {
        out[o++] = 0; // filter None
        const src = y * stride;
        out.set(rgba.subarray(src, src + stride), o);
        o += stride;
    }
    return out;
}
/**
 * Encode RGBA8 buffer to a complete PNG file (Uint8Array).
 * Signature starts with 89 50 4E 47 (standard PNG magic).
 */
export function encodePngRgba(buf) {
    const { width, height, rgba } = buf;
    if (rgba.length < width * height * 4) {
        throw new Error("encodePngRgba: rgba buffer too short");
    }
    const ihdr = new Uint8Array(13);
    ihdr.set(u32be(width), 0);
    ihdr.set(u32be(height), 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // color type RGBA
    ihdr[10] = 0; // compression
    ihdr[11] = 0; // filter
    ihdr[12] = 0; // interlace
    const raw = filterNoneRgba(width, height, rgba);
    const z = zlibStore(raw);
    return concat([
        PNG_SIG,
        chunk("IHDR", ihdr),
        chunk("IDAT", z),
        chunk("IEND", new Uint8Array(0)),
    ]);
}
/** True if bytes look like a PNG (magic 89 50 4E 47 0D 0A 1A 0A). */
export function isPngMagic(bytes) {
    if (bytes.length < 8)
        return false;
    for (let i = 0; i < 8; i++) {
        if (bytes[i] !== PNG_SIG[i])
            return false;
    }
    return true;
}
/** PNG magic as hex string for tests/logs. */
export const PNG_MAGIC_HEX = "89 50 4E 47 0D 0A 1A 0A";
//# sourceMappingURL=encode-png.js.map