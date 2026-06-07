import { createGalaxyDataSelectionState } from "./galaxy-data-selection.js";
import { addClusterToGalaxyData, addSolarSystemToGalaxyData, connectClustersInGalaxyData, connectSolarSystemsInGalaxyData, removeClusterConnectionFromGalaxyData, removeClusterFromGalaxyData, removeSolarSystemFromGalaxyData, } from "./galaxy-data-structural.js";
export function createGalaxyData({ generationId = null, lastUpdated = 0, selection, } = {}) {
    return {
        clusters: {},
        clusterOrder: [],
        connections: [],
        selection: createGalaxyDataSelectionState(selection),
        metadata: {
            generationId,
            lastUpdated,
        },
    };
}
/**
 * Applies Ops to a flat GalaxyData snapshot.
 *
 * This mutates the provided data object intentionally: workers already own their
 * private state, and this reducer is the allocation-light core that future
 * replay paths can share.
 */
export function applyOpsToGalaxyData(data, ops) {
    for (const op of ops) {
        if (op.type === "addCluster") {
            addClusterToGalaxyData(data, op.payload);
        }
        else if (op.type === "removeCluster") {
            removeClusterFromGalaxyData(data, op.payload.clusterId);
        }
        else if (op.type === "addSolarSystem") {
            addSolarSystemToGalaxyData(data, op.payload);
        }
        else if (op.type === "removeSolarSystem") {
            removeSolarSystemFromGalaxyData(data, op.payload.clusterId, op.payload.solarSystemId);
        }
        else if (op.type === "connectSolarSystems") {
            connectSolarSystemsInGalaxyData(data, op.payload.clusterId, op.payload.solarSystemId1, op.payload.solarSystemId2);
        }
        else if (op.type === "connectClusters") {
            connectClustersInGalaxyData(data, op.payload.clusterId1, op.payload.clusterId2, op.payload.jumpGate1.id, op.payload.jumpGate2.id);
        }
        else if (op.type === "removeConnection") {
            removeClusterConnectionFromGalaxyData(data, op.payload.clusterId1, op.payload.clusterId2, op.payload.jumpGate1?.id ?? null, op.payload.jumpGate2?.id ?? null);
        }
    }
    return data;
}
//# sourceMappingURL=galaxy-data-reducer.js.map