/**
 * GPU → CPU buffer readback via MAP_READ staging.
 *
 * Shared by production debug paths and browser ε-harness tests so both use the
 * exact same copy/map sequence (no dual implementations).
 *
 * `src` must include COPY_SRC. Staging is destroyed after unmap.
 */
/**
 * Copy a GPUBuffer range into a CPU ArrayBuffer via MAP_READ staging.
 * Size and offsets must be multiples of 4 (WebGPU write/copy rule).
 * Returns a detached-safe copy (safe after staging is destroyed).
 */
export async function readGpuBuffer(device, src, byteOffset, byteLength) {
    if (!Number.isFinite(byteOffset) || !Number.isFinite(byteLength)) {
        throw new Error(`readGpuBuffer: offset/size must be finite (offset=${byteOffset}, size=${byteLength})`);
    }
    if (byteOffset < 0 || byteLength < 0) {
        throw new Error(`readGpuBuffer: negative offset or size (offset=${byteOffset}, size=${byteLength})`);
    }
    if (byteOffset % 4 !== 0 || byteLength % 4 !== 0) {
        throw new Error(`readGpuBuffer: offset/size must be multiples of 4 (offset=${byteOffset}, size=${byteLength})`);
    }
    // Real GPUBuffers expose `size`; skip fit check only if the ambient type lacks it.
    if (typeof src.size === "number" &&
        byteOffset + byteLength > src.size) {
        throw new Error(`readGpuBuffer: range [${byteOffset}, ${byteOffset + byteLength}) exceeds src.size ${src.size}`);
    }
    if (byteLength === 0) {
        return new ArrayBuffer(0);
    }
    const staging = device.createBuffer({
        label: "buffer-readback-staging",
        size: byteLength,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    try {
        const encoder = device.createCommandEncoder({
            label: "buffer-readback-copy",
        });
        encoder.copyBufferToBuffer(src, byteOffset, staging, 0, byteLength);
        device.queue.submit([encoder.finish()]);
        // mapAsync waits for the submitted copy before resolving.
        await staging.mapAsync(GPUMapMode.READ);
        const mapped = staging.getMappedRange(0, byteLength);
        // Copy before unmap — mapped range is detached on unmap/destroy.
        const out = mapped.slice(0);
        staging.unmap();
        return out;
    }
    catch (err) {
        // Ensure unmap if mapAsync succeeded but slice/unmap failed mid-path.
        try {
            staging.unmap();
        }
        catch {
            /* already unmapped or never mapped */
        }
        throw err;
    }
    finally {
        staging.destroy();
    }
}
/** Convenience: same as {@link readGpuBuffer}, wrapped in a DataView. */
export async function readGpuBufferToDataView(device, src, byteOffset, byteLength) {
    const ab = await readGpuBuffer(device, src, byteOffset, byteLength);
    return new DataView(ab);
}
//# sourceMappingURL=buffer-readback.js.map