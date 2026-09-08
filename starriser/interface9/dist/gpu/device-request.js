/** Optional capabilities are retried in order; baseline WebGPU remains required. */
export async function requestDeviceWithFallback(adapter, label) {
    const requiredLimits = buildRequiredLimits(adapter);
    const requiredFeatures = (adapter.features?.has?.("timestamp-query") ? ["timestamp-query"] : []);
    const features = requiredFeatures?.length ? { requiredFeatures } : {};
    const attempts = [
        { label, requiredLimits, ...features },
        { label, ...features },
        { label },
    ];
    let failure;
    for (let i = 0; i < attempts.length; i++) {
        try {
            return await adapter.requestDevice(attempts[i]);
        }
        catch (error) {
            failure = error;
            if (i === 0)
                console.warn("[WebGPU] requestDevice with raised limits failed; retrying defaults.", error);
        }
    }
    const message = failure instanceof Error ? failure.message : String(failure);
    throw new Error(`Galaxy requires WebGPU. requestDevice() failed: ${message}`);
}
/**
 * Raise storage/buffer limits to what this adapter allows so large trail/ship
 * storage buffers can bind. Never request above adapter.limits.
 */
export function buildRequiredLimits(adapter) {
    const out = {};
    const a = adapter.limits;
    // Chromium default storage binding is 128 MiB (134217728).
    const DEFAULT_STORAGE = 134217728;
    const DEFAULT_BUFFER = 268435456;
    if (a.maxStorageBufferBindingSize > DEFAULT_STORAGE) {
        out.maxStorageBufferBindingSize = a.maxStorageBufferBindingSize;
    }
    if (a.maxBufferSize > DEFAULT_BUFFER) {
        out.maxBufferSize = a.maxBufferSize;
    }
    return out;
}
//# sourceMappingURL=device-request.js.map