import { GameplayOperation as Op, gameplayPayload } from '../../contracts/gameplay.js';
import { callGameplay } from './live.js';
import { featureRequest, FeatureError } from './client.js';
import { identifier, decimal } from '../../lib/battle-content/contracts.js';
export async function requestTesterFleet(scope, command, signal) {
    if (typeof window !== 'undefined')
        return featureRequest('testerFleet', [scope, command], signal);
    validate(scope, command);
    const response = await (callGameplay)(Op.TESTER_FLEET, JSON.stringify({ ...command, worldId: scope.worldId, visibilityEpoch: scope.visibilityEpoch }), signal);
    if (response.status !== 200) {
        throw new FeatureError(response.status === 400 ? 'Creation rejected: check the counts, position and whether the selected player is still in this system.' : response.status === 403 ? 'Tester permission is required.' : response.status === 409 ? 'Creation rejected: the owner or fleet state changed, or the creation limit was reached.' : 'Fleet creation unconfirmed; retry the same order', response.status);
    }
    if (response.visibilityEpoch !== scope.visibilityEpoch) {
        throw new Error('Creation permission changed');
    }
    const data = await read(response, signal);
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
    return { fleetId: identifier(value.fleetId), systemRevision: decimal(value.systemRevision) };
}
function validate(scope, command) {
    identifier(scope.worldId);
    identifier(command.commandId);
    identifier(command.systemId);
    if (command.ownerId !== undefined)
        identifier(command.ownerId);
    if (decimal(scope.visibilityEpoch) < 1n)
        throw new Error('Invalid creation scope');
    if (command.counts.length !== 6 || !command.counts.every(v => Number.isInteger(v) && v >= 0 && v <= 1e6) || command.position.length !== 3 || !command.position.every(Number.isFinite))
        throw new Error('Invalid fleet');
}
function read(response, signal, limit = 256) { return gameplayPayload(response, signal, limit); }
export async function requestFleetOwners(scope, systemId, after, signal) {
    if (typeof window !== 'undefined')
        return featureRequest('testerFleetOwners', [scope, systemId, after], signal);
    identifier(scope.worldId);
    identifier(systemId);
    if (after !== undefined)
        identifier(after);
    if (decimal(scope.visibilityEpoch) < 1n)
        throw new Error('Invalid owner scope');
    const response = await callGameplay(Op.TESTER_OWNERS, JSON.stringify({ worldId: scope.worldId, visibilityEpoch: scope.visibilityEpoch, systemId, after }), signal);
    if (response.status !== 200) {
        throw new FeatureError('Players could not be loaded. Reopen the creation menu to retry.', response.status);
    }
    if (response.visibilityEpoch !== scope.visibilityEpoch) {
        throw new Error('Creation permission changed');
    }
    return decodeOwners(await read(response, signal, 1536), after);
}
function decodeOwners(bytes, after) {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!Array.isArray(value.owners) || value.owners.length > 32)
        throw new Error('Invalid owner page');
    const owners = value.owners.map(identifier);
    let previous = after ?? '';
    for (const owner of owners) {
        if (owner <= previous)
            throw new Error('Invalid owner order');
        previous = owner;
    }
    const next = value.next == null ? undefined : identifier(value.next);
    if (next !== undefined && (owners.length !== 32 || next !== previous))
        throw new Error('Invalid owner cursor');
    return { owners, next };
}
//# sourceMappingURL=tester-fleet.js.map