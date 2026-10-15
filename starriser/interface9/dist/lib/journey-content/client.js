import { GameplayOperation as Op, gameplayPayload } from '../../contracts/gameplay.js';
import { callGameplay } from '../../features/http-worker/live.js';
import { featureRequest, FeatureError } from '../../features/http-worker/client.js';
import { decimal, parseReply, validateOperation } from './contracts.js';
export class JourneyRequestError extends Error {
    constructor(status) {
        super(status === 501 ? 'Journeys currently require every system and your player home on this host, within one shard.' : `Journey request unavailable (${status}); retry the same journey identity.`);
        this.status = status;
    }
}
export async function requestJourney(scope, operation, signal, call) {
    if (typeof window !== 'undefined' && !call) {
        try {
            return await featureRequest('journey', [scope, operation], signal);
        }
        catch (e) {
            if (e instanceof FeatureError && e.status !== undefined)
                throw new JourneyRequestError(e.status);
            throw e;
        }
    }
    validateScope(scope);
    decimal(scope.visibilityEpoch, true);
    validateOperation(operation);
    signal.throwIfAborted();
    const request = JSON.stringify({ worldId: scope.worldId, visibilityEpoch: scope.visibilityEpoch, ...operation });
    if (new TextEncoder().encode(request).length > 4096)
        throw new Error('Journey request exceeds 4 KiB');
    const response = await (call ?? callGameplay)(Op.JOURNEY, request, signal);
    await validateGameplayResult(response, scope.visibilityEpoch, signal);
    const bytes = await readBody(response, signal);
    return parseReply(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), operation);
}
export function readBody(response, signal, limit = 2048) { return gameplayPayload(response, signal, limit); }
export function validateScope(scope) {
    if (!/^[a-f0-9]{32}$/.test(scope.worldId) || /^0+$/.test(scope.worldId))
        throw new Error('Invalid journey world');
    decimal(scope.visibilityEpoch, true);
}
export async function validateGameplayResult(response, epoch, signal) {
    if (signal.aborted) {
        signal.throwIfAborted();
    }
    if (response.status !== 200) {
        throw new JourneyRequestError(response.status);
    }
    if (response.visibilityEpoch !== epoch) {
        throw new Error('Journey visibility changed');
    }
}
//# sourceMappingURL=client.js.map