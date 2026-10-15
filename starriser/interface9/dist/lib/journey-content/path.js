import { GameplayOperation as Op } from '../../contracts/gameplay.js';
import { callGameplay } from '../../features/http-worker/live.js';
import { featureRequest } from '../../features/http-worker/client.js';
import { isOpaqueId } from '../../contracts/opaque-id.js';
import { readBody, validateScope, validateGameplayResult } from './client.js';
export async function requestJourneyPath(scope, query, signal, call) {
    if (typeof window !== 'undefined' && !call)
        return featureRequest('journeyPath', [scope, query], signal);
    validateScope(scope);
    const offset = query.offset ?? 0;
    if (!isOpaqueId(query.journeyId) || !isOpaqueId(query.sourceSystem) || !Number.isSafeInteger(offset) || offset < 0 || offset > 1024 || offset % 16)
        throw new Error('Invalid journey path request');
    const response = await (call ?? callGameplay)(Op.JOURNEY_PATH, JSON.stringify({ worldId: scope.worldId, visibilityEpoch: scope.visibilityEpoch, ...query }), signal);
    await validateGameplayResult(response, scope.visibilityEpoch, signal);
    return parseJourneyPath(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(response, signal, 4096))), query);
}
export function parseJourneyPath(value, query) {
    const v = value;
    if (!v || v.journeyId !== query.journeyId || !isOpaqueId(v.fleetId) || !Number.isSafeInteger(v.totalLegs) || v.totalLegs < 1 || v.totalLegs > 1024
        || v.offset !== (query.offset ?? 0) || v.offset > v.totalLegs || !Array.isArray(v.nodes) || !v.nodes.length || v.nodes.length > 16)
        throw new Error('Invalid journey path page');
    for (const row of v.nodes)
        if (!Array.isArray(row) || row.length !== 4 || !isOpaqueId(row[0]) || !isOpaqueId(row[1]) || !Number.isFinite(row[2]) || !Number.isFinite(row[3]))
            throw new Error('Invalid journey path node');
    const end = v.offset + v.nodes.length;
    if (end > v.totalLegs + 1 || v.nextOffset !== (end <= v.totalLegs ? end : null) || (v.nextOffset !== null && v.nodes.length !== 16)
        || (v.offset === 0 && v.nodes[0][0] !== query.sourceSystem))
        throw new Error('Invalid journey path continuation');
    return v;
}
//# sourceMappingURL=path.js.map