import { GameplayOperation as Op, gameplayPayload } from '../../contracts/gameplay.js';
import { callGameplay } from '../../features/http-worker/live.js';
import { featureRequest, FeatureError } from '../../features/http-worker/client.js';
import { decimal, identifier, validateOperation } from './contracts.js';
import { parsePage } from './parse.js';
export class BattleRequestError extends Error {
    constructor(status) { super(message(status)); this.status = status; }
}
function message(status) {
    if (status === 404)
        return 'No battle is registered for this fleet.';
    if (status === 409)
        return 'The turn or battle changed. Refresh before giving a new order.';
    if (status === 403)
        return 'Current system visibility is required for battle controls.';
    if (status === 501)
        return 'Battle controls currently require this system on your player-home host.';
    return `Battle outcome unconfirmed (${status}). Retry the same order.`;
}
export async function requestBattle(scope, fleet, operation, signal, call) {
    if (typeof window !== 'undefined' && !call) {
        try {
            return await featureRequest('battle', [scope, fleet, operation], signal);
        }
        catch (e) {
            if (e instanceof FeatureError && e.status !== undefined)
                throw new BattleRequestError(e.status);
            throw e;
        }
    }
    validateScope(scope);
    validateOperation(fleet, operation);
    signal.throwIfAborted();
    const body = JSON.stringify({ worldId: scope.worldId, visibilityEpoch: scope.visibilityEpoch, ...fleet, ...operation });
    if (new TextEncoder().encode(body).length > 1024)
        throw new Error('Battle request exceeds 1 KiB');
    const response = await (call ?? callGameplay)(Op.BATTLE, body, signal);
    await validate(response, scope.visibilityEpoch, signal);
    const value = parsePage(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await read(response, signal))), fleet);
    checkGameplayResult(value, operation);
    return value;
}
function validateScope(scope) {
    identifier(scope.worldId);
    if (decimal(scope.visibilityEpoch) < 1n)
        throw new Error('Invalid visibility epoch');
}
function checkGameplayResult(value, operation) {
    if (operation.action === 'read') {
        checkPage(value, operation);
        return;
    }
    const receipt = value.receipt;
    if (!receipt || value.battleId !== operation.battleId || receipt.commandId !== operation.commandId || receipt.effectiveTurn !== BigInt(operation.nextTurn) || receipt.planRevision !== BigInt(operation.planRevision) + 1n)
        throw new Error('Wrong battle receipt');
}
function checkPage(value, operation) {
    if (value.page !== (operation.page ?? 0))
        throw new Error('Wrong battle page');
    if (operation.revision !== undefined && (value.revision !== BigInt(operation.revision) || value.battleId !== operation.battleId))
        throw new Error('Battle changed between pages');
}
async function validate(response, epoch, signal) {
    if (signal.aborted) {
        signal.throwIfAborted();
    }
    if (response.status !== 200) {
        throw new BattleRequestError(response.status);
    }
    if (response.visibilityEpoch !== epoch) {
        throw new Error('Battle visibility changed');
    }
}
function read(response, signal) { return gameplayPayload(response, signal, 3072); }
//# sourceMappingURL=client.js.map