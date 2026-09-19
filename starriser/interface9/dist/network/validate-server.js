import { validateViewEvent } from './views/validate.js';
import { check, cursor, id, key, scope, fleet, token } from "./validate-fields.js";
import { validateTopology } from './topology.js';
import { validateStrategicSystems } from './validate-strategic.js';
function welcome(value, generation) {
    check(value.protocolVersion === 1 && value.ruleVersion === 1, "welcome version");
    check(value.connectionGeneration === generation, "welcome generation");
    id(value.playerId);
    id(value.worldId);
    check(value.capabilities.length <= 16 && value.admissions.length <= 16, "welcome limits");
    for (const capability of value.capabilities)
        check(capability > 0, "capability");
    for (const grant of value.admissions)
        admissionGrant(grant);
}
function admissionGrant(grant) {
    id(grant.receiptHomeShardId);
    check(grant.generation > 0n && grant.notAfterServerMs > 0n, "admission grant");
    token(grant.token);
}
function admissionRenewed(value) {
    if (value.scope) {
        scope(value.scope);
        check(value.scope.shardId.every((b, i) => b === value.receiptHomeShardId[i]), "renewal scope home");
    }
    if (value.receiptHomeShardId.length === 0)
        check(!value.scope && !value.grant, "unresolved renewal home");
    else
        id(value.receiptHomeShardId);
    check(value.requestId > 0n && value.serverTimeMs > 0n && value.retryAfterMs <= 30000, "renewal response");
    if (value.grant) {
        admissionGrant(value.grant);
        check(value.grant.notAfterServerMs > value.serverTimeMs, "renewed admission lifetime");
        check(value.grant.receiptHomeShardId.every((byte, index) => byte === value.receiptHomeShardId[index]), "renewed admission home");
    }
    else
        check(value.retryAfterMs > 0, "unavailable admission retry");
}
function receipt(value) {
    key(value.key);
    check(value.result.case !== undefined, "receipt outcome");
    if (value.result.case !== "accepted")
        check(value.result.value.reason > 0, "receipt reason");
}
function snapshot(value) {
    scope(value.scope);
    cursor(value.cursor);
    id(value.snapshotId);
    check(value.chunkCount > 0 && value.chunkCount <= 4096, "snapshot chunks");
    check(value.chunkIndex < value.chunkCount, "snapshot index");
    check(value.fleets.length <= 256, "snapshot fleets");
    for (const item of value.fleets)
        fleet(item);
}
function delta(value) {
    scope(value.scope);
    cursor(value.cursor);
    check(value.systemRevision > value.baseSystemRevision, "delta revision");
    check(value.upserts.length + value.removedFleetIds.length <= 256, "delta changes");
    for (const item of value.upserts)
        fleet(item);
    for (const removed of value.removedFleetIds)
        id(removed);
}
function envelope(message) {
    if (message.protocolVersion === 0 && message.connectionGeneration === 0n && message.body.case === "failure")
        return;
    check(message.protocolVersion === 1 && message.connectionGeneration > 0n, "session envelope");
}
export function validateServerMessage(message) {
    envelope(message);
    const body = message.body;
    switch (body.case) {
        case "viewPlacement": {
            const p = body.value;
            for (const v of [p.worldId, p.playerPartitionId, p.hostId, p.ownerId, p.playerId])
                id(v);
            check(p.ownerEpoch > 0n && p.recoveryGeneration > 0n, "placement authority");
            placementUrl(p.websocketUrl, "wss:");
            if (p.webtransportUrl !== undefined)
                placementUrl(p.webtransportUrl, "https:");
            check(p.certificateSha256.length === 0 || p.certificateSha256.length === 32, "placement certificate");
            break;
        }
        case "viewEvent":
            validateViewEvent(body.value);
            break;
        case "welcome":
            welcome(body.value, message.connectionGeneration);
            break;
        case "receipt":
            receipt(body.value);
            break;
        case "admissionRenewed":
            admissionRenewed(body.value);
            break;
        case "snapshot":
            snapshot(body.value);
            break;
        case "delta":
            delta(body.value);
            break;
        case "topology":
            validateTopology(body.value);
            break;
        case "strategic":
            validateStrategicSystems(body.value);
            break;
        case "playbackClock":
            scope(body.value.scope);
            cursor(body.value.baseline);
            check(body.value.requestId > 0n && body.value.systemRevision > 0n && body.value.sequence > 0n && body.value.serverTimeMs > 0n, "playback correction");
            break;
        case "failure":
            check(body.value.code > 0, "protocol failure");
            break;
        default: throw new Error("Server message has no supported operation");
    }
}
function placementUrl(value, protocol) { const url = new URL(value); check(value.length <= 2048 && url.protocol === protocol && url.pathname === "/session" && !url.username && !url.password && !url.search && !url.hash, "placement endpoint"); }
//# sourceMappingURL=validate-server.js.map