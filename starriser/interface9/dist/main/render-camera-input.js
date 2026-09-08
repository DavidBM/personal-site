import { renderGroundPoint, renderPointerRay } from "./render-picking.js";
/** Local drag ownership is immediate; camera math and easing run only in worker. */
export function createRenderCameraInput(client, controls, clearFocus = () => client.send({ type: "clearFocus" })) {
    const canvas = client.canvas;
    let dragging = false;
    const position = (event) => {
        const rect = canvas.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const pointer = (type, event) => {
        client.send({ type: "input", input: { type, ...position(event), button: event.button } });
    };
    const wheel = (event) => {
        event.preventDefault();
        client.send({ type: "input", input: {
                type: "wheel", ...position(event), deltaY: event.deltaY, deltaMode: event.deltaMode,
            } });
    };
    const doubleClick = (event) => {
        clearFocus();
        pointer("doubleClick", event);
    };
    const key = (type, event) => {
        if (event.key === "Escape") {
            if (type === "keyDown" && !event.repeat)
                clearFocus();
            return;
        }
        if (event.key === "F1") {
            event.preventDefault();
            if (type === "keyDown" && !event.repeat)
                client.send({ type: "followRandomShip" });
            return;
        }
        client.send({ type: "input", input: { type, key: event.key, code: event.code } });
    };
    const down = (event) => key("keyDown", event);
    const up = (event) => key("keyUp", event);
    const blur = () => {
        dragging = false;
        client.send({ type: "input", input: { type: "up", x: 0, y: 0, button: 0 } });
        client.send({ type: "input", input: { type: "keyUp", key: "Control", code: "ControlLeft" } });
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("dblclick", doubleClick);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return {
        get isDragging() { return dragging; },
        onMouseDown(event) {
            if (event.button !== 0 || controls.isEditModeActive())
                return;
            dragging = true;
            canvas.style.cursor = "grabbing";
            pointer("down", event);
            event.preventDefault();
        },
        onMouseMove(event) { pointer("move", event); },
        onMouseUp(event) {
            if (event.button !== 0)
                return;
            dragging = false;
            canvas.style.cursor = "grab";
            pointer("up", event);
        },
        getGroundPointFromScreenPosition(x, y) {
            const camera = client.snapshot()?.camera;
            const rect = canvas.getBoundingClientRect();
            return camera ? renderGroundPoint(camera, x - rect.left, y - rect.top) : null;
        },
        getPointerRayFromScreenPosition(x, y) {
            const camera = client.snapshot()?.camera;
            const rect = canvas.getBoundingClientRect();
            if (!camera)
                return { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: -1, z: 0 } };
            return renderPointerRay(camera, x - rect.left, y - rect.top);
        },
        getZoomLevel() { return client.snapshot()?.camera.eyeY ?? null; },
        focusOnPoint(x, z, height) { client.send({ type: "focusPoint", x, z, height }); },
        dispose() {
            blur();
            canvas.removeEventListener("wheel", wheel);
            canvas.removeEventListener("dblclick", doubleClick);
            window.removeEventListener("keydown", down);
            window.removeEventListener("keyup", up);
            window.removeEventListener("blur", blur);
        },
    };
}
//# sourceMappingURL=render-camera-input.js.map