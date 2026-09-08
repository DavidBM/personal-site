/** Browser adapter for the worker-safe production camera. */
import { WebGpuCameraController as CameraCore } from "./camera-controller-core.js";
import { browserCameraEnvironment } from "./camera-environment.js";
export class WebGpuCameraController extends CameraCore {
    constructor(view, environment) {
        super(view, environment ?? browserCameraEnvironment(view.canvas));
    }
}
//# sourceMappingURL=webgpu-camera-controls.js.map