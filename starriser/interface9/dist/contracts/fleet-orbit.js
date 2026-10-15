/** Fixed accepted orbit record. Native authority owns its geometry and epoch. */
export const ORBIT_RECORD_BYTES = 122;
export function readFleetOrbit(bytes) {
    if (!bytes.length)
        return;
    if (!validHeader(bytes))
        throw new Error('Invalid accepted orbit');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const epochMs = view.getBigUint64(2), periodMs = view.getBigUint64(10), radius = view.getFloat64(18);
    const body = new Float64Array(12);
    for (let i = 0; i < 12; i++)
        body[i] = view.getFloat64(26 + i * 8);
    const phase = readPhase(bytes[0], body);
    if (!validGeometry(periodMs, radius, body))
        throw new Error('Invalid orbit geometry');
    return { bodyIndex: bytes[1], epochMs, periodMs, radius, phase, body, record: bytes.slice() };
}
function validHeader(bytes) {
    return bytes.length === ORBIT_RECORD_BYTES && (bytes[0] === 1 || bytes[0] === 2) && bytes[1] >= 1 && bytes[1] <= 15;
}
function readPhase(version, body) {
    if (version === 1)
        return;
    const phase = body[11];
    if (!Number.isFinite(phase) || phase < 0 || phase >= Math.PI * 2)
        throw new Error('Invalid orbit phase');
    body[11] = 0;
    return phase;
}
function validGeometry(period, radius, body) {
    return period > 0n && Number.isFinite(radius) && radius > body[1] && radius <= 100 && body.every(Number.isFinite) && body[2] > 0;
}
export function packFleetOrbits(rows) {
    const orbitOffsets = new Uint32Array(rows.length + 1);
    for (let i = 0; i < rows.length; i++) {
        const length = rows[i]?.length ?? 0;
        if (length !== 0 && length !== ORBIT_RECORD_BYTES)
            throw new Error('Invalid orbit size');
        orbitOffsets[i + 1] = orbitOffsets[i] + length;
    }
    const orbitBytes = new Uint8Array(orbitOffsets[rows.length]);
    for (let i = 0; i < rows.length; i++)
        if (rows[i]?.length)
            orbitBytes.set(rows[i], orbitOffsets[i]);
    return { orbitOffsets, orbitBytes };
}
export function orbitBuffers(count, offsets, bytes) {
    if (!(offsets instanceof Uint32Array) || !(bytes instanceof Uint8Array) || offsets.length !== count + 1 || offsets[0] !== 0 || offsets[count] !== bytes.length)
        throw new Error('Invalid orbit columns');
    if (!(offsets.buffer instanceof ArrayBuffer) || !(bytes.buffer instanceof ArrayBuffer))
        throw new Error('Invalid orbit storage');
    for (let i = 0; i < count; i++) {
        const n = offsets[i + 1] - offsets[i];
        if (n !== 0 && n !== ORBIT_RECORD_BYTES)
            throw new Error('Invalid orbit offset');
    }
    return [offsets.buffer, bytes.buffer];
}
//# sourceMappingURL=fleet-orbit.js.map