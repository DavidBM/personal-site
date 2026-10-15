export function fleetOrbitTracking(state, id, visual, position) {
    const lease = state.remoteTracking?.(id);
    let last = position(visual.id);
    return () => {
        if (lease?.waiting())
            return last;
        const current = lease ? lease.current() : state.view.getFleetVisual(visual.id) === visual ? visual : undefined;
        if (!current)
            return null;
        if (lease)
            selectVisual(state, id, current.id);
        return last = position(current.id);
    };
}
export function remoteShipTracking(state, id, type, initialHandle) {
    const lease = state.remoteTracking?.(id);
    if (!lease)
        return () => state.view.getLiveShipPose(initialHandle);
    let handle = initialHandle, last = state.view.getLiveShipPose(handle);
    let bound = lease.current();
    return () => {
        // Hold the camera, without observing retired GPU slots, until an authorized
        // complete replacement arrives. Other camera selections discard this closure.
        if (lease.waiting())
            return last && { ...last, pending: true };
        const visual = lease.current();
        if (!visual)
            return null;
        if (visual !== bound) {
            const chosen = state.view.sceneShipTypes(visual.id).find(row => row.type === type);
            if (!chosen)
                return null;
            const next = state.view.getSceneShipHandle(visual.id, chosen.ordinal);
            if (next == null)
                return last && { ...last, pending: true };
            // Publication precedes the next scene-admission frame. Its handle table
            // can still name the retired incarnation; never bind until it resolves.
            if (!state.view.getLiveShipPose(next))
                return last && { ...last, pending: true };
            if (!state.view.setFollowShipIndex(next, 'source-refreshed'))
                return last && { ...last, pending: true };
            handle = next;
            bound = visual;
        }
        selectVisual(state, id, visual.id);
        return last = state.view.getLiveShipPose(handle);
    };
}
function selectVisual(state, id, renderId) {
    state.sceneFleetRenderIds.set(id, renderId);
    state.view.setSelectedFleetId(renderId);
}
//# sourceMappingURL=camera-tracking.js.map