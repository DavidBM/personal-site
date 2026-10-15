import { create } from '@bufbuild/protobuf';
import { ClientMessageSchema, MoveCommandSchema, TransferCommandSchema } from './generated/galaxy/v1/galaxy_pb.js';
import { opaqueIdBytes, opaqueIdAt } from '../contracts/opaque-id.js';
export function clientMessage(generation, body) {
    return create(ClientMessageSchema, { protocolVersion: 1, connectionGeneration: generation, body });
}
export function moveCommand(control, scope, admissions, serverNow) {
    const grant = admission(scope, admissions, serverNow);
    return create(MoveCommandSchema, {
        key: { commandId: opaqueIdBytes(control.commandId), receiptHomeShardId: grant.receiptHomeShardId, admissionGeneration: grant.generation },
        scope, fleetId: opaqueIdBytes(control.fleetId), target: control.target, orbitBody: control.orbitBody,
        expectedSystemRevision: control.expectedSystemRevision, expectedFleetRevision: control.expectedFleetRevision, admissionToken: grant.token,
    });
}
export function transferCommand(control, scope, admissions, serverNow) {
    const grant = admission(scope, admissions, serverNow);
    return create(TransferCommandSchema, {
        key: { commandId: opaqueIdBytes(control.commandId), receiptHomeShardId: grant.receiptHomeShardId, admissionGeneration: grant.generation },
        scope, fleetId: opaqueIdBytes(control.fleetId), destinationSystemId: opaqueIdBytes(control.destinationSystemId), destinationPosition: control.target,
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