/** Parse the platform usage names, accepting the existing pipe/hyphen syntax. */
export function parseGpuBufferUsage(usage) {
    let bits = 0;
    for (const raw of (usage ?? "").split("|")) {
        const key = raw.trim().toUpperCase().replace(/-/g, "_");
        if (!key)
            continue;
        const flag = GPUBufferUsage[key];
        if (typeof flag !== "number")
            throw new Error(`Unknown GPU buffer usage flag: "${raw.trim()}"`);
        bits |= flag;
    }
    return bits || (GPUBufferUsage.COPY_DST | GPUBufferUsage.VERTEX);
}
/** Owns buffer handles and validates byte ranges before GPU queue submission. */
export function createGpuBufferDevice(device, context, bootstrapState) {
    let nextBufferId = 1;
    const buffers = new Map();
    const gpu = {
        createBuffer(params) {
            if (bootstrapState.isLost) {
                throw new Error("createBuffer: device is lost");
            }
            const usage = parseGpuBufferUsage(params.usage);
            let buffer;
            try {
                buffer = device.createBuffer({
                    label: params.label,
                    size: params.size,
                    usage,
                });
            }
            catch (err) {
                // OOM / invalid size often surfaces as device loss shortly after.
                bootstrapState.isLost = true;
                throw err;
            }
            const id = nextBufferId++;
            buffers.set(id, buffer);
            return { id, byteLength: params.size };
        },
        getBuffer(handle) {
            const buffer = buffers.get(handle.id);
            if (!buffer) {
                throw new Error(`getBuffer: unknown buffer id ${handle.id}`);
            }
            return buffer;
        },
        writeBuffer(handle, bufferOffsetBytes, data, dataOffsetBytes = 0, sizeBytes) {
            if (bootstrapState.isLost) {
                // Soft no-op: bulk reserve / trail dead-init must not throw through
                // App handlers and abort the whole generateFleetsBulk turn.
                return;
            }
            const buffer = buffers.get(handle.id);
            if (!buffer) {
                throw new Error(`writeBuffer: unknown buffer id ${handle.id}`);
            }
            const byteLength = validateWriteRange(handle, bufferOffsetBytes, data, dataOffsetBytes, sizeBytes);
            device.queue.writeBuffer(buffer, bufferOffsetBytes, data.buffer, data.byteOffset + dataOffsetBytes, byteLength);
        },
        destroyBuffer(handle) {
            const buffer = buffers.get(handle.id);
            if (!buffer)
                return;
            buffer.destroy();
            buffers.delete(handle.id);
        },
        destroy() {
            for (const buffer of buffers.values())
                buffer.destroy();
            buffers.clear();
            // Context must be unconfigured before device.destroy per WebGPU rules.
            try {
                context.unconfigure();
            }
            catch {
                /* ignore if already unconfigured */
            }
            bootstrapState.isLost = true;
            device.destroy();
        },
    };
    return gpu;
}
function validateWriteRange(handle, bufferOffsetBytes, data, dataOffsetBytes, sizeBytes) {
    const byteLength = sizeBytes ?? data.byteLength - dataOffsetBytes;
    validateAlignedRange(bufferOffsetBytes, dataOffsetBytes, byteLength);
    if (bufferOffsetBytes + byteLength > handle.byteLength) {
        throw new Error(`writeBuffer: range [${bufferOffsetBytes}, ${bufferOffsetBytes + byteLength}) exceeds buffer size ${handle.byteLength}`);
    }
    if (dataOffsetBytes + byteLength > data.byteLength) {
        throw new Error(`writeBuffer: range exceeds data view (dataOffset=${dataOffsetBytes}, size=${byteLength}, data.byteLength=${data.byteLength})`);
    }
    return byteLength;
}
function validateAlignedRange(bufferOffsetBytes, dataOffsetBytes, byteLength) {
    if (bufferOffsetBytes < 0 || dataOffsetBytes < 0 || byteLength < 0) {
        throw new Error("writeBuffer: negative offset or size");
    }
    if (bufferOffsetBytes % 4 !== 0 || dataOffsetBytes % 4 !== 0 || byteLength % 4 !== 0) {
        throw new Error(`writeBuffer: offsets/size must be multiples of 4 (offset=${bufferOffsetBytes}, dataOffset=${dataOffsetBytes}, size=${byteLength})`);
    }
}
//# sourceMappingURL=device-buffers.js.map