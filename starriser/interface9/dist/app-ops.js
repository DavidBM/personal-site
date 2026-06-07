import { applyOpsToGalaxyView, } from "./galaxy-view-replay.js";
import { applyOpsToGalaxyData } from "./worker/galaxy/galaxy-data-reducer.js";
export function applyOpsToAppWorldAndView(input) {
    if (!Array.isArray(input.ops)) {
        return { applied: false, maxSolarSystemId: input.maxSolarSystemId };
    }
    applyOpsToGalaxyData(input.worldData, input.ops);
    return applyOpsToAppView(input);
}
export function applyOpsToAppView(input) {
    if (!Array.isArray(input.ops)) {
        return { applied: false, maxSolarSystemId: input.maxSolarSystemId };
    }
    let maxSolarSystemId = input.maxSolarSystemId;
    applyOpsToGalaxyView(input.galaxyView, input.ops, (id) => {
        maxSolarSystemId = getNextMaxSolarSystemId(maxSolarSystemId, id);
    }, input.factories);
    return { applied: true, maxSolarSystemId };
}
export function getNextMaxSolarSystemId(currentMaxSolarSystemId, solarSystemId) {
    return solarSystemId > currentMaxSolarSystemId
        ? solarSystemId
        : currentMaxSolarSystemId;
}
//# sourceMappingURL=app-ops.js.map