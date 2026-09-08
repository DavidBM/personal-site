import { copyWatermark, sameScope } from '../render/remote/projection-state.js';
import { MAX_SNAPSHOT_ENTITIES } from '../render/remote/contracts.js';
import { opaqueIdAt, opaqueIdBytes } from '../contracts/opaque-id.js';
import { MAX_RULE_SEED_SHIPS } from '../features/fleets/domain/contracts.js';
function row(ship) {
    const move = ship.movement;
    const base = { id: opaqueIdAt(ship.shipId), revision: ship.revision, x: ship.position.x, z: ship.position.z };
    if (!move)
        return { ...base, targetX: base.x, targetZ: base.z, moving: false, departureMs: 0n, arrivalMs: 0n, transferReadyMs: ship.transferReadyServerMs };
    const orderId = opaqueIdAt(move.orderId);
    opaqueIdBytes(orderId);
    return { ...base, targetX: move.to.x, targetZ: move.to.z, moving: true, orderId,
        departureMs: move.departureServerMs, arrivalMs: move.arrivalServerMs, transferReadyMs: ship.transferReadyServerMs };
}
function change(rows, ships, removed) {
    for (const id of removed)
        rows.delete(opaqueIdAt(id));
    for (const ship of ships) {
        if (ship.controllable)
            rows.set(opaqueIdAt(ship.shipId), row(ship));
        else
            rows.delete(opaqueIdAt(ship.shipId));
        if (rows.size > MAX_SNAPSHOT_ENTITIES)
            throw new Error('Owned projection entity budget exceeded');
    }
}
function requireTime(value) {
    if (value === undefined)
        throw new Error('Owned rule seed needs authoritative committed time');
    return value;
}
function sameWatermark(a, b) {
    return sameScope(a.scope, b.scope) && a.subscriptionId === b.subscriptionId && a.streamGeneration === b.streamGeneration
        && a.sequence === b.sequence && a.systemRevision === b.systemRevision;
}
/** Explicit extra observer cache for UI/rule seeds. It owns only controllable
 * rows, never render buffers or generated DTOs. At most 16K current +16K staged
 * rows; callers pull ≤256 rows and cannot merge pages across a revision. */
export function createOwnedProjection(connectionGeneration, playerId) {
    let current;
    let staged;
    return {
        snapshot(value, watermark) {
            const time = requireTime(value.committedTimeMs);
            if (value.chunkIndex === 0)
                staged = { rows: new Map(), watermark: copyWatermark(watermark), committedTimeMs: time };
            if (!staged || staged.committedTimeMs !== time)
                throw new Error('Owned snapshot metadata changed');
            change(staged.rows, value.ships, []);
            if (value.chunkIndex + 1 === value.chunkCount) {
                current = staged;
                staged = undefined;
            }
        },
        delta(value, watermark) {
            const time = requireTime(value.committedTimeMs);
            if (!current || staged || time < current.committedTimeMs)
                throw new Error('Owned delta has no valid current baseline');
            change(current.rows, value.upserts, value.removedShipIds);
            current.watermark = copyWatermark(watermark);
            current.committedTimeMs = time;
        },
        page(query, serverNowMs) {
            if (!current || staged)
                throw new Error('Owned ships need a complete current snapshot');
            const required = query.required;
            if (required && (required.connectionGeneration !== connectionGeneration || !sameWatermark(required.watermark, current.watermark))) {
                throw new Error('Owned ship page belongs to a different projection revision');
            }
            const { rows, nextOffset } = select(current.rows, query);
            const seed = pack(rows, current, connectionGeneration, playerId);
            return { seed, ships: rows.map(({ id, revision, x, z, targetX, targetZ, moving }) => ({ id, revision, x, z, targetX, targetZ, moving })),
                nextOffset, total: current.rows.size, serverNowMs };
        },
        dispose() { current = undefined; staged = undefined; },
        inspect: () => ({ currentRows: current?.rows.size ?? 0, stagedRows: staged?.rows.size ?? 0 }),
    };
}
function select(all, query) {
    if (query.shipId) {
        const ship = all.get(query.shipId);
        if (!ship)
            throw new Error('Ship is outside the owned projection');
        return { rows: [ship], nextOffset: null };
    }
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 64;
    pageBounds(offset, limit, all.size);
    if (offset > 0 && !query.required)
        throw new Error('Later owned pages require the original revision');
    const rows = pageRows(all, offset, limit);
    const next = offset + rows.length;
    return { rows, nextOffset: next < all.size ? next : null };
}
function pageRows(all, offset, limit) {
    const rows = [];
    let index = 0;
    for (const ship of all.values()) {
        if (index++ < offset)
            continue;
        rows.push(ship);
        if (rows.length === limit)
            break;
    }
    return rows;
}
function pageBounds(offset, limit, total) {
    if (!Number.isInteger(offset) || offset < 0 || offset > total || !Number.isInteger(limit) || limit < 1 || limit > MAX_RULE_SEED_SHIPS) {
        throw new Error('Owned ship page budget exceeded');
    }
}
function pack(rows, state, generation, playerId) {
    const n = rows.length;
    const bytes = new ArrayBuffer(n * 112);
    const identities = new Uint8Array(bytes, 0, n * 48);
    const revisions = new BigUint64Array(bytes, n * 48, n);
    const positions = new Float64Array(bytes, n * 56, n * 4);
    const times = new BigUint64Array(bytes, n * 88, n * 3);
    const owner = opaqueIdBytes(playerId);
    rows.forEach((ship, i) => {
        identities.set(opaqueIdBytes(ship.id), i * 48);
        identities.set(owner, i * 48 + 16);
        if (ship.orderId)
            identities.set(opaqueIdBytes(ship.orderId), i * 48 + 32);
        revisions[i] = ship.revision;
        // Rust's scalar ABI uses zero order/target/deadline columns for idle ships.
        positions.set([ship.x, ship.z, ship.moving ? ship.targetX : 0, ship.moving ? ship.targetZ : 0], i * 4);
        times.set([ship.departureMs, ship.arrivalMs, ship.transferReadyMs], i * 3);
    });
    return { token: { connectionGeneration: generation, watermark: copyWatermark(state.watermark) }, playerId,
        ruleVersion: 1, committedTimeMs: state.committedTimeMs, identities, revisions, positions, times };
}
//# sourceMappingURL=owned-projection.js.map