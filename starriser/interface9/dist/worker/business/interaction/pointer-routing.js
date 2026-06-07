export function createEmptyPointerInteractionRoute() {
    return {
        editDragClusterId: null,
        clusterPickType: null,
        galaxyPosition: null,
    };
}
export function planPointerInteractionRoute({ hasClusters, isEditMode, eventType, clusterId, galaxyPosition, }) {
    if (!hasClusters) {
        return createEmptyPointerInteractionRoute();
    }
    const editDragClusterId = isEditMode && typeof clusterId === "number" ? clusterId : null;
    const clusterPickType = (eventType === "move" || eventType === "tap") && galaxyPosition
        ? eventType
        : null;
    return {
        editDragClusterId,
        clusterPickType,
        galaxyPosition: clusterPickType ? galaxyPosition ?? null : null,
    };
}
//# sourceMappingURL=pointer-routing.js.map