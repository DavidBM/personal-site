export function decideClusterEditPointerDispatch(currentDragMode, pointerType) {
    let activeDragMode = currentDragMode;
    if (activeDragMode === null && pointerType === "down") {
        activeDragMode = "xz";
    }
    if (pointerType === "up") {
        return {
            dispatch: true,
            editDragMode: activeDragMode ?? "xz",
            nextDragMode: null,
        };
    }
    if (activeDragMode !== null) {
        return {
            dispatch: true,
            editDragMode: activeDragMode,
            nextDragMode: activeDragMode,
        };
    }
    return {
        dispatch: false,
        editDragMode: null,
        nextDragMode: activeDragMode,
    };
}
export function advanceClusterEditPointerDispatchState(dragModesByClusterId, clusterId, pointerType) {
    const decision = decideClusterEditPointerDispatch(dragModesByClusterId.get(clusterId) ?? null, pointerType);
    if (decision.nextDragMode === null) {
        dragModesByClusterId.delete(clusterId);
    }
    else {
        dragModesByClusterId.set(clusterId, decision.nextDragMode);
    }
    return decision;
}
//# sourceMappingURL=cluster-edit-state.js.map