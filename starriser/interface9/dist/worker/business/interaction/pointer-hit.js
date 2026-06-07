export const DEFAULT_CLUSTER_HOVER_THRESHOLD = 3000;
export const DEFAULT_CLUSTER_SELECT_THRESHOLD = 600;
export function summarizeClusterPointerHit({ hitClusterId, distance, hoverThreshold = DEFAULT_CLUSTER_HOVER_THRESHOLD, selectThreshold = DEFAULT_CLUSTER_SELECT_THRESHOLD, }) {
    const withinHoverThreshold = hitClusterId !== null && distance <= hoverThreshold;
    const withinSelectThreshold = hitClusterId !== null && distance <= selectThreshold;
    return {
        hitClusterId,
        hoveredId: withinHoverThreshold ? hitClusterId : null,
        withinHoverThreshold,
        withinSelectThreshold,
    };
}
//# sourceMappingURL=pointer-hit.js.map