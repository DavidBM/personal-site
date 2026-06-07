import { planGeneratedClusterSolarSystemUpdate, } from "./planning.js";
import { applyGeneratedClusterSolarSystemUpdateToCluster } from "./generation-ops.js";
export function applyGeneratedClusterSolarSystemUpdatesToClusters({ clusters, numSolarSystems, nextSystemId, buildPlan, onClusterOps, onMissingJumpGates, onConnectivityFailure, }) {
    const ops = [];
    const updatedClusterIds = [];
    const missingJumpGateClusterIds = [];
    const failedClusterIds = [];
    let nextId = nextSystemId;
    for (const cluster of clusters) {
        const result = planGeneratedClusterSolarSystemUpdate({
            cluster,
            numSolarSystems,
            nextSystemId: nextId,
            buildPlan,
        });
        nextId = result.nextSystemId;
        if (!result.update) {
            missingJumpGateClusterIds.push(cluster.id);
            onMissingJumpGates?.(cluster);
            continue;
        }
        const update = result.update;
        const clusterOps = applyGeneratedClusterSolarSystemUpdateToCluster(cluster, update);
        if (!update.success) {
            failedClusterIds.push(cluster.id);
            onConnectivityFailure?.(cluster, update);
            continue;
        }
        updatedClusterIds.push(cluster.id);
        ops.push(...clusterOps);
        onClusterOps?.(cluster, clusterOps);
    }
    return {
        nextSystemId: nextId,
        updatedClusterIds,
        missingJumpGateClusterIds,
        failedClusterIds,
        ops,
    };
}
//# sourceMappingURL=generation-solar-systems.js.map