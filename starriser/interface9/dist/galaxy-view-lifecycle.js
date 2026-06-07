import { removeClusterConnectionFromGalaxyViewState, removeSolarSystemConnectionFromGalaxyView, } from "./galaxy-view-connections.js";
import { makeGalaxySolarSystemViewKey, removeClusterFromGalaxyView, } from "./galaxy-view-state.js";
import { planClusterRemovalFromClusterView, } from "./galaxy-view-graph.js";
export { addClusterToGalaxyView, addClusterToGalaxyViewState, clearGalaxyViewState, clearGalaxyViewStateInPlace, createGalaxyViewState, disposeClusterView, getClusterFromGalaxyViewState, getSolarSystemFromGalaxyViewState, makeGalaxySolarSystemViewKey, removeClusterFromGalaxyView, } from "./galaxy-view-state.js";
export { addSolarSystemConnectionToGalaxyView, connectClustersInGalaxyView, connectClustersInGalaxyViewState, removeClusterConnectionFromGalaxyView, removeClusterConnectionFromGalaxyViewState, removeClusterConnectionsBetweenFromGalaxyView, removeClusterConnectionsBetweenFromGalaxyViewState, removeSolarSystemConnectionFromGalaxyView, } from "./galaxy-view-connections.js";
export { addSolarSystemToGalaxyView, addSolarSystemToGalaxyViewState, removeSolarSystemFromGalaxyView, removeSolarSystemFromGalaxyViewState, } from "./galaxy-view-solar-systems.js";
export function removeClusterFromGalaxyViewState(state, cluster, renderer) {
    if (state.clusters.indexOf(cluster) === -1)
        return false;
    const removalPlan = planClusterRemovalFromClusterView(state.connections, cluster);
    for (const connection of removalPlan.clusterConnections) {
        removeClusterConnectionFromGalaxyViewState(state, renderer, connection.cluster1, connection.cluster2, connection.jumpGate1, connection.jumpGate2);
    }
    for (const [solarSystemA, solarSystemB] of removalPlan.solarSystemConnections) {
        removeSolarSystemConnectionFromGalaxyView(cluster, solarSystemA, solarSystemB, renderer);
    }
    for (const solarSystem of cluster.solarSystems) {
        state.idToSolarSystem.delete(makeGalaxySolarSystemViewKey(cluster.id, solarSystem.id));
        renderer.removeSolarSystem(cluster, solarSystem);
    }
    return removeClusterFromGalaxyView(cluster, state.clusters, state.idToCluster);
}
//# sourceMappingURL=galaxy-view-lifecycle.js.map