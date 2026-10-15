import { validateViewRequest } from './views/validate.js';
import { check, id, key, position, scope, token } from "./validate-fields.js";
function hello(value) {
    check(value.minimumProtocolVersion > 0 && value.minimumProtocolVersion <= 1 && value.maximumProtocolVersion >= 1, "protocol version range");
    check(value.supportedRuleVersions.length <= 16 && value.supportedRuleVersions.includes(1), "rule versions");
    check(value.requiredCapabilities.length <= 16, "capabilities length");
    for (const capability of value.requiredCapabilities)
        check([1, 4, 5, 7, 11, 12, 13, 14, 15].includes(capability), "required capability");
    token(value.sessionCredential);
}
function move(value) {
    key(value.key);
    scope(value.scope);
    id(value.fleetId);
    position(value.target);
    token(value.admissionToken);
    if (value.expectedSystemRevision !== undefined) {
        check(value.expectedSystemRevision >= 0n && value.expectedSystemRevision <= 0xffffffffffffffffn, "expected revision");
    }
    if (value.orbitBody !== undefined)
        check(Number.isInteger(value.orbitBody) && value.orbitBody >= 1 && value.orbitBody <= 15 && value.expectedFleetRevision !== undefined, "orbit body/revision");
    if (value.expectedFleetRevision !== undefined) {
        check(value.expectedSystemRevision === undefined, "mutually exclusive move revisions");
        check(value.expectedFleetRevision > 0n && value.expectedFleetRevision <= 0xffffffffffffffffn, "expected fleet revision");
    }
}
function transfer(value) {
    key(value.key);
    scope(value.scope);
    id(value.fleetId);
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
        case "gameplayRequest":
            check(body.value.requestId > 0n && body.value.operation >= 1 && body.value.operation <= 12 && body.value.payload.length > 0 && body.value.payload.length <= 4096, "gameplay request");
            break;
        case "viewRequest":
            validateViewRequest(body.value);
            break;
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
            id(body.value.systemId);
            check(body.value.requestId > 0n, "renewal request identity");
            break;
        default: throw new Error("Client message has no supported operation");
    }
}
//# sourceMappingURL=validate-client.js.map