import { GameplayOperation as Op } from '../../contracts/gameplay.js';
import { callGameplay } from '../../features/http-worker/live.js';
import { featureRequest } from '../../features/http-worker/client.js';
import { isOpaqueId } from '../../contracts/opaque-id.js';
import { decimal } from './contracts.js';
import { readBody, validateScope, validateGameplayResult } from './client.js';
/** Decode one bounded page in the feature worker. No full-world graph or
 * solar-system detail is copied to the UI to plan a distant destination. */
export async function requestRoute(scope, query, signal, call) {
    if (typeof window !== 'undefined' && !call)
        return featureRequest('journeyRoute', [scope, query], signal);
    validateScope(scope);
    decimal(scope.visibilityEpoch, true);
    validateQuery(query);
    const response = await (call ?? callGameplay)(Op.ROUTE_PREVIEW, JSON.stringify({ worldId: scope.worldId, visibilityEpoch: scope.visibilityEpoch, ...query }), signal);
    await validateGameplayResult(response, scope.visibilityEpoch, signal);
    return parsePage(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(response, signal))), query);
}
function integer(value, min, max) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max; }
function validateQuery(query) {
    const offset = query.offset ?? 0;
    if (![query.fleetId, query.sourceSystem, query.destinationSystem].every(isOpaqueId) || !integer(offset, 0, 1024) || offset % 32 !== 0)
        throw new Error('Invalid route query');
}
function progress(v, query) {
    if (!integer(v.totalLegs, 1, 1024) || v.offset !== (query.offset ?? 0) || v.offset > v.totalLegs)
        throw new Error('Invalid route progress');
}
function pathPage(v, query) {
    progress(v, query);
    const ids = v.systems;
    if (!Array.isArray(ids) || !integer(ids.length, 1, 32) || !ids.every(isOpaqueId))
        throw new Error('Invalid route page');
    const end = v.offset + ids.length;
    if (v.nextOffset !== (end <= v.totalLegs ? end : null))
        throw new Error('Invalid route continuation');
    if (v.nextOffset !== null && ids.length !== 32)
        throw new Error('Incomplete route page');
    return ids;
}
function parsePage(value, query) {
    if (!value || typeof value !== 'object')
        throw new Error('Invalid route response');
    const v = value;
    if (v.fleetId !== query.fleetId || v.sourceSystem !== query.sourceSystem || v.destinationSystem !== query.destinationSystem)
        throw new Error('Route selection changed');
    const systems = pathPage(v, query);
    if (![v.jumpMs, v.cooldownMs].every(n => integer(n, 0, Number.MAX_SAFE_INTEGER)))
        throw new Error('Invalid travel timing');
    const serverNowMs = decimal(v.serverNowMs), estimatedArrivalMs = decimal(v.estimatedArrivalMs);
    if (estimatedArrivalMs < serverNowMs)
        throw new Error('Invalid travel estimate');
    return { ...query, offset: v.offset, nextOffset: v.nextOffset, systems, totalLegs: v.totalLegs, jumpMs: v.jumpMs, cooldownMs: v.cooldownMs,
        fleetRevision: decimal(v.fleetRevision, true), topologyRevision: decimal(v.topologyRevision, true), serverNowMs, estimatedArrivalMs };
}
//# sourceMappingURL=navigation.js.map