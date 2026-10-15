import { GameplayOperation as Op, gameplayPayload } from '../../contracts/gameplay.js';
import { callGameplay } from '../../features/http-worker/live.js';
import { featureRequest, FeatureError } from '../../features/http-worker/client.js';
import { identifier, decimal } from '../battle-content/contracts.js';
export async function requestEncounter(scope, command, signal) {
    if (typeof window !== 'undefined')
        return featureRequest('encounter', [scope, command], signal);
    validate(scope, command);
    const body = JSON.stringify({ worldId: scope.worldId, visibilityEpoch: scope.visibilityEpoch, ...command });
    if (body.length > 1024)
        throw new Error('Encounter command too large');
    const response = await (callGameplay)(Op.ENCOUNTER, body, signal);
    if (response.status !== 200)
        throw await rejection(response, signal);
    if (response.visibilityEpoch !== scope.visibilityEpoch) {
        throw new Error('Encounter visibility changed');
    }
    return parse(await read(response, signal), command.commandId);
}
async function rejection(response, signal) {
    let code;
    try {
        code = JSON.parse(new TextDecoder().decode(await read(response, signal))).error;
    }
    catch {
        signal.throwIfAborted();
    }
    const reasons = {
        out_of_range: 'Cannot engage: fleets are too far apart. Move your fleet closer, then choose Fight again.',
        no_route: 'Cannot engage: no safe approach into combat range was found. Move closer or choose another target.',
        fleet_busy: 'Cannot engage: a fleet is already fighting or retreating.',
        capacity: 'Cannot engage: an engagement is already pending or battle capacity is full.',
    };
    const fallback = response.status === 409 ? 'Cannot engage: fleet state changed or the target is unavailable. Reselect your fleet and try again.'
        : response.status === 401 ? 'Sign in again before engaging.'
            : [403, 404, 412].includes(response.status) ? 'Current system detail is no longer available. Re-enter the system before engaging.'
                : 'Engagement not confirmed; retry the same order.';
    return new FeatureError(response.status === 409 && typeof code === 'string' && Object.prototype.hasOwnProperty.call(reasons, code) ? reasons[code] : fallback, response.status);
}
function validate(scope, command) {
    identifier(scope.worldId);
    for (const id of [command.systemId, command.fleetId, command.targetId, command.commandId])
        identifier(id);
    if (decimal(scope.visibilityEpoch) < 1n || decimal(command.expectedRevision) < 1n)
        throw new Error('Invalid encounter scope');
}
function parse(bytes, id) {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (value.commandId !== id || !['scheduled', 'cancelled', 'engaged'].includes(value.status))
        throw new Error('Wrong encounter receipt');
    const arrival = value.arrivalMs == null ? undefined : decimal(value.arrivalMs);
    if (arrival !== undefined && arrival > decimal(value.dueMs))
        throw new Error('Invalid approach deadline');
    return { arrivalMs: arrival, commandId: value.commandId, dueMs: decimal(value.dueMs), serverNowMs: decimal(value.serverNowMs), status: value.status };
}
function read(response, signal) { return gameplayPayload(response, signal, 512); }
//# sourceMappingURL=client.js.map