import { check, cursor, id, key, scope, ship, token } from "./validate-fields.js";
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
    check(value.ships.length <= 256, "snapshot ships");
    for (const item of value.ships)
        ship(item);
}
function delta(value) {
    scope(value.scope);
    cursor(value.cursor);
    check(value.systemRevision > value.baseSystemRevision, "delta revision");
    check(value.upserts.length + value.removedShipIds.length <= 256, "delta changes");
    for (const item of value.upserts)
        ship(item);
    for (const removed of value.removedShipIds)
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
//# sourceMappingURL=validate-server.js.map