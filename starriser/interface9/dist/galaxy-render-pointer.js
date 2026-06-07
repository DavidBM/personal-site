export function resolveGalaxyRenderPointerScreenPosition(event) {
    const touches = "touches" in event ? event.touches : undefined;
    const touch = touches && touches.length > 0 ? touches[0] : null;
    if (touch)
        return { x: touch.clientX, y: touch.clientY };
    const mouseEvent = event;
    return { x: mouseEvent.clientX, y: mouseEvent.clientY };
}
export function projectGalaxyRenderPointerToNdc(screenPosition, rect) {
    return {
        x: ((screenPosition.x - rect.left) / rect.width) * 2 - 1,
        y: -((screenPosition.y - rect.top) / rect.height) * 2 + 1,
    };
}
export function buildGalaxyRenderPointerRay(event, rect) {
    const screenPosition = resolveGalaxyRenderPointerScreenPosition(event);
    const ndc = projectGalaxyRenderPointerToNdc(screenPosition, rect);
    return {
        ndcX: ndc.x,
        ndcY: ndc.y,
        screenX: screenPosition.x,
        screenY: screenPosition.y,
    };
}
export function projectGalaxyRenderScreenToWorldXZ(screenPosition, rect, unprojectNdc) {
    const ndc = projectGalaxyRenderPointerToNdc(screenPosition, rect);
    const worldPosition = unprojectNdc({ x: ndc.x, y: ndc.y, z: 0.5 });
    return {
        x: worldPosition.x,
        y: worldPosition.z,
    };
}
//# sourceMappingURL=galaxy-render-pointer.js.map