import { GameplayOperation as Op, gameplayPayload } from '../../contracts/gameplay.js';
import { callGameplay } from '../../features/http-worker/live.js';
import { featureRequest, FeatureError } from '../../features/http-worker/client.js';
import { BattleRequestError } from './client.js';
import { decimal, identifier, integer, object } from './contracts.js';
const MAX_TURN = 2 ** 32;
export async function requestBattleHistory(scope, fleet, battleId, after, signal, call) {
    if (typeof window !== 'undefined' && !call) {
        try {
            return await featureRequest('battleHistory', [scope, fleet, battleId, after], signal);
        }
        catch (e) {
            if (e instanceof FeatureError && e.status !== undefined)
                throw new BattleRequestError(e.status);
            throw e;
        }
    }
    identifier(scope.worldId);
    if (decimal(scope.visibilityEpoch) < 1n)
        throw new Error('Invalid visibility epoch');
    identifier(fleet.systemId);
    identifier(fleet.fleetId);
    identifier(battleId);
    integer(after, 0, MAX_TURN);
    signal.throwIfAborted();
    const body = JSON.stringify({ worldId: scope.worldId, visibilityEpoch: scope.visibilityEpoch, ...fleet, action: 'history', battleId, after });
    const response = await (call ?? callGameplay)(Op.BATTLE, body, signal);
    signal.throwIfAborted();
    if (response.status !== 200)
        throw new BattleRequestError(response.status);
    if (response.visibilityEpoch !== scope.visibilityEpoch)
        throw new Error('Battle visibility changed');
    const bytes = gameplayPayload(response, signal, 3072);
    return parseHistory(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), fleet, battleId, after);
}
export function parseHistory(input, fleet, battleId, after) {
    const value = object(input);
    if (value.battleId !== battleId || value.systemId !== fleet.systemId || value.fleetId !== fleet.fleetId)
        throw new Error('Wrong battle history scope');
    const from = integer(value.from, after, MAX_TURN), latest = integer(value.latest, from, MAX_TURN);
    if (!Array.isArray(value.turns) || value.turns.length > 64)
        throw new Error('Invalid battle history');
    const turns = value.turns.map((row, index) => parseTurn(row, from + index + 1));
    if (turns.length && turns[turns.length - 1][0] > latest)
        throw new Error('Battle history past its latest turn');
    return { battleId, from, latest, turns };
}
function parseTurn(input, expected) {
    if (!Array.isArray(input) || input.length !== 2 || input[0] !== expected || !Array.isArray(input[1]))
        throw new Error('Battle turns out of order');
    const fleets = input[1];
    if (fleets.length < 2 || fleets.length > 16)
        throw new Error('Invalid battle turn fleets');
    return [expected, fleets.map(parseFleet)];
}
function parseFleet(input) {
    if (!Array.isArray(input) || input.length !== 9)
        throw new Error('Invalid battle turn fleet');
    const status = integer(input[0], 0, 4), exposed = integer(input[1], 0, 32);
    if ((status === 1) !== (exposed > 0))
        throw new Error('Invalid battle turn status');
    const counts = input.slice(2).map(v => integer(v, 0, 1000000));
    return [status, exposed, ...counts];
}
//# sourceMappingURL=history.js.map