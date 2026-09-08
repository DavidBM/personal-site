import { create } from '@bufbuild/protobuf';
import { ClientMessageSchema, MoveCommandSchema, TransferCommandSchema } from './generated/galaxy/v1/galaxy_pb.js';
import { opaqueIdBytes, opaqueIdAt } from '../contracts/opaque-id.js';
export function hello(credential, options = {}) {
    if (credential.byteLength !== 32)
        throw new Error('Provisioned session credential must contain 32 bytes');
    return create(ClientMessageSchema, { body: { case: 'hello', value: {
                minimumProtocolVersion: 1, maximumProtocolVersion: 1, supportedRuleVersions: [1],
                requiredCapabilities: [1, 2, ...(options.discovery ? [3] : []), ...(options.ownedProjection ? [4] : []),
                    ...(options.transfers ? [5] : []), ...(options.diagnostics ? [6] : []), ...(options.renewAdmissions ? [7] : []),
                    ...(options.strategic ? [8] : [])], sessionCredential: credential,
            } } });
}
export function clientMessage(generation, body) {
    return create(ClientMessageSchema, { protocolVersion: 1, connectionGeneration: generation, body });
}
export function subscribeMessage(generation, subscription, resumeAfter) {
    return create(ClientMessageSchema, { protocolVersion: 1, connectionGeneration: generation, body: { case: 'subscribe', value: {
                worldId: opaqueIdBytes(subscription.worldId), systemId: opaqueIdBytes(subscription.systemId),
                subscriptionId: opaqueIdBytes(subscription.subscriptionId), resumeAfter,
            } } });
}
export function moveCommand(control, scope, admissions, serverNow) {
    const grant = admission(scope, admissions, serverNow);
    return create(MoveCommandSchema, {
        key: { commandId: opaqueIdBytes(control.commandId), receiptHomeShardId: grant.receiptHomeShardId, admissionGeneration: grant.generation },
        scope, shipId: opaqueIdBytes(control.shipId), target: control.target,
        expectedSystemRevision: control.expectedSystemRevision, admissionToken: grant.token,
    });
}
export function transferCommand(control, scope, admissions, serverNow) {
    const grant = admission(scope, admissions, serverNow);
    return create(TransferCommandSchema, {
        key: { commandId: opaqueIdBytes(control.commandId), receiptHomeShardId: grant.receiptHomeShardId, admissionGeneration: grant.generation },
        scope, shipId: opaqueIdBytes(control.shipId), destinationSystemId: opaqueIdBytes(control.destinationSystemId), destinationPosition: control.target,
        expectedSystemRevision: control.expectedSystemRevision, admissionToken: grant.token,
    });
}
function admission(scope, admissions, serverNow) {
    const grant = admissions.find(item => opaqueIdAt(item.receiptHomeShardId) === opaqueIdAt(scope.shardId) && item.notAfterServerMs >= serverNow);
    if (!grant)
        throw new Error('No current command admission grant for this receipt home');
    return grant;
}
//# sourceMappingURL=messages.js.map