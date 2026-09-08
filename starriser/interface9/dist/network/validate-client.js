import { check, cursor, id, key, position, scope, token } from "./validate-fields.js";
import { validateSubscribeStrategic } from './validate-strategic.js';
function hello(value) {
    check(value.minimumProtocolVersion > 0 && value.minimumProtocolVersion <= 1 && value.maximumProtocolVersion >= 1, "protocol version range");
    check(value.supportedRuleVersions.length <= 16 && value.supportedRuleVersions.includes(1), "rule versions");
    check(value.requiredCapabilities.length <= 16, "capabilities length");
    for (const capability of value.requiredCapabilities)
        check(capability >= 1 && capability <= 10, "required capability");
    token(value.sessionCredential);
}
function move(value) {
    key(value.key);
    scope(value.scope);
    id(value.shipId);
    position(value.target);
    token(value.admissionToken);
    if (value.expectedSystemRevision !== undefined) {
        check(value.expectedSystemRevision >= 0n && value.expectedSystemRevision <= 0xffffffffffffffffn, "expected revision");
    }
}
function subscribe(value) {
    id(value.worldId);
    id(value.systemId);
    id(value.subscriptionId);
    if (!value.resumeAfter)
        return;
    cursor(value.resumeAfter);
    check(value.subscriptionId.every((byte, index) => value.resumeAfter?.subscriptionId[index] === byte), "resume subscription");
}
function transfer(value) {
    key(value.key);
    scope(value.scope);
    id(value.shipId);
    id(value.destinationSystemId);
    position(value.destinationPosition);
    token(value.admissionToken);
    if (value.expectedSystemRevision !== undefined) {
        check(value.expectedSystemRevision >= 0n && value.expectedSystemRevision <= 0xffffffffffffffffn, "expected revision");
    }
}
export function validateClientMessage(message) {
    const body = message.body;
    if (body.case === "hello") {
        check(message.protocolVersion === 0 && message.connectionGeneration === 0n, "hello envelope");
        hello(body.value);
        return;
    }
    check(message.protocolVersion === 1 && message.connectionGeneration > 0n, "session envelope");
    switch (body.case) {
        case "move":
            move(body.value);
            break;
        case "transfer":
            transfer(body.value);
            break;
        case "receiptQuery":
            id(body.value.worldId);
            key(body.value.key);
            break;
        case "renewAdmission":
            id(body.value.receiptHomeShardId);
            check(body.value.requestId > 0n, "renewal request identity");
            break;
        case "playbackClock":
            scope(body.value.scope);
            cursor(body.value.baseline);
            check(body.value.requestId > 0n && body.value.systemRevision > 0n, "playback request");
            break;
        case "subscribe":
            subscribe(body.value);
            break;
        case "subscribeStrategic":
            validateSubscribeStrategic(body.value);
            break;
        default: throw new Error("Client message has no supported operation");
    }
}
//# sourceMappingURL=validate-client.js.map