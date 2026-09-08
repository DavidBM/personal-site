import { check, id, present, scope } from './validate-fields.js';
function u64(value, positive) {
    check(value >= (positive ? 1n : 0n) && value <= 0xffffffffffffffffn, 'strategic version/time');
}
function unique(ids) {
    check(ids.length <= 32, 'strategic system limit');
    const seen = new Set();
    for (const bytes of ids) {
        id(bytes);
        const key = bytes.join(',');
        check(!seen.has(key), 'duplicate strategic system');
        seen.add(key);
    }
}
export function validateSubscribeStrategic(value) {
    id(value.worldId);
    id(value.subscriptionId);
    u64(value.interestGeneration, true);
    check(Number.isInteger(value.requestedEncoding) && value.requestedEncoding >= 0 && value.requestedEncoding <= 0x7fffffff, 'strategic encoding');
    unique(value.systemIds);
}
function row(value, world) {
    scope(value.scope);
    const authority = present(value.scope, 'summary authority');
    check(authority.worldId.every((byte, index) => byte === world[index]), 'summary world');
    u64(authority.ownerEpoch, true);
    u64(authority.recoveryGeneration, true);
    counts(value.availability, value.counts);
}
function counts(availability, value) {
    if (availability === 2) {
        check(value === undefined, 'unavailable counts');
        return;
    }
    check(availability === 1, 'summary availability');
    const item = present(value, 'available counts');
    u64(item.systemRevision, true);
    u64(item.committedServerTimeMs, false);
    check(Number.isInteger(item.presentShips) && Number.isInteger(item.movingShips), 'summary integer counts');
    check(item.movingShips >= 0 && item.movingShips <= item.presentShips && item.presentShips <= 16384, 'summary counts');
}
function compact(view) {
    check(view.groups.length <= 32, 'strategic group limit');
    const seen = new Set();
    for (const group of view.groups) {
        id(group.shardId);
        u64(group.ownerEpoch, true);
        u64(group.recoveryGeneration, true);
        check(group.systems.length > 0 && group.systems.length <= 32, 'strategic group rows');
        for (const item of group.systems) {
            id(item.systemId);
            const key = item.systemId.join(',');
            check(!seen.has(key), 'duplicate strategic system');
            seen.add(key);
            check(seen.size <= 32, 'strategic system limit');
            counts(item.availability, item.counts);
        }
    }
}
export function validateStrategicSystems(value) {
    id(value.worldId);
    id(value.subscriptionId);
    u64(value.interestGeneration, true);
    u64(value.sequence, true);
    if (value.result.case === 'rejected') {
        const reason = value.result.value.reason;
        check(Number.isInteger(reason) && reason > 0 && reason <= 0x7fffffff, 'strategic rejection');
        return;
    }
    if (value.result.case === 'compactView') {
        compact(value.result.value);
        return;
    }
    check(value.result.case === 'view', 'strategic result');
    const rows = value.result.value.systems;
    unique(rows.map(item => present(item.scope, 'summary authority').systemId));
    for (const item of rows)
        row(item, value.worldId);
}
//# sourceMappingURL=validate-strategic.js.map