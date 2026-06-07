const CLICK_DIST2 = 50 * 50;
const TAP_TIME_MS = 200;
export function createPointerEventRouter({ canvas, cameraController, controlsManager, galaxy, getContextMenuController, publishPointerEvent, }) {
    const cleanup = [];
    const addCanvasListener = (type, handler) => {
        canvas.addEventListener(type, handler);
        cleanup.push(() => {
            canvas.removeEventListener(type, handler);
        });
    };
    const getGroundPoint = (screenX, screenY) => cameraController.getGroundPointFromScreenPosition(screenX, screenY) || {
        x: 0,
        y: 0,
        z: 0,
    };
    const publishScreenEvent = (type, screenX, screenY, extras = {}) => {
        const ground = getGroundPoint(screenX, screenY);
        const pointerRay = cameraController.getPointerRayFromScreenPosition(screenX, screenY);
        publishPointerEvent({
            type,
            screen_position: { x: screenX, y: screenY },
            galaxy_position: { x: ground.x, z: ground.z },
            key_state: controlsManager.getCurrentKeyState(),
            ray: pointerRay,
            ...extras,
        });
    };
    addCanvasListener("mousedown", (event) => {
        if (event.button === 0) {
            getContextMenuController()?.hide();
        }
        // Edit handles are highest-priority and bypass camera/selection routing.
        if (galaxy.handleEditPointerDown(event)) {
            event.preventDefault();
            return;
        }
        cameraController.onMouseDown(event);
        controlsManager.pointerDown(event.clientX, event.clientY);
        if (!cameraController.isDragging) {
            publishScreenEvent("down", event.clientX, event.clientY);
        }
    });
    addCanvasListener("mousemove", (event) => {
        if (galaxy.handleEditPointerMove(event)) {
            event.preventDefault();
            return;
        }
        cameraController.onMouseMove(event);
        controlsManager.pointerMove(event.clientX, event.clientY);
        publishScreenEvent("move", event.clientX, event.clientY);
    });
    addCanvasListener("mouseup", (event) => {
        if (galaxy.handleEditPointerUp(event)) {
            event.preventDefault();
            return;
        }
        cameraController.onMouseUp(event);
        controlsManager.pointerUp(event.clientX, event.clientY);
        const ground = getGroundPoint(event.clientX, event.clientY);
        const pointerRay = cameraController.getPointerRayFromScreenPosition(event.clientX, event.clientY);
        publishPointerEvent({
            type: "up",
            screen_position: { x: event.clientX, y: event.clientY },
            galaxy_position: { x: ground.x, z: ground.z },
            key_state: controlsManager.getCurrentKeyState(),
            ray: pointerRay,
        });
        const upTime = Date.now();
        const pointerDownTime = controlsManager.getPointerDownTimestamp() || upTime;
        const dur = upTime - pointerDownTime;
        const movedDist = controlsManager.pointerMovedDistanceSq();
        const isDragging = cameraController.isDragging;
        if (event.button === 0 &&
            movedDist < CLICK_DIST2 &&
            dur < TAP_TIME_MS &&
            !isDragging) {
            publishPointerEvent({
                type: "tap",
                eventSource: "selection",
                tapId: `selection_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                screen_position: { x: event.clientX, y: event.clientY },
                galaxy_position: { x: ground.x, z: ground.z },
                key_state: controlsManager.getCurrentKeyState(),
                ray: pointerRay,
            });
        }
        controlsManager.clearPointerDownTimestamp();
    });
    addCanvasListener("touchstart", (event) => {
        getContextMenuController()?.hide();
        if (event.touches && event.touches.length > 0) {
            const touch = event.touches[0];
            controlsManager.pointerDown(touch.clientX, touch.clientY);
            publishScreenEvent("down", touch.clientX, touch.clientY);
        }
    });
    addCanvasListener("touchmove", (event) => {
        if (event.touches && event.touches.length > 0) {
            const touch = event.touches[0];
            controlsManager.pointerMove(touch.clientX, touch.clientY);
            publishScreenEvent("move", touch.clientX, touch.clientY);
        }
    });
    const handleTouchEndOrCancel = (event) => {
        let screenX = 0;
        let screenY = 0;
        let ground = { x: 0, y: 0, z: 0 };
        if ((event.changedTouches && event.changedTouches.length > 0) ||
            (event.touches && event.touches.length > 0)) {
            const touch = event.changedTouches && event.changedTouches.length > 0
                ? event.changedTouches[0]
                : event.touches[0];
            screenX = touch.clientX;
            screenY = touch.clientY;
            ground = getGroundPoint(screenX, screenY);
        }
        controlsManager.pointerUp(screenX, screenY);
        const pointerRay = cameraController.getPointerRayFromScreenPosition(screenX, screenY);
        publishPointerEvent({
            type: "up",
            screen_position: { x: screenX, y: screenY },
            galaxy_position: { x: ground.x, z: ground.z },
            key_state: controlsManager.getCurrentKeyState(),
            ray: pointerRay,
        });
        const upTime = Date.now();
        const pointerDownTime = controlsManager.getPointerDownTimestamp() || upTime;
        const dur = upTime - pointerDownTime;
        if (controlsManager.pointerMovedDistanceSq() < CLICK_DIST2 && dur < TAP_TIME_MS) {
            publishPointerEvent({
                type: "tap",
                eventSource: "touch",
                tapId: `touch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                screen_position: { x: screenX, y: screenY },
                galaxy_position: { x: ground.x, z: ground.z },
                key_state: controlsManager.getCurrentKeyState(),
                ray: pointerRay,
            });
        }
        controlsManager.clearPointerDownTimestamp();
    };
    addCanvasListener("touchend", handleTouchEndOrCancel);
    addCanvasListener("touchcancel", handleTouchEndOrCancel);
    addCanvasListener("contextmenu", (event) => {
        const contextMenuController = getContextMenuController();
        if (!contextMenuController)
            return;
        event.preventDefault();
        event.stopPropagation();
        const pick = contextMenuController.pickAndShow(event.clientX, event.clientY);
        if (!pick)
            return;
        const pointerRay = cameraController.getPointerRayFromScreenPosition(event.clientX, event.clientY);
        publishPointerEvent({
            type: "tap",
            eventSource: "context",
            screen_position: { x: event.clientX, y: event.clientY },
            galaxy_position: { x: pick.ground.x, z: pick.ground.z },
            key_state: controlsManager.getCurrentKeyState(),
            ray: pointerRay,
        });
    });
    return {
        dispose() {
            while (cleanup.length) {
                cleanup.pop()?.();
            }
        },
    };
}
//# sourceMappingURL=pointer-event-router.js.map