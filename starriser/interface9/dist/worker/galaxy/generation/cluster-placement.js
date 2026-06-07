import { bellCurveRandomRadius, tooCloseZX, } from "../../../math/galaxy-xz-math.js";
import { randomClusterColor, randomPointInDisk_PositiveY, } from "../galaxy-utils.js";
export function placeCluster({ id, galaxyRadius, heightVar, minDistance, centerBias, clusterPositions, }) {
    const radius = bellCurveRandomRadius(galaxyRadius, centerBias);
    const pos = randomPointInDisk_PositiveY(radius, heightVar);
    if (tooCloseZX(pos, clusterPositions, minDistance)) {
        return null;
    }
    clusterPositions.push(pos);
    return {
        id,
        name: `Cluster ${id}`,
        position: pos,
        color: randomClusterColor(),
        radius: 250,
        maxSystemDistance: 0,
        connectedTo: [],
        solarSystems: [],
    };
}
//# sourceMappingURL=cluster-placement.js.map