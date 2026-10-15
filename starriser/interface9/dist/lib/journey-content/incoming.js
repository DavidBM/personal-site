import { GameplayOperation as Op } from '../../contracts/gameplay.js';
import { callGameplay } from '../../features/http-worker/live.js';
import { featureRequest } from '../../features/http-worker/client.js';
import { isOpaqueId } from '../../contracts/opaque-id.js';
import { parseProjection } from './contracts.js';
import { readBody, validateGameplayResult, validateScope } from './client.js';
export async function requestIncoming(scope, systemId, after, signal, call) {
    if (typeof window !== 'undefined' && !call)
        return featureRequest('journeyIncoming', [scope, systemId, after], signal);
    validateScope(scope);
    if (!isOpaqueId(systemId) || (after !== undefined && !isOpaqueId(after)))
        throw new Error('Invalid incoming scope');
    const response = await (call ?? callGameplay)(Op.INCOMING, JSON.stringify({ worldId: scope.worldId, visibilityEpoch: scope.visibilityEpoch, systemId, after }), signal);
    await validateGameplayResult(response, scope.visibilityEpoch, signal);
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(response, signal, 4096)));
    return parseIncoming(value, systemId, after);
}
function parseIncoming(value, systemId, after) {
    if (value.systemId !== systemId || !Array.isArray(value.journeys) || value.journeys.length > 4 || (value.next !== null && !isOpaqueId(value.next)))
        throw new Error('Invalid incoming page');
    let previous = after ?? '';
    const journeys = value.journeys.map((v) => {
        if (typeof v.fleetId !== 'string' || !isOpaqueId(v.fleetId))
            throw new Error('Invalid incoming fleet');
        const row = parseProjection(v, { action: 'lookup', fleetId: v.fleetId });
        if (row.finalSystem !== systemId || row.journeyId <= previous || ['completed', 'cancelled', 'failed'].includes(row.phase.phase))
            throw new Error('Invalid incoming destination');
        previous = row.journeyId;
        return row;
    });
    if (value.next !== null && (journeys.length !== 4 || value.next !== previous))
        throw new Error('Invalid incoming cursor');
    return { systemId, journeys, next: value.next };
}
//# sourceMappingURL=incoming.js.map