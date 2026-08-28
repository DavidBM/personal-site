/**
 * GPU → CPU buffer readback via MAP_READ staging.
 *
 * Shared by production debug paths and browser ε-harness tests so both use the
 * exact same copy/map sequence (no dual implementations).
 *
 * `src` must include COPY_SRC. Staging is destroyed after unmap.
 *
 * Texture color uses {@link readGpuTextureRgba8}: copyTextureToBuffer into a
 * COPY_SRC buffer, then this same MAP_READ path (no second renderer).
 */
/** WebGPU copyTextureToBuffer bytesPerRow alignment. */
export const TEXTURE_COPY_BYTES_PER_ROW_ALIGNMENT = 256;
/** bytesPerRow for an 8-bit 4-channel texture copy (256-aligned). */
export function textureCopyBytesPerRow(width, bytesPerPixel = 4) {
    const w = width | 0;
    const bpp = bytesPerPixel | 0;
    if (w <= 0 || bpp <= 0) {
        throw new Error(`textureCopyBytesPerRow: width/bytesPerPixel must be > 0 (w=${width}, bpp=${bytesPerPixel})`);
    }
    const raw = w * bpp;
    return (Math.ceil(raw / TEXTURE_COPY_BYTES_PER_ROW_ALIGNMENT) *
        TEXTURE_COPY_BYTES_PER_ROW_ALIGNMENT);
}
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
/**
 * Copy a 2D 8-bit 4-channel texture into tight RGBA8 via MAP_READ staging.
 * `src` must include COPY_SRC. Does not re-encode — copies stored texels.
 */
export async function readGpuTextureRgba8(device, src, opts) {
    const texW = (opts?.width ?? src.width ?? 0) | 0;
    const texH = (opts?.height ?? src.height ?? 0) | 0;
    const format = opts?.format ?? src.format ?? "rgba8unorm";
    const originX = Math.max(0, opts?.originX ?? 0) | 0;
    const originY = Math.max(0, opts?.originY ?? 0) | 0;
    const width = Math.max(1, (opts?.copyWidth ?? texW - originX) | 0);
    const height = Math.max(1, (opts?.copyHeight ?? texH - originY) | 0);
    if (texW <= 0 || texH <= 0) {
        throw new Error(`readGpuTextureRgba8: invalid texture size ${texW}x${texH}`);
    }
    if (originX + width > texW || originY + height > texH) {
        throw new Error(`readGpuTextureRgba8: copy ${width}x${height} at ${originX},${originY} exceeds ${texW}x${texH}`);
    }
    const bytesPerRow = textureCopyBytesPerRow(width, 4);
    const byteLength = bytesPerRow * height;
    const gpuCopy = device.createBuffer({
        label: "texture-readback-copy",
        size: byteLength,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    try {
        const encoder = device.createCommandEncoder({
            label: "texture-readback-copy",
        });
        encoder.copyTextureToBuffer({ texture: src, origin: { x: originX, y: originY, z: 0 } }, { buffer: gpuCopy, bytesPerRow, rowsPerImage: height }, { width, height, depthOrArrayLayers: 1 });
        device.queue.submit([encoder.finish()]);
        const packed = await readGpuBuffer(device, gpuCopy, 0, byteLength);
        const srcBytes = new Uint8Array(packed);
        const rgba = new Uint8Array(width * height * 4);
        const bgra = format.startsWith("bgra");
        for (let y = 0; y < height; y++) {
            const srcRow = y * bytesPerRow;
            const dstRow = y * width * 4;
            for (let x = 0; x < width; x++) {
                const s = srcRow + x * 4;
                const d = dstRow + x * 4;
                const b0 = srcBytes[s];
                const g0 = srcBytes[s + 1];
                const r0 = srcBytes[s + 2];
                const a0 = srcBytes[s + 3];
                if (bgra) {
                    rgba[d] = r0;
                    rgba[d + 1] = g0;
                    rgba[d + 2] = b0;
                    rgba[d + 3] = a0;
                }
                else {
                    rgba[d] = b0;
                    rgba[d + 1] = g0;
                    rgba[d + 2] = r0;
                    rgba[d + 3] = a0;
                }
            }
        }
        return { width, height, rgba, format };
    }
    finally {
        gpuCopy.destroy();
    }
}
//# sourceMappingURL=buffer-readback.js.map