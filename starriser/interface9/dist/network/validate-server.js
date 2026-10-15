import { validateViewEvent } from './views/validate.js';
import { check, id, key, scope, token } from "./validate-fields.js";
function welcome(value, generation) {
    check(value.protocolVersion === 1 && value.ruleVersion === 1, "welcome version");
    check(value.connectionGeneration === generation, "welcome generation");
    id(value.playerId);
    id(value.worldId);
    check(value.capabilities.length <= 16, "welcome limits");
    for (const capability of value.capabilities)
        check(capability > 0, "capability");
}
function admissionGrant(grant) {
    id(grant.receiptHomeShardId);
    check(grant.generation > 0n && grant.notAfterServerMs > 0n, "admission grant");
    token(grant.token);
    const policy = grant.travelPolicy;
    if (policy) {
        check(policy.jumpMs > 0n && policy.jumpMs <= 86400000n, 'travel jump');
        check(policy.cooldownMs <= 2592000000n, 'travel cooldown');
        check(policy.configurationRevision > 0n && policy.modifierRevision > 0n, 'travel revisions');
    }
}
function admissionRenewed(value) {
    if (value.movementContext) {
        const c = value.movementContext;
        check(!!value.scope && !!value.grant && c.version === 3 && c.catalogId.length > 0 && c.catalogId.length <= 64, 'movement context identity');
        check([c.speedPerSecond, c.clearance, c.extent, c.sunClearance].every(Number.isFinite) && c.speedPerSecond > 0 && c.clearance >= 0 && c.extent > 0 && c.sunClearance >= 0 && c.sunClearance <= 1, 'movement context policy');
    }
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
        case "gameplayReply":
            check(body.value.requestId > 0n && body.value.status >= 200 && body.value.status <= 599 && body.value.payload.length <= 8192, "gameplay reply");
            break;
        case "gameplayChanged":
            check(body.value.topics > 0 && (body.value.topics & ~63) === 0 && body.value.fleetIds.length <= 32, "gameplay topics");
            for (const v of body.value.fleetIds)
                id(v);
            break;
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
        case "failure":
            check(body.value.code > 0, "protocol failure");
            break;
        default: throw new Error("Server message has no supported operation");
    }
}
function placementUrl(value, protocol) {
    const url = new URL(value);
    const path = value.slice(value.indexOf('/', value.indexOf('://') + 3));
    check(value.length <= 2048 && url.protocol === protocol && path === url.pathname
        && path.length <= 136 && /^(\/[A-Za-z0-9_-]+)*\/session$/.test(path)
        && !url.username && !url.password && !url.search && !url.hash, 'placement endpoint');
}
//# sourceMappingURL=validate-server.js.map