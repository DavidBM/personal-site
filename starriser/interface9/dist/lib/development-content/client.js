import { GameplayOperation as Op, gameplayPayload } from '../../contracts/gameplay.js';
import { callGameplay } from '../../features/http-worker/live.js';
import { featureRequest } from '../../features/http-worker/client.js';
const id = (v) => typeof v === 'string' && /^[a-f0-9]{32}$/.test(v) && !/^0+$/.test(v);
const num = (v) => typeof v === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(v) && BigInt(v) <= 18446744073709551615n;
function building(v) { return !!v && id(v.id) && Number.isInteger(v.kind) && v.kind >= 1 && v.kind <= 4 && Number.isInteger(v.x) && v.x >= 0 && v.x < 8192 && Number.isInteger(v.y) && v.y >= 0 && v.y < 4096 && num(v.targetLevel) && BigInt(v.targetLevel) > 0n && num(v.startedMs) && num(v.readyMs) && BigInt(v.readyMs) > BigInt(v.startedMs); }
export function parseProjection(v, op) {
    let valid = !!v && num(v.serverNowMs);
    if (op.action === 'list')
        valid && (valid = v.kind === 'page' && num(v.durationMs) && BigInt(v.durationMs) > 0n && BigInt(v.durationMs) <= 86400000n && num(v.revision) && typeof v.canBuild === 'boolean' && Array.isArray(v.buildings) && v.buildings.length <= 32 && v.buildings.every(building) && (v.next === null || id(v.next)));
    else if (op.action === 'fleet')
        valid && (valid = v.kind === 'fleet' && num(v.revision) && (v.counts === null || (Array.isArray(v.counts) && v.counts.length === 6 && v.counts.every((n) => Number.isInteger(n) && Number(n) >= 0 && Number(n) <= 1000000))) && (v.arrivalMs === null || num(v.arrivalMs)) && num(v.readyMs));
    else
        valid && (valid = v.kind === 'accepted' && building(v.building) && v.building.id === (op.action === 'build' ? op.commandId : op.buildingId));
    if (!valid)
        throw new Error('Invalid development response');
    return v;
}
export async function requestDevelopment(scope, targetId, operation, signal, call) {
    if (typeof window !== 'undefined' && !call)
        return featureRequest('development', [scope, targetId, operation], signal);
    if (!id(scope.worldId) || !id(scope.systemId) || !id(targetId) || !num(scope.visibilityEpoch) || BigInt(scope.visibilityEpoch) < 1n)
        throw new Error('Invalid development scope');
    const body = JSON.stringify({ worldId: scope.worldId, systemId: scope.systemId, visibilityEpoch: scope.visibilityEpoch, targetId, operation });
    if (new TextEncoder().encode(body).length > 1024)
        throw new Error('Development request exceeds 1 KiB');
    signal.throwIfAborted();
    const response = await (call ?? callGameplay)(operation.action === 'fleet' ? Op.FLEET_STATUS : Op.DEVELOPMENT, body, signal);
    if (response.status !== 200) {
        throw Object.assign(new Error(response.status === 403 ? 'You do not own this planet.' : response.status === 409 ? 'The surface or building changed. Refresh before trying again.' : `Request unconfirmed (${response.status}). Retry the same order.`), { status: response.status });
    }
    if (response.visibilityEpoch !== scope.visibilityEpoch) {
        throw new Error('Development visibility changed');
    }
    return parseProjection(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(response, signal))), operation);
}
function readBody(response, signal) { return gameplayPayload(response, signal, 8192); }
//# sourceMappingURL=client.js.map