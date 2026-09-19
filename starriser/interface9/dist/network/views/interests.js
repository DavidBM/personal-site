/** Reconnect carries intent only. Every restored selector needs fresh authorization. */
import { isOpaqueId } from '../../contracts/opaque-id.js';
function copySelection(source) {
    const result = {};
    for (const slot of names) {
        const value = source[slot];
        if (value !== undefined)
            result[slot] = value === null ? null : normalizedSelector(value);
    }
    return result;
}
const names = ['overview', 'owned', 'detail'];
export function normalizedSelector(value) {
    if (value.kind === 'owned')
        return { kind: 'owned' };
    if (value.kind === 'detail') {
        if (!isOpaqueId(value.systemId))
            throw new Error('Invalid detail identity');
        return { kind: 'detail', systemId: value.systemId };
    }
    if (value.scope.kind === 'galaxy')
        return { kind: 'overview', scope: { kind: 'galaxy' } };
    if (value.scope.ids.length > 4096 || !value.scope.ids.every(isOpaqueId))
        throw new Error('Invalid overview membership');
    return { kind: 'overview', scope: { kind: value.scope.kind, ids: [...new Set(value.scope.ids)].sort() } };
}
export function createViewInterests(world, player, initial) {
    const selected = {}, accepted = {};
    const generations = new Map();
    if (initial?.world === world && initial.player === player) {
        Object.assign(selected, copySelection(initial.slots));
        Object.assign(accepted, copySelection(initial.accepted ?? {}));
    }
    function snapshot() {
        return { world, player, slots: copySelection(selected), accepted: copySelection(accepted) };
    }
    return { snapshot,
        request(slot, generation, value) {
            if (value && value.kind !== slot)
                throw new Error('Wrong interest slot');
            generations.set(slot, generation);
            selected[slot] = value ? normalizedSelector(value) : null;
            if (!value)
                accepted[slot] = null;
        },
        accept(slot, generation) { if (generations.get(slot) === generation)
            accepted[slot] = selected[slot]; },
        reject(slot, generation) { if (generations.get(slot) === generation) {
            if (accepted[slot] === undefined)
                delete selected[slot];
            else
                selected[slot] = accepted[slot];
        } },
    };
}
//# sourceMappingURL=interests.js.map