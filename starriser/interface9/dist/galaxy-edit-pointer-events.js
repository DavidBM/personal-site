import { beginGalaxyEditHandleStatePointer, buildGalaxyEditHandleDownEvent, buildGalaxyEditHandleDragEvent, clearGalaxyEditHandleStatePointer, getGalaxyEditHandleStatePointer, isGalaxyEditHandlePointerActive, } from "./galaxy-edit-handle-state.js";
export function handleGalaxyEditPointerDown({ state, renderer, event, dispatch, }) {
    if (!renderer.hasEditHandles())
        return false;
    const pointer = renderer.getPointerRayFromEvent(event);
    const hit = renderer.getEditHandleHit(pointer.ndcX, pointer.ndcY);
    if (!hit)
        return false;
    beginGalaxyEditHandleStatePointer(state, hit);
    dispatch(buildGalaxyEditHandleDownEvent(hit, pointer, event));
    return true;
}
export function handleGalaxyEditPointerMove({ state, renderer, event, dispatch, }) {
    return handleGalaxyEditPointerDrag({
        type: "move",
        state,
        renderer,
        event,
        dispatch,
    });
}
export function handleGalaxyEditPointerUp({ state, renderer, event, dispatch, }) {
    const handled = handleGalaxyEditPointerDrag({
        type: "up",
        state,
        renderer,
        event,
        dispatch,
    });
    if (handled) {
        clearGalaxyEditHandleStatePointer(state);
    }
    return handled;
}
function handleGalaxyEditPointerDrag({ type, state, renderer, event, dispatch, }) {
    const pointerState = getGalaxyEditHandleStatePointer(state);
    if (!isGalaxyEditHandlePointerActive(pointerState))
        return false;
    const pointer = renderer.getPointerRayFromEvent(event);
    dispatch(buildGalaxyEditHandleDragEvent(type, pointerState, pointer, event));
    return true;
}
//# sourceMappingURL=galaxy-edit-pointer-events.js.map