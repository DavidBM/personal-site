import { Capability } from './generated/galaxy/v1/galaxy_pb.js';
/** Check fresh and retried immutable intents before retaining or submitting them. */
export function requireCommandCapabilities(command, capabilities) {
    if (command.$typeName === 'galaxy.v1.MoveCommand' && command.expectedFleetRevision !== undefined
        && !capabilities.includes(Capability.FLEET_RETARGET_V1)) {
        throw new Error('Fleet retarget capability is missing');
    }
}
//# sourceMappingURL=command-capabilities.js.map