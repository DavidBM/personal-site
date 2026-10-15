import { GameplayOperation as Op, gameplayPayload } from '../../contracts/gameplay.js';
import { callGameplay } from '../../features/http-worker/live.js';
import { featureRequest, FeatureError } from '../../features/http-worker/client.js';
import { decimal, id, parseProjection, validateOperation } from './contracts.js';
export class IndustryRequestError extends Error {
    constructor(status) { super(status === 429 ? 'Industry history or work capacity is full. Existing accepted work can still finish.' : status === 409 ? 'Construction or production conditions changed. Check stock, surveyed ground, occupancy and capacity.' : `Industry request unavailable (${status}); retry the same request identity if its outcome is unconfirmed.`); this.status = status; }
}
export async function requestIndustry(scope, operation, signal, call) {
    if (typeof window !== 'undefined' && !call) {
        try {
            return await featureRequest('industry', [scope, operation], signal);
        }
        catch (e) {
            if (e instanceof FeatureError && e.status !== undefined)
                throw new IndustryRequestError(e.status);
            throw e;
        }
    }
    validate(scope);
    validateOperation(operation);
    signal.throwIfAborted();
    const request = JSON.stringify({ worldId: scope.worldId, visibilityEpoch: scope.visibilityEpoch, systemId: scope.systemId, bodyId: scope.bodyId, ...operation });
    if (new TextEncoder().encode(request).length > 2048)
        throw new Error('Industry request exceeds 2 KiB');
    const response = await (call ?? callGameplay)(Op.INDUSTRY, request, signal);
    if (signal.aborted) {
        signal.throwIfAborted();
    }
    if (response.status !== 200) {
        throw new IndustryRequestError(response.status);
    }
    if (response.visibilityEpoch !== scope.visibilityEpoch) {
        throw new Error('Industry visibility changed');
    }
    const bytes = await readBody(response, signal);
    return parseProjection(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), scope.bodyId, operation);
}
function validate(scope) {
    if (decimal(scope.visibilityEpoch) < 1n)
        throw new Error('Invalid industry scope');
    id(scope.worldId);
    id(scope.systemId);
    id(scope.bodyId);
}
function readBody(response, signal) { return gameplayPayload(response, signal, 4096); }
//# sourceMappingURL=client.js.map