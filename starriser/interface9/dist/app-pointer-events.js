export const APP_POINTER_TAP_MAX_DISTANCE_SQ = 50 * 50;
export const APP_POINTER_TAP_MAX_DURATION_MS = 200;
export function buildAppPointerPayload({ type, screenPosition, groundPoint, keyState, ray, eventSource, tapId, }) {
    const payload = {
        type,
        screen_position: { x: screenPosition.x, y: screenPosition.y },
        galaxy_position: { x: groundPoint.x, z: groundPoint.z },
        key_state: {
            altKey: keyState.altKey,
            ctrlKey: keyState.ctrlKey,
            shiftKey: keyState.shiftKey,
            metaKey: keyState.metaKey,
        },
        ray,
    };
    if (eventSource !== undefined) {
        payload.eventSource = eventSource;
    }
    if (tapId !== undefined) {
        payload.tapId = tapId;
    }
    return payload;
}
export function shouldPublishPointerTap({ movedDistanceSq, durationMs, isDragging = false, button = null, maxDistanceSq = APP_POINTER_TAP_MAX_DISTANCE_SQ, maxDurationMs = APP_POINTER_TAP_MAX_DURATION_MS, }) {
    return ((button === null || button === 0) &&
        movedDistanceSq < maxDistanceSq &&
        durationMs < maxDurationMs &&
        !isDragging);
}
export function createAppPointerTapId(source, now, randomValue) {
    return `${source}_${now}_${randomValue.toString(36).slice(2, 11)}`;
}
export function resolveTouchScreenPosition(event) {
    const changedTouches = event.changedTouches;
    const touches = event.touches;
    const source = changedTouches && changedTouches.length > 0 ? changedTouches : touches;
    const touch = source && source.length > 0 ? source[0] : null;
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
}
//# sourceMappingURL=app-pointer-events.js.map