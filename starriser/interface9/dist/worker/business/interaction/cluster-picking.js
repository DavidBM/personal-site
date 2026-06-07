import { summarizeClusterPointerHit, } from "./pointer-hit.js";
export function pickClusterForPointer({ index, position, hoverThreshold, selectThreshold, }) {
    const hit = index.query(position.x, position.z);
    const cluster = hit.item ?? null;
    return {
        cluster,
        summary: summarizeClusterPointerHit({
            hitClusterId: cluster ? cluster.id : null,
            distance: hit.dist,
            hoverThreshold,
            selectThreshold,
        }),
    };
}
//# sourceMappingURL=cluster-picking.js.map