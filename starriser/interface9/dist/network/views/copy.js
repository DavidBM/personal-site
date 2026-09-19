import { create } from '@bufbuild/protobuf';
import * as w from '../generated/galaxy/v1/galaxy_pb.js';
// Own exact byte spans, even when the input is a Node Buffer or a view into a
// large transport frame. Only typed view data is retained, never unknown fields.
const bytes = (value) => new Uint8Array(value);
const position = (value) => value && create(w.LocalPositionSchema, { x: value.x, z: value.z });
const galaxyPosition = (value) => value && create(w.GalaxyPositionSchema, { x: value.x, z: value.z });
export function copyObservation(value) {
    if (!value)
        return undefined;
    const scope = value.scope;
    return create(w.SourceObservationSchema, {
        revision: value.revision, committedServerMs: value.committedServerMs, availability: value.availability,
        scope: scope && create(w.AuthorityScopeSchema, { worldId: bytes(scope.worldId), shardId: bytes(scope.shardId), systemId: bytes(scope.systemId), ownerEpoch: scope.ownerEpoch, recoveryGeneration: scope.recoveryGeneration }),
    });
}
export function copySelector(value) {
    const kind = value.kind;
    switch (kind.case) {
        case 'overview': return create(w.ViewSelectorSchema, { kind: { case: 'overview', value: { wholeKnownGalaxy: kind.value.wholeKnownGalaxy, systemIds: kind.value.systemIds.map(bytes), clusterIds: kind.value.clusterIds.map(bytes) } } });
        case 'detail': return create(w.ViewSelectorSchema, { kind: { case: 'detail', value: { systemId: bytes(kind.value.systemId) } } });
        case 'owned': return create(w.ViewSelectorSchema, { kind: { case: 'owned', value: {} } });
        case undefined: return create(w.ViewSelectorSchema);
    }
}
export function copyRow(value) {
    switch (value.$typeName) {
        case 'galaxy.v1.TopologyCluster': return create(w.TopologyClusterSchema, { clusterId: bytes(value.clusterId), name: value.name, position: galaxyPosition(value.position), radius: value.radius });
        case 'galaxy.v1.TopologySystem': return create(w.TopologySystemSchema, { systemId: bytes(value.systemId), clusterId: bytes(value.clusterId), name: value.name, position: galaxyPosition(value.position) });
        case 'galaxy.v1.TopologyConnection': return create(w.TopologyConnectionSchema, { systemA: bytes(value.systemA), systemB: bytes(value.systemB) });
        case 'galaxy.v1.OverviewSystem': return create(w.OverviewSystemSchema, { systemId: bytes(value.systemId), observation: copyObservation(value.observation), presentFleets: value.presentFleets, movingFleets: value.movingFleets });
        case 'galaxy.v1.OwnedFleetRow': return create(w.OwnedFleetRowSchema, { fleetId: bytes(value.fleetId), fleetRevision: value.fleetRevision, source: copyObservation(value.source), state: value.state, systemId: bytes(value.systemId), destinationSystemId: bytes(value.destinationSystemId), transferId: bytes(value.transferId), arrivalServerMs: value.arrivalServerMs, memberCount: value.memberCount, departureSystemId: bytes(value.departureSystemId) });
        case 'galaxy.v1.FleetProjection': {
            const m = value.movement;
            return create(w.FleetProjectionSchema, { fleetId: bytes(value.fleetId), revision: value.revision, position: position(value.position), controllable: value.controllable, transferReadyServerMs: value.transferReadyServerMs,
                movement: m && create(w.FleetMoveSchema, { from: position(m.from), to: position(m.to), departureServerMs: m.departureServerMs, arrivalServerMs: m.arrivalServerMs, orderId: bytes(m.orderId) }) });
        }
    }
}
function copyRows(value) {
    return { tables: new Map([...value.tables].map(([name, rows]) => [name, new Map([...rows].map(([key, row]) => [key, copyRow(row)]))])), unavailable: [...value.unavailable], unavailableSummaries: value.unavailableSummaries, ownedCut: value.ownedCut, observation: copyObservation(value.observation) };
}
function copyBaseline(value) {
    return { ...value, selector: copySelector(value.selector), rows: copyRows(value.rows) };
}
export function copySnapshot(value) {
    return { slot: value.slot, requestedGeneration: value.requestedGeneration, status: value.status, stale: value.stale,
        requested: value.requested && copySelector(value.requested), displayed: value.displayed && copyBaseline(value.displayed) };
}
//# sourceMappingURL=copy.js.map