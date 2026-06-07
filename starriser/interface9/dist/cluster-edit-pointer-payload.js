export function buildClusterEditPointerPayload({ type, clusterId, handleId, handleKind, editDragMode, screenPosition, ndc, pointerRay, groundPoint, }) {
    return {
        type,
        clusterId,
        handleId,
        handleKind,
        editDragMode,
        screen_position: screenPosition,
        galaxy_position: { x: groundPoint.x, z: groundPoint.z },
        ray: pointerRay,
        ndc,
    };
}
export function createNdcPosition(ndcX, ndcY) {
    return typeof ndcX === "number" && typeof ndcY === "number"
        ? { x: ndcX, y: ndcY }
        : undefined;
}
//# sourceMappingURL=cluster-edit-pointer-payload.js.map