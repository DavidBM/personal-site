/** Browser surface adapter. Production App uses the same core in a dedicated worker. */
import { WebGpuMapView as MapCore } from "./map-renderer-core.js";
import { enableFrameDebug } from "./frame-debug.js";
import { readBrowserFrameDebug } from "../main/browser-frame-debug.js";
export class WebGpuMapView extends MapCore {
    static async create(options) {
        const canvas = document.createElement("canvas");
        Object.assign(canvas.style, {
            display: "block", position: "fixed", inset: "0", width: "100%", height: "100%",
            touchAction: "none", zIndex: "0",
        });
        options.container.appendChild(canvas);
        enableFrameDebug(readBrowserFrameDebug());
        let onResize = () => { };
        try {
            const view = await MapCore.createForSurface(canvas, {
                width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1,
                fovyDeg: options.fovyDeg, skipShipModel: options.skipShipModel,
                onDispose: () => { window.removeEventListener("resize", onResize); canvas.remove(); },
            });
            onResize = () => view.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
            window.addEventListener("resize", onResize);
            return view;
        }
        catch (error) {
            canvas.remove();
            throw error;
        }
    }
}
//# sourceMappingURL=webgpu-map-view.js.map