import { createClusterView } from "./cluster.js";
import { createSolarSystemView } from "./solar-system.js";
import { buildGalaxyViewAddSolarSystemReplayPlan, buildGalaxyViewClusterReplayPlan, canConnectGalaxyViewReplayClusterConnection, canConnectGalaxyViewReplaySolarSystems, planGalaxyViewReplayConnectionRemoval, } from "./galaxy-view-replay-plan.js";
import { resolveGalaxyViewReplayClusterConnection, resolveGalaxyViewReplayClusterPair, resolveGalaxyViewReplaySolarSystem, resolveGalaxyViewReplaySolarSystemPair, } from "./galaxy-view-replay-resolve.js";
export { canConnectGalaxyViewReplayClusterConnection, canConnectGalaxyViewReplaySolarSystems, canUseGalaxyViewReplayJumpGate, planGalaxyViewReplayConnectionRemoval, } from "./galaxy-view-replay-plan.js";
export { resolveGalaxyViewReplayClusterConnection, resolveGalaxyViewReplayClusterPair, resolveGalaxyViewReplaySolarSystem, resolveGalaxyViewReplaySolarSystemPair, } from "./galaxy-view-replay-resolve.js";
export const defaultGalaxyViewReplayFactories = {
    createCluster: createClusterView,
    createSolarSystem: createSolarSystemView,
};
export function applyOpsToGalaxyView(galaxy, ops, onSolarSystemId, factories) {
    if (!Array.isArray(ops))
        return;
    const replayFactories = factories ??
        defaultGalaxyViewReplayFactories;
    for (const op of ops) {
        if (op.type === "addCluster") {
            const existingCluster = galaxy.getClusterById(op.payload.id);
            const plan = buildGalaxyViewClusterReplayPlan(op.payload, existingCluster
                ?.solarSystems ?? []);
            const cluster = replayFactories.createCluster(plan.createPayload);
            const attachedCluster = galaxy.addCluster(cluster);
            replayGalaxyViewClusterPayloadSolarSystems(galaxy, attachedCluster, plan.solarSystemPlan, replayFactories, onSolarSystemId);
        }
        else if (op.type === "addSolarSystem") {
            const cluster = galaxy.getClusterById(op.payload.clusterId);
            if (!cluster)
                continue;
            const plan = buildGalaxyViewAddSolarSystemReplayPlan(op.payload, cluster.solarSystems ?? []);
            const solarSystem = replayFactories.createSolarSystem(plan.createPayload);
            const attachedSolarSystem = galaxy.addSolarSystem(cluster, solarSystem);
            onSolarSystemId?.(attachedSolarSystem.id);
            replayGalaxyViewSolarSystemConnections(galaxy, cluster.id, attachedSolarSystem.id, plan.requestedConnections);
        }
        else if (op.type === "removeSolarSystem") {
            const { clusterId, solarSystemId } = op.payload;
            const ref = resolveGalaxyViewReplaySolarSystem(galaxy, clusterId, solarSystemId);
            if (ref) {
                galaxy.removeSolarSystem(ref.cluster, ref.solarSystem);
            }
        }
        else if (op.type === "connectSolarSystems") {
            const { clusterId, solarSystemId1, solarSystemId2 } = op.payload;
            replayGalaxyViewSolarSystemConnection(galaxy, clusterId, solarSystemId1, solarSystemId2);
        }
        else if (op.type === "connectClusters") {
            const { clusterId1, clusterId2, jumpGate1, jumpGate2 } = op.payload;
            const ref = resolveGalaxyViewReplayClusterConnection(galaxy, clusterId1, clusterId2, jumpGate1, jumpGate2);
            if (ref && canConnectGalaxyViewReplayClusterConnection(ref)) {
                galaxy.connectClusters(ref.cluster1, ref.cluster2, ref.jumpGate1, ref.jumpGate2);
            }
        }
        else if (op.type === "removeConnection") {
            const { clusterId1, clusterId2, jumpGate1, jumpGate2 } = op.payload;
            const removalPlan = planGalaxyViewReplayConnectionRemoval(jumpGate1, jumpGate2);
            if (removalPlan.mode === "clusterPair") {
                const clusterPair = resolveGalaxyViewReplayClusterPair(galaxy, clusterId1, clusterId2);
                if (clusterPair) {
                    galaxy.removeClusterConnectionsBetween(clusterPair.cluster1, clusterPair.cluster2);
                }
                continue;
            }
            const ref = resolveGalaxyViewReplayClusterConnection(galaxy, clusterId1, clusterId2, removalPlan.jumpGate1, removalPlan.jumpGate2);
            if (ref) {
                galaxy.removeClusterConnection(ref.cluster1, ref.cluster2, ref.jumpGate1, ref.jumpGate2);
            }
        }
        else if (op.type === "removeCluster") {
            const cluster = galaxy.getClusterById(op.payload.clusterId);
            if (cluster) {
                galaxy.removeCluster(cluster);
            }
        }
    }
}
function replayGalaxyViewClusterPayloadSolarSystems(galaxy, cluster, plan, factories, onSolarSystemId) {
    for (const solarSystemId of plan.solarSystemIdsToRemove) {
        const solarSystem = galaxy.getSolarSystemById(cluster.id, solarSystemId);
        if (solarSystem) {
            galaxy.removeSolarSystem(cluster, solarSystem);
        }
    }
    for (const entry of plan.solarSystems) {
        const solarSystem = factories.createSolarSystem(entry.createPayload);
        const attachedSolarSystem = galaxy.addSolarSystem(cluster, solarSystem);
        onSolarSystemId?.(attachedSolarSystem.id);
    }
    for (const { solarSystemId, connectedId } of plan.requestedConnections) {
        replayGalaxyViewSolarSystemConnection(galaxy, cluster.id, solarSystemId, connectedId);
    }
}
function replayGalaxyViewSolarSystemConnections(galaxy, clusterId, solarSystemId, connectedIds) {
    for (const connectedId of connectedIds) {
        replayGalaxyViewSolarSystemConnection(galaxy, clusterId, solarSystemId, connectedId);
    }
}
function replayGalaxyViewSolarSystemConnection(galaxy, clusterId, solarSystemId, connectedId) {
    if (!canConnectGalaxyViewReplaySolarSystems(solarSystemId, connectedId)) {
        return;
    }
    const ref = resolveGalaxyViewReplaySolarSystemPair(galaxy, clusterId, solarSystemId, connectedId);
    if (!ref)
        return;
    galaxy.addSolarSystemConnection(ref.cluster, ref.solarSystem1, ref.solarSystem2);
}
//# sourceMappingURL=galaxy-view-replay.js.map