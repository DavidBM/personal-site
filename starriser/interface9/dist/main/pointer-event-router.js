const CLICK_DIST2 = 50 * 50;
const TAP_TIME_MS = 200;
/**
 * Map pointer router — game owns the drag session.
 *
 * Primary-button pan/drag is tracked with **document-level** move/up so:
 * - Moving over HTML UI keeps the drag alive (map still pans/orbits).
 * - Releasing over HTML UI ends the drag the same frame (no stuck drag).
 *
 * Canvas-only listeners miss mouseup when the cursor leaves the canvas
 * onto overlay panels — classic “keeps dragging when I return” bug.
 */
export function createPointerEventRouter({ canvas, cameraController, controlsManager, editHandlePointer, getContextMenuController, publishPointerEvent, }) {
    const cleanup = [];
    /** Active primary map-drag (or edit-handle) owned by document listeners. */
    let mapDragSession = false;
    let editDragSession = false;
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
    const detachDocumentDrag = () => {
        document.removeEventListener("mousemove", onDocumentMouseMove, true);
        document.removeEventListener("mouseup", onDocumentMouseUp, true);
        document.removeEventListener("pointerup", onDocumentPointerUp, true);
        window.removeEventListener("blur", onWindowBlur);
    };
    const attachDocumentDrag = () => {
        // Capture phase so we win over UI stopPropagation when possible.
        document.addEventListener("mousemove", onDocumentMouseMove, true);
        document.addEventListener("mouseup", onDocumentMouseUp, true);
        document.addEventListener("pointerup", onDocumentPointerUp, true);
        window.addEventListener("blur", onWindowBlur);
    };
    function onDocumentMouseMove(event) {
        if (editDragSession) {
            if (editHandlePointer.handleMove(event)) {
                event.preventDefault();
            }
            return;
        }
        if (!mapDragSession && !cameraController.isDragging)
            return;
        cameraController.onMouseMove(event);
        controlsManager.pointerMove(event.clientX, event.clientY);
        // Selection hover while dragging is noisy — skip bus publish on drag move.
    }
    function endDragSession(event, button = 0) {
        const wasEdit = editDragSession;
        const wasMap = mapDragSession || cameraController.isDragging;
        editDragSession = false;
        mapDragSession = false;
        detachDocumentDrag();
        if (wasEdit) {
            if (event) {
                editHandlePointer.handleUp(event);
            }
            return;
        }
        if (!wasMap)
            return;
        if (event) {
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
            // Camera has already cleared isDragging in onMouseUp — use pre-check via wasMap.
            // Only treat as tap if the camera never entered a real drag (short click).
            const stillDragging = cameraController.isDragging;
            if (button === 0 &&
                movedDist < CLICK_DIST2 &&
                dur < TAP_TIME_MS &&
                !stillDragging) {
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
        }
        else {
            // blur / lost capture: force-clear camera drag without a mouse event.
            const fake = {
                button: 0,
                clientX: 0,
                clientY: 0,
                preventDefault() { },
            };
            cameraController.onMouseUp(fake);
            controlsManager.pointerUp(0, 0);
        }
        controlsManager.clearPointerDownTimestamp();
    }
    function onDocumentMouseUp(event) {
        if (!mapDragSession && !editDragSession && !cameraController.isDragging) {
            return;
        }
        endDragSession(event, event.button);
    }
    function onDocumentPointerUp(event) {
        if (!mapDragSession && !editDragSession && !cameraController.isDragging) {
            return;
        }
        // Primary pointer only (mouse left / touch).
        if (event.pointerType === "mouse" && event.button !== 0)
            return;
        endDragSession(event, event.button);
    }
    function onWindowBlur() {
        if (mapDragSession || editDragSession || cameraController.isDragging) {
            endDragSession(null);
        }
    }
    addCanvasListener("mousedown", (event) => {
        // Primary button only for edit-handle capture + left-click selection path.
        // Middle/right still reach camera (pan) via onMouseDown below.
        if (event.button !== 0) {
            cameraController.onMouseDown(event);
            return;
        }
        getContextMenuController()?.hide();
        // Edit handles are highest-priority and bypass camera/selection routing.
        if (editHandlePointer.handleDown(event)) {
            event.preventDefault();
            editDragSession = true;
            attachDocumentDrag();
            return;
        }
        cameraController.onMouseDown(event);
        controlsManager.pointerDown(event.clientX, event.clientY);
        if (cameraController.isDragging) {
            mapDragSession = true;
            attachDocumentDrag();
        }
        else {
            publishScreenEvent("down", event.clientX, event.clientY);
        }
    });
    addCanvasListener("mousemove", (event) => {
        // During document-owned drag, document listener owns move (may be off-canvas).
        if (mapDragSession || editDragSession) {
            return;
        }
        if (editHandlePointer.handleMove(event)) {
            event.preventDefault();
            return;
        }
        cameraController.onMouseMove(event);
        controlsManager.pointerMove(event.clientX, event.clientY);
        publishScreenEvent("move", event.clientX, event.clientY);
    });
    // Canvas mouseup is a fallback only — document listener is authoritative while
    // a drag session is active (covers release over HTML UI).
    addCanvasListener("mouseup", (event) => {
        if (mapDragSession || editDragSession) {
            // Document handler will run (capture); avoid double end if it already cleared.
            if (mapDragSession || editDragSession || cameraController.isDragging) {
                endDragSession(event, event.button);
            }
            return;
        }
        if (editHandlePointer.handleUp(event)) {
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
        // Mirror mouse: edit handles take priority when gizmo is active.
        if (editHandlePointer.handleDown(event)) {
            event.preventDefault();
            editDragSession = true;
            attachDocumentDrag();
            return;
        }
        if (event.touches && event.touches.length > 0) {
            const touch = event.touches[0];
            controlsManager.pointerDown(touch.clientX, touch.clientY);
            publishScreenEvent("down", touch.clientX, touch.clientY);
        }
    });
    addCanvasListener("touchmove", (event) => {
        if (editDragSession)
            return;
        if (editHandlePointer.handleMove(event)) {
            event.preventDefault();
            return;
        }
        if (event.touches && event.touches.length > 0) {
            const touch = event.touches[0];
            controlsManager.pointerMove(touch.clientX, touch.clientY);
            publishScreenEvent("move", touch.clientX, touch.clientY);
        }
    });
    const handleTouchEndOrCancel = (event) => {
        if (editDragSession) {
            endDragSession(null);
            if (editHandlePointer.handleUp(event)) {
                event.preventDefault();
            }
            return;
        }
        if (editHandlePointer.handleUp(event)) {
            event.preventDefault();
            return;
        }
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
            detachDocumentDrag();
            mapDragSession = false;
            editDragSession = false;
            while (cleanup.length) {
                cleanup.pop()?.();
            }
        },
    };
}
//# sourceMappingURL=pointer-event-router.js.map