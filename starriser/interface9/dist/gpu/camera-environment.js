/** Browser bindings for the same camera core used by the render worker. */
import { ControlsManager } from "../controls-manager.js";
export function browserCameraEnvironment(canvas) {
    if (!("style" in canvas))
        throw new Error("Offscreen camera requires an explicit environment");
    const manager = ControlsManager.getInstance();
    return {
        controls: manager,
        setCursor: (cursor) => { canvas.style.cursor = cursor; },
        bind: (handlers) => bindBrowserCamera(canvas, handlers),
    };
}
function bindBrowserCamera(canvas, handlers) {
    canvas.addEventListener("wheel", handlers.wheel, { passive: false });
    canvas.addEventListener("dblclick", handlers.doubleClick);
    window.addEventListener("keydown", handlers.keyDown);
    window.addEventListener("keyup", handlers.keyUp);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => handlers.reducedMotion(motion.matches);
    onMotion();
    motion.addEventListener("change", onMotion);
    return () => {
        canvas.removeEventListener("wheel", handlers.wheel);
        canvas.removeEventListener("dblclick", handlers.doubleClick);
        window.removeEventListener("keydown", handlers.keyDown);
        window.removeEventListener("keyup", handlers.keyUp);
        motion.removeEventListener("change", onMotion);
    };
}
//# sourceMappingURL=camera-environment.js.map