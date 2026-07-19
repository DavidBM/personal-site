/**
 * WebGPU-only backend contract (C1).
 *
 * There is no dual WebGL path and no `?gpu=webgl` escape hatch.
 * App always boots WebGPU; call {@link assertWebGpuAvailable} before device init.
 */
/** Single source of truth for sync feature detect (no adapter request). */
export { isWebGpuAvailable } from "./device.js";
import { isWebGpuAvailable } from "./device.js";
/**
 * Throws a clear Chromium-first error when WebGPU is missing.
 * Call early in App setup before requesting an adapter/device.
 */
export function assertWebGpuAvailable() {
    if (isWebGpuAvailable())
        return;
    throw new Error("Galaxy requires WebGPU. Use a Chromium-class browser with navigator.gpu " +
        "(Chrome/Edge 113+, or Firefox Nightly with WebGPU enabled). " +
        "There is no WebGL fallback.");
}
//# sourceMappingURL=preferred-backend.js.map