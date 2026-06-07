import { buildClusterRegenerationFromGalaxyData, } from "./worker/galaxy/planning.js";
import { applyClusterRegenerationPlanToGalaxyData } from "./worker/galaxy/galaxy-data-regeneration.js";
export function runAppClusterRegeneration(input) {
    const plans = [];
    let nextSystemId = input.startingNextSystemId;
    for (const clusterId of input.clusterIds) {
        if (input.hasViewCluster && !input.hasViewCluster(clusterId)) {
            continue;
        }
        const regeneration = buildClusterRegenerationFromGalaxyData({
            worldData: input.worldData,
            clusterId,
            startingNextId: nextSystemId,
            numSolarSystems: input.numSolarSystems,
        });
        if (!regeneration)
            continue;
        applyClusterRegenerationPlanToGalaxyData(input.worldData, regeneration);
        nextSystemId = regeneration.nextSystemId;
        plans.push(regeneration);
        input.onPlanApplied?.(regeneration);
    }
    return {
        plans,
        nextSystemId,
    };
}
//# sourceMappingURL=app-regeneration.js.map