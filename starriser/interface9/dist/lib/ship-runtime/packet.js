/** Binary director packet (`DRP1`). Commands are packed records; structured
 * tactic / journey / pressure / route payloads live in a length-prefixed blob.
 * The envelope is an ArrayBuffer for worker transfer; JSON is not the hot path. */
export const DIRECTOR_PACKET_MAGIC = 0x44525031;
export const DIRECTOR_PACKET_VERSION = 1;
export const DIRECTOR_PACKET_HEADER_BYTES = 64;
export const DIRECTOR_PACKET_COMMAND_BYTES = 64;
export const DIRECTOR_PACKET_MAX_BYTES = 512 * 1024;
export const DIRECTOR_LANE_NONE = 0xffffffff;
export const DIRECTOR_AUTHORITY = Object.freeze({ backend: 0, localShow: 1 });
export const DIRECTOR_STRATEGIES = Object.freeze(["pass", "pursue", "hold", "withdraw"]);
const FLAG_ROUTES = 1;
const FLAG_LANE = 2;
const FLAG_LOCAL_SHOW = 4;
const PRESENT = Object.freeze({
    fleet: 1,
    type: 2,
    cohort: 4,
    strategy: 8,
    attackClass: 16,
    attackType: 32,
    joined: 64,
    fire: 128,
    battle: 256,
    team: 512,
    battleCenter: 1024,
    admit: 2048,
    remaining: 4096,
    survivalFraction: 8192,
    tactic: 16384,
    journey: 32768,
    pressure: 65536,
});
function writeAsciiMagic(view) {
    view.setUint8(0, 0x44);
    view.setUint8(1, 0x52);
    view.setUint8(2, 0x50);
    view.setUint8(3, 0x31);
}
function readMagic(view) {
    return (view.getUint8(0) << 24) | (view.getUint8(1) << 16) | (view.getUint8(2) << 8) | view.getUint8(3);
}
function pad4(n) {
    return (n + 3) & ~3;
}
function utf8(text) {
    return new TextEncoder().encode(text);
}
function fromUtf8(bytes) {
    return new TextDecoder().decode(bytes);
}
function strategyCode(name) {
    if (name === undefined)
        return 0xff;
    const index = DIRECTOR_STRATEGIES.indexOf(name);
    if (index < 0)
        throw new Error("Invalid director strategy");
    return index;
}
function strategyName(code) {
    if (code === 0xff)
        return undefined;
    const name = DIRECTOR_STRATEGIES[code];
    if (!name)
        throw new Error("Invalid director strategy");
    return name;
}
function pushBlob(parts, value) {
    if (value === undefined)
        return { off: 0, len: 0 };
    const encoded = utf8(JSON.stringify(value));
    const off = parts.reduce((sum, item) => sum + item.byteLength, 0);
    parts.push(encoded);
    return { off, len: encoded.byteLength };
}
function sliceBlob(blob, off, len) {
    if (len === 0)
        return undefined;
    return JSON.parse(fromUtf8(blob.subarray(off, off + len)));
}
function requireClock(packet) {
    if (!Number.isSafeInteger(packet.sequence) || packet.sequence < 1)
        throw new Error("Invalid director sequence");
    if (!Number.isFinite(packet.effectiveAt) || packet.effectiveAt < 0)
        throw new Error("Invalid director clock");
}
function requireIdentity(packet) {
    if (typeof packet.id !== "string" || packet.id.length < 1 || packet.id.length > 128)
        throw new Error("Invalid director identity");
    if (packet.label !== undefined && (typeof packet.label !== "string" || packet.label.length > 256)) {
        throw new Error("Invalid director label");
    }
}
function requireList(value, max, label) {
    if (!Array.isArray(value ?? []) || (value?.length ?? 0) > max)
        throw new Error(`Invalid director ${label}`);
}
function validatePacket(packet) {
    requireClock(packet);
    requireIdentity(packet);
    requireList(packet.commands, 520, "commands");
    requireList(packet.routes, 512, "routes");
}
const PRESENT_FIELDS = [
    ["type", PRESENT.type], ["cohort", PRESENT.cohort], ["strategy", PRESENT.strategy],
    ["attackClass", PRESENT.attackClass], ["attackType", PRESENT.attackType],
    ["joined", PRESENT.joined], ["fire", PRESENT.fire], ["battle", PRESENT.battle],
    ["team", PRESENT.team], ["battleCenter", PRESENT.battleCenter], ["admit", PRESENT.admit],
    ["remaining", PRESENT.remaining], ["survivalFraction", PRESENT.survivalFraction],
    ["tactic", PRESENT.tactic], ["journey", PRESENT.journey], ["pressure", PRESENT.pressure],
];
function presentMask(command) {
    let present = PRESENT.fleet;
    for (const [key, bit] of PRESENT_FIELDS)
        if (command[key] !== undefined)
            present |= bit;
    return present;
}
function absentByte(value) {
    return value === undefined ? 0xff : value;
}
function writeCommand(view, at, record) {
    const command = record.command;
    view.setUint32(at, presentMask(command), true);
    view.setUint8(at + 4, command.fleet);
    view.setUint8(at + 5, absentByte(command.type));
    view.setUint8(at + 6, absentByte(command.cohort));
    view.setUint8(at + 7, strategyCode(command.strategy));
    view.setUint8(at + 8, absentByte(command.attackClass));
    view.setUint8(at + 9, absentByte(command.attackType));
    view.setUint8(at + 10, command.joined === undefined ? 0xff : Number(command.joined));
    view.setUint8(at + 11, command.fire === undefined ? 0xff : Number(command.fire));
    view.setUint8(at + 12, absentByte(command.admit));
    writeCommandTail(view, at, record);
}
function writeCommandTail(view, at, record) {
    const command = record.command, center = command.battleCenter;
    view.setUint32(at + 16, command.battle ?? 0, true);
    view.setUint32(at + 20, command.team ?? 0, true);
    view.setUint32(at + 24, command.remaining ?? 0, true);
    view.setFloat32(at + 28, command.survivalFraction ?? Number.NaN, true);
    view.setFloat32(at + 32, center ? center[0] : Number.NaN, true);
    view.setFloat32(at + 36, center ? center[1] : Number.NaN, true);
    view.setFloat32(at + 40, center ? center[2] : Number.NaN, true);
    view.setUint16(at + 44, record.tactic.off, true);
    view.setUint16(at + 46, record.tactic.len, true);
    view.setUint16(at + 48, record.journey.off, true);
    view.setUint16(at + 50, record.journey.len, true);
    view.setUint16(at + 52, record.pressure.off, true);
    view.setUint16(at + 54, record.pressure.len, true);
}
function assembleBlob(commands, routes) {
    const blobParts = [];
    const records = commands.map((command) => ({
        command,
        tactic: pushBlob(blobParts, command.tactic),
        journey: pushBlob(blobParts, command.journey),
        pressure: pushBlob(blobParts, command.pressure),
    }));
    const commandBlobBytes = blobParts.reduce((sum, part) => sum + part.byteLength, 0);
    const routeChunks = routes.map((route) => utf8(JSON.stringify(route)));
    const blob = new Uint8Array(commandBlobBytes + routeChunks.reduce((sum, chunk) => sum + 4 + chunk.byteLength, 0));
    let cursor = 0;
    for (const part of blobParts) {
        blob.set(part, cursor);
        cursor += part.byteLength;
    }
    const routeView = new DataView(blob.buffer);
    for (const chunk of routeChunks) {
        routeView.setUint32(cursor, chunk.byteLength, true);
        cursor += 4;
        blob.set(chunk, cursor);
        cursor += chunk.byteLength;
    }
    return { blob, records, commandBlobBytes };
}
function writeHeader(view, packet, idBytes, labelBytes, blob, commandBlobBytes) {
    writeAsciiMagic(view);
    const routes = packet.routes ?? [];
    let flags = 0;
    if (routes.length)
        flags |= FLAG_ROUTES;
    if (packet.lane !== undefined)
        flags |= FLAG_LANE;
    const authority = packet.authority ?? DIRECTOR_AUTHORITY.backend;
    if (authority === DIRECTOR_AUTHORITY.localShow)
        flags |= FLAG_LOCAL_SHOW;
    view.setUint16(4, DIRECTOR_PACKET_VERSION, true);
    view.setUint16(6, flags, true);
    view.setUint32(8, packet.sequence, true);
    view.setUint32(12, (packet.commands ?? []).length, true);
    view.setUint32(16, routes.length, true);
    view.setUint32(20, idBytes.byteLength, true);
    view.setUint32(24, labelBytes.byteLength, true);
    view.setUint32(28, blob.byteLength, true);
    view.setFloat64(32, packet.effectiveAt, true);
    view.setUint32(40, packet.lane === undefined ? DIRECTOR_LANE_NONE : packet.lane, true);
    view.setUint32(44, packet.revision ?? 0, true);
    view.setUint32(48, authority, true);
    view.setUint32(52, commandBlobBytes, true);
}
export function encodeLocalShowAttack(options = {}) {
    const attacker = options.attacker ?? 0;
    const target = options.target ?? 1;
    if (attacker === target)
        throw new Error("local-show Attack needs two fleets");
    return encodeDirectorPacket({
        id: options.id ?? "local-show-attack",
        sequence: options.sequence ?? 1,
        effectiveAt: options.effectiveAt ?? 0,
        authority: DIRECTOR_AUTHORITY.localShow,
        commands: [
            { fleet: attacker, joined: true, fire: true, battle: options.battle ?? 1, team: 0, strategy: "pursue", attackClass: 5 },
            { fleet: target, joined: true, fire: true, battle: options.battle ?? 1, team: 1, strategy: "pass" },
        ],
    });
}
export function encodeDirectorPacket(packet) {
    validatePacket(packet);
    const commands = packet.commands ?? [];
    const routes = packet.routes ?? [];
    const idBytes = utf8(packet.id);
    const labelBytes = packet.label ? utf8(packet.label) : new Uint8Array(0);
    const assembled = assembleBlob(commands, routes);
    const idPad = pad4(idBytes.byteLength);
    const labelPad = pad4(labelBytes.byteLength);
    const size = DIRECTOR_PACKET_HEADER_BYTES + commands.length * DIRECTOR_PACKET_COMMAND_BYTES + idPad + labelPad + assembled.blob.byteLength;
    if (size > DIRECTOR_PACKET_MAX_BYTES)
        throw new Error("Director packet exceeds byte limit");
    const buffer = new ArrayBuffer(size);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    writeHeader(view, packet, idBytes, labelBytes, assembled.blob, assembled.commandBlobBytes);
    assembled.records.forEach((record, index) => writeCommand(view, DIRECTOR_PACKET_HEADER_BYTES + index * DIRECTOR_PACKET_COMMAND_BYTES, record));
    let offset = DIRECTOR_PACKET_HEADER_BYTES + commands.length * DIRECTOR_PACKET_COMMAND_BYTES;
    bytes.set(idBytes, offset);
    offset += idPad;
    bytes.set(labelBytes, offset);
    offset += labelPad;
    bytes.set(assembled.blob, offset);
    return buffer;
}
function readCommand(view, at, blob) {
    const present = view.getUint32(at, true);
    const command = { fleet: view.getUint8(at + 4) };
    readCommandScalars(view, at, present, command);
    readCommandObjects(view, at, present, blob, command);
    return command;
}
function readCommandScalars(view, at, present, command) {
    if (present & PRESENT.type)
        command.type = view.getUint8(at + 5);
    if (present & PRESENT.cohort)
        command.cohort = view.getUint8(at + 6);
    if (present & PRESENT.strategy)
        command.strategy = strategyName(view.getUint8(at + 7));
    if (present & PRESENT.attackClass)
        command.attackClass = view.getUint8(at + 8);
    if (present & PRESENT.attackType)
        command.attackType = view.getUint8(at + 9);
    if (present & PRESENT.joined)
        command.joined = Boolean(view.getUint8(at + 10));
    if (present & PRESENT.fire)
        command.fire = Boolean(view.getUint8(at + 11));
    if (present & PRESENT.admit)
        command.admit = view.getUint8(at + 12);
}
function readCommandObjects(view, at, present, blob, command) {
    if (present & PRESENT.battle)
        command.battle = view.getUint32(at + 16, true);
    if (present & PRESENT.team)
        command.team = view.getUint32(at + 20, true);
    if (present & PRESENT.remaining)
        command.remaining = view.getUint32(at + 24, true);
    if (present & PRESENT.survivalFraction)
        command.survivalFraction = view.getFloat32(at + 28, true);
    if (present & PRESENT.battleCenter) {
        const x = view.getFloat32(at + 32, true), y = view.getFloat32(at + 36, true), z = view.getFloat32(at + 40, true);
        command.battleCenter = Number.isFinite(x) ? [x, y, z] : null;
    }
    if (present & PRESENT.tactic)
        command.tactic = sliceBlob(blob, view.getUint16(at + 44, true), view.getUint16(at + 46, true));
    if (present & PRESENT.journey)
        command.journey = sliceBlob(blob, view.getUint16(at + 48, true), view.getUint16(at + 50, true));
    if (present & PRESENT.pressure)
        command.pressure = sliceBlob(blob, view.getUint16(at + 52, true), view.getUint16(at + 54, true));
}
function readRoutes(view, blob, flags, routeCount) {
    if (!(flags & FLAG_ROUTES))
        return [];
    const routes = [];
    let blobOff = view.getUint32(52, true);
    for (let i = 0; i < routeCount; i++) {
        if (blobOff + 4 > blob.byteLength)
            throw new Error("Director route blob truncated");
        const len = new DataView(blob.buffer, blob.byteOffset + blobOff, 4).getUint32(0, true);
        blobOff += 4;
        if (blobOff + len > blob.byteLength)
            throw new Error("Director route blob truncated");
        routes.push(JSON.parse(fromUtf8(blob.subarray(blobOff, blobOff + len))));
        blobOff += len;
    }
    return routes;
}
export function decodeDirectorPacket(buffer) {
    if (buffer.byteLength < DIRECTOR_PACKET_HEADER_BYTES || buffer.byteLength > DIRECTOR_PACKET_MAX_BYTES) {
        throw new Error("Invalid director packet size");
    }
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    if (readMagic(view) !== DIRECTOR_PACKET_MAGIC)
        throw new Error("Invalid director packet magic");
    if (view.getUint16(4, true) !== DIRECTOR_PACKET_VERSION)
        throw new Error("Unsupported director packet version");
    const flags = view.getUint16(6, true);
    const commandCount = view.getUint32(12, true);
    const idSize = view.getUint32(20, true);
    const labelSize = view.getUint32(24, true);
    const blobSize = view.getUint32(28, true);
    const commandBytes = commandCount * DIRECTOR_PACKET_COMMAND_BYTES;
    const expected = DIRECTOR_PACKET_HEADER_BYTES + commandBytes + pad4(idSize) + pad4(labelSize) + blobSize;
    if (expected !== buffer.byteLength)
        throw new Error("Director packet size does not match header");
    let offset = DIRECTOR_PACKET_HEADER_BYTES + commandBytes;
    const id = fromUtf8(bytes.subarray(offset, offset + idSize));
    offset += pad4(idSize);
    const label = labelSize ? fromUtf8(bytes.subarray(offset, offset + labelSize)) : undefined;
    offset += pad4(labelSize);
    const blob = bytes.subarray(offset, offset + blobSize);
    const commands = Array.from({ length: commandCount }, (_, i) => readCommand(view, DIRECTOR_PACKET_HEADER_BYTES + i * DIRECTOR_PACKET_COMMAND_BYTES, blob));
    const packet = {
        id,
        sequence: view.getUint32(8, true),
        effectiveAt: view.getFloat64(32, true),
        commands,
        authority: view.getUint32(48, true),
    };
    if (label)
        packet.label = label;
    applyLane(packet, view, flags);
    const routes = readRoutes(view, blob, flags, view.getUint32(16, true));
    if (routes.length)
        packet.routes = routes;
    return packet;
}
function applyLane(packet, view, flags) {
    const lane = view.getUint32(40, true);
    if ((flags & FLAG_LANE) && lane !== DIRECTOR_LANE_NONE) {
        packet.lane = lane;
        packet.revision = view.getUint32(44, true);
    }
}
export function directorPacketFingerprint(buffer) {
    const bytes = new Uint8Array(buffer);
    let hash = 2166136261;
    for (let i = 0; i < bytes.length; i++) {
        hash ^= bytes[i];
        hash = Math.imul(hash, 16777619);
    }
    return `${bytes.length}:${hash >>> 0}`;
}
//# sourceMappingURL=packet.js.map