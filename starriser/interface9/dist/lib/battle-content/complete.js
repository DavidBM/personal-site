import { featureRequest, FeatureError } from '../../features/http-worker/client.js';
import { requestBattle, BattleRequestError } from './client.js';
const previous = new Map();
/** A coherent bounded projection crosses the worker boundary once per accepted revision. */
export async function requestCompleteBattle(scope, fleet, operation, signal, call) {
    if (typeof window !== 'undefined' && !call)
        return remote(scope, fleet, operation, signal);
    const key = `${scope.worldId}/${scope.visibilityEpoch}/${fleet.systemId}/${fleet.fleetId}`;
    const first = await requestBattle(scope, fleet, operation, signal, call);
    const reused = reuseComplete(first, previous.get(key));
    if (reused)
        return reused;
    const groups = [...first.groups];
    for (let page = 1; page < first.pages; page++) {
        const next = await requestBattle(scope, fleet, { action: 'read', page, revision: first.revision.toString(), battleId: first.battleId }, signal, call);
        if (next.pages !== first.pages || JSON.stringify(next.fleets) !== JSON.stringify(first.fleets))
            throw new Error('Battle changed between pages');
        groups.push(...next.groups);
    }
    validateGroups(groups, first.fleets.length);
    signal.throwIfAborted();
    const result = { ...first, groups };
    if (previous.size >= 4)
        previous.delete(previous.keys().next().value);
    previous.set(key, result);
    return result;
}
function reuseComplete(first, old) {
    if (!old || first.battleId !== old.battleId || first.revision !== old.revision)
        return;
    if (first.selectedSlot !== old.selectedSlot || first.pages !== old.pages)
        return;
    if (JSON.stringify(first.fleets) !== JSON.stringify(old.fleets) || JSON.stringify(first.groups) !== JSON.stringify(old.groups.slice(0, first.groups.length)))
        return;
    return { ...first, groups: old.groups };
}
function validateGroups(groups, fleets) {
    let previous = -1;
    const seen = new Set();
    for (const group of groups) {
        const key = group[0] * 16 + group[1];
        if (key <= previous)
            throw new Error('Mixed battle group pages');
        previous = key;
        seen.add(group[0]);
    }
    if (seen.size !== fleets || groups.length > 256)
        throw new Error('Incomplete battle group pages');
}
export function clearBattleCache() { previous.clear(); }
async function remote(scope, fleet, operation, signal) {
    try {
        return await featureRequest('battleComplete', [scope, fleet, operation], signal);
    }
    catch (e) {
        if (e instanceof FeatureError && e.status !== undefined)
            throw new BattleRequestError(e.status);
        throw e;
    }
}
//# sourceMappingURL=complete.js.map