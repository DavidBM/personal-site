import { removeClusterConnectionFromGalaxyViewState, removeSolarSystemConnectionFromGalaxyView, } from "./galaxy-view-connections.js";
import { makeGalaxySolarSystemViewKey, } from "./galaxy-view-state.js";
import { attachSolarSystemToClusterView, detachSolarSystemFromClusterView, findSolarSystemInClusterView, hasSolarSystemInClusterView, planSolarSystemRemovalFromClusterView, } from "./galaxy-view-graph.js";
export function addSolarSystemToGalaxyView(cluster, solarSystem, idToSolarSystem, renderer) {
    const attachedSolarSystem = attachSolarSystemToClusterView(cluster, solarSystem);
    idToSolarSystem.set(makeGalaxySolarSystemViewKey(cluster.id, attachedSolarSystem.id), attachedSolarSystem);
    renderer.addSolarSystem(cluster, attachedSolarSystem);
    return attachedSolarSystem;
}
export function addSolarSystemToGalaxyViewState(state, cluster, solarSystem, renderer) {
    const existing = findSolarSystemInClusterView(cluster, solarSystem.id);
    if (existing) {
        const removalPlan = planSolarSystemRemovalFromClusterView(state.connections, cluster, existing);
        for (const conn of removalPlan.clusterConnections) {
            removeClusterConnectionFromGalaxyViewState(state, renderer, conn.cluster1, conn.cluster2, conn.jumpGate1, conn.jumpGate2);
        }
        for (const other of removalPlan.solarSystemConnections) {
            removeSolarSystemConnectionFromGalaxyView(cluster, existing, other, renderer);
        }
    }
    return addSolarSystemToGalaxyView(cluster, solarSystem, state.idToSolarSystem, renderer);
}
export function removeSolarSystemFromGalaxyView(cluster, solarSystem, connections, idToSolarSystem, renderer, removeClusterConnection, removeSolarSystemConnection) {
    if (!hasSolarSystemInClusterView(cluster, solarSystem)) {
        return false;
    }
    const removalPlan = planSolarSystemRemovalFromClusterView(connections, cluster, solarSystem);
    for (const conn of removalPlan.clusterConnections) {
        removeClusterConnection(conn.cluster1, conn.cluster2, conn.jumpGate1, conn.jumpGate2);
    }
    for (const other of removalPlan.solarSystemConnections) {
        removeSolarSystemConnection(cluster, solarSystem, other);
    }
    if (!detachSolarSystemFromClusterView(cluster, solarSystem)) {
        return false;
    }
    idToSolarSystem.delete(makeGalaxySolarSystemViewKey(cluster.id, solarSystem.id));
    renderer.removeSolarSystem(cluster, solarSystem);
    return true;
}
export function removeSolarSystemFromGalaxyViewState(state, cluster, solarSystem, renderer) {
    return removeSolarSystemFromGalaxyView(cluster, solarSystem, state.connections, state.idToSolarSystem, renderer, (cluster1, cluster2, jumpGate1, jumpGate2) => removeClusterConnectionFromGalaxyViewState(state, renderer, cluster1, cluster2, jumpGate1, jumpGate2), (targetCluster, solarSystemA, solarSystemB) => removeSolarSystemConnectionFromGalaxyView(targetCluster, solarSystemA, solarSystemB, renderer));
}
//# sourceMappingURL=galaxy-view-solar-systems.js.map