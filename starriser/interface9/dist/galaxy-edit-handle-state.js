import { advanceClusterEditPointerDispatchState, } from "./cluster-edit-state.js";
export function beginGalaxyEditHandlePointer(hit) {
    return {
        handleId: hit.handleId ?? `edit_cluster_${hit.clusterId ?? "unknown"}`,
        handleKind: hit.handleKind ?? null,
    };
}
export function createGalaxyEditHandleState() {
    return {
        lastEditHandleClusterId: null,
        lastSelectedId: null,
        pointer: clearGalaxyEditHandlePointer(),
        dragModesByClusterId: new Map(),
    };
}
export function setGalaxyEditHandleSelectedCluster(state, clusterId) {
    state.lastSelectedId = clusterId;
    return state;
}
export function setGalaxyEditHandleCluster(state, clusterId) {
    state.lastEditHandleClusterId = clusterId;
    return state;
}
export function clearGalaxyEditHandleCluster(state, clusterId) {
    if (state.lastEditHandleClusterId === clusterId) {
        state.lastEditHandleClusterId = null;
    }
    return state;
}
export function clearGalaxyEditHandleClusterState(state, clusterId) {
    if (state.lastEditHandleClusterId === clusterId) {
        state.lastEditHandleClusterId = null;
    }
    if (state.lastSelectedId === clusterId) {
        state.lastSelectedId = null;
    }
    state.dragModesByClusterId.delete(clusterId);
    return state;
}
export function beginGalaxyEditHandleStatePointer(state, hit) {
    state.pointer = beginGalaxyEditHandlePointer(hit);
    return state.pointer;
}
export function getGalaxyEditHandleStatePointer(state) {
    return state.pointer;
}
export function clearGalaxyEditHandleStatePointer(state) {
    state.pointer = clearGalaxyEditHandlePointer();
    return state.pointer;
}
export function clearGalaxyEditHandleDragMode(state, clusterId) {
    state.dragModesByClusterId.delete(clusterId);
    return state;
}
export function clearGalaxyEditHandleDragModes(state) {
    state.dragModesByClusterId.clear();
    return state;
}
export function advanceGalaxyEditHandleDispatchState(state, clusterId, pointerType) {
    return advanceClusterEditPointerDispatchState(state.dragModesByClusterId, clusterId, pointerType);
}
export function isGalaxyEditHandlePointerActive(state) {
    return state.handleId !== null;
}
export function clearGalaxyEditHandlePointer() {
    return {
        handleId: null,
        handleKind: null,
    };
}
export function buildGalaxyEditHandleDownEvent(hit, pointer, originalEvent) {
    return {
        type: "down",
        handleId: hit.handleId ?? undefined,
        handleKind: hit.handleKind,
        clusterId: hit.clusterId,
        screenX: pointer.screenX,
        screenY: pointer.screenY,
        ndcX: pointer.ndcX,
        ndcY: pointer.ndcY,
        originalEvent,
    };
}
export function buildGalaxyEditHandleDragEvent(type, state, pointer, originalEvent) {
    return {
        type,
        handleId: state.handleId ?? undefined,
        handleKind: state.handleKind ?? undefined,
        screenX: pointer.screenX,
        screenY: pointer.screenY,
        ndcX: pointer.ndcX,
        ndcY: pointer.ndcY,
        originalEvent,
    };
}
export function resolveGalaxyEditHandleTargetClusterId({ eventClusterId, lastEditHandleClusterId, lastSelectedId, firstClusterId, }) {
    return (eventClusterId ?? lastEditHandleClusterId ?? lastSelectedId ?? firstClusterId);
}
export function resolveGalaxyEditHandleStateTargetClusterId(state, eventClusterId, firstClusterId) {
    return resolveGalaxyEditHandleTargetClusterId({
        eventClusterId,
        lastEditHandleClusterId: state.lastEditHandleClusterId,
        lastSelectedId: state.lastSelectedId,
        firstClusterId,
    });
}
export function dispatchGalaxyEditHandlePointerEvent({ state, event, firstClusterId, getClusterById, dispatch, }) {
    const clusterId = resolveGalaxyEditHandleStateTargetClusterId(state, event.clusterId, firstClusterId);
    const cluster = clusterId !== null ? getClusterById(clusterId) : null;
    if (!cluster)
        return false;
    const decision = advanceGalaxyEditHandleDispatchState(state, cluster.id, event.type);
    if (!decision.dispatch)
        return false;
    dispatch({
        ...event,
        cluster,
        editDragMode: decision.editDragMode ?? undefined,
    });
    return true;
}
//# sourceMappingURL=galaxy-edit-handle-state.js.map