/**
 * Pack cluster edit-handle pointer events for the business worker.
 */
/**
 * Convert an edit-handle event into a bus pointer_event payload.
 */
export function packEditHandlePointer(evt, camera) {
    const { type, clusterId, handleId, handleKind, screenX, screenY, ndcX, ndcY, editDragMode, } = evt;
    const pointerRay = camera.getPointerRayFromScreenPosition(screenX, screenY);
    const groundPoint = camera.getGroundPointFromScreenPosition(screenX, screenY) || { x: 0, y: 0, z: 0 };
    const ndc = typeof ndcX === "number" && typeof ndcY === "number"
        ? { x: ndcX, y: ndcY }
        : undefined;
    return {
        type,
        clusterId,
        handleId,
        handleKind,
        editDragMode,
        screen_position: { x: screenX, y: screenY },
        galaxy_position: { x: groundPoint.x, z: groundPoint.z },
        ray: pointerRay,
        ndc,
    };
}
//# sourceMappingURL=cluster-edit-pointer.js.map