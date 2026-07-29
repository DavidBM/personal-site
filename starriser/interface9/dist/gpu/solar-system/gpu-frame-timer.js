/**
 * Measure actual GPU render work for the solar-system showcase HUD.
 *
 * Preferred: pass timestamp queries (timestamp-query feature) → ns between
 * begin/end of the color pass, independent of vsync idle.
 * Fallback: wall time from encode start → queue.onSubmittedWorkDone() with
 * single in-flight sample (includes CPU encode + GPU drain for that submit).
 */
export function createGpuFrameTimer(device) {
    // getTimestampPeriod is missing on some Chromium builds even when
    // timestamp-query is present — default 1 ns/tick (Dawn/common).
    const hasTs = !!device.features?.has?.("timestamp-query") &&
        typeof device.createQuerySet === "function";
    if (hasTs) {
        return createTimestampTimer(device);
    }
    return createSubmitDoneTimer(device);
}
function createTimestampTimer(device) {
    const querySet = device.createQuerySet({
        type: "timestamp",
        count: 2,
        label: "solar-frame-timestamps",
    });
    // 2 × u64
    const resolveBuf = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
        label: "solar-ts-resolve",
    });
    // Double-buffer MAP_READ so we can map while the other is resolving
    const readA = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        label: "solar-ts-read-a",
    });
    const readB = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        label: "solar-ts-read-b",
    });
    let useA = true;
    let mapPending = false;
    /** Buffer that received this frame's resolve copy (map after submit). */
    let pendingRead = null;
    const period = typeof device.queue.getTimestampPeriod === "function"
        ? device.queue.getTimestampPeriod()
        : 1;
    return {
        usesTimestamps: true,
        passTimestampWrites() {
            return {
                querySet,
                beginningOfPassWriteIndex: 0,
                endOfPassWriteIndex: 1,
            };
        },
        resolve(encoder) {
            if (typeof encoder.resolveQuerySet !== "function")
                return;
            // Skip if previous map still open — avoid COPY_DST while MAP_READ mapped
            if (mapPending) {
                pendingRead = null;
                return;
            }
            encoder.resolveQuerySet(querySet, 0, 2, resolveBuf, 0);
            const dest = useA ? readA : readB;
            useA = !useA;
            encoder.copyBufferToBuffer(resolveBuf, 0, dest, 0, 16);
            pendingRead = dest;
        },
        afterSubmit(onSample) {
            const dest = pendingRead;
            pendingRead = null;
            if (!dest || mapPending)
                return;
            mapPending = true;
            dest
                .mapAsync(GPUMapMode.READ)
                .then(() => {
                const arr = new BigUint64Array(dest.getMappedRange());
                const t0 = arr[0];
                const t1 = arr[1];
                dest.unmap();
                mapPending = false;
                // Unsigned wrap-safe delta
                const ticks = t1 >= t0 ? t1 - t0 : t1 + (0xffffffffffffffffn - t0) + 1n;
                const ms = (Number(ticks) * period) / 1e6;
                if (Number.isFinite(ms) && ms >= 0 && ms < 5000) {
                    onSample(ms);
                }
            })
                .catch(() => {
                mapPending = false;
                try {
                    dest.unmap();
                }
                catch {
                    /* already unmapped */
                }
            });
        },
        destroy() {
            querySet.destroy();
            resolveBuf.destroy();
            readA.destroy();
            readB.destroy();
        },
    };
}
function createSubmitDoneTimer(device) {
    let encodeStartedAt = 0;
    /** Cap concurrent settle promises so a hung backend cannot queue forever. */
    let pending = 0;
    const MAX_PENDING = 3;
    return {
        usesTimestamps: false,
        passTimestampWrites() {
            // Mark encode start when pass is about to begin (caller still uses this hook)
            encodeStartedAt = performance.now();
            return undefined;
        },
        resolve() {
            /* no-op */
        },
        afterSubmit(onSample) {
            if (!(encodeStartedAt > 0))
                encodeStartedAt = performance.now();
            const t0 = encodeStartedAt;
            encodeStartedAt = 0;
            if (pending >= MAX_PENDING) {
                // Drop sample rather than pile up; next frames will measure again
                return;
            }
            pending++;
            const done = device.queue.onSubmittedWorkDone?.();
            const finish = (ms) => {
                pending = Math.max(0, pending - 1);
                if (Number.isFinite(ms) && ms >= 0 && ms < 5000) {
                    onSample(ms);
                }
            };
            if (!done) {
                finish(performance.now() - t0);
                return;
            }
            // Race GPU drain against a timeout so flaky onSubmittedWorkDone cannot
            // leave the HUD permanently at 0. Software adapters (SwiftShader) can
            // exceed 200ms on heavy planet frames — allow up to 2s.
            const timeoutMs = 2000;
            let settled = false;
            const timer = setTimeout(() => {
                if (settled)
                    return;
                settled = true;
                finish(performance.now() - t0);
            }, timeoutMs);
            done
                .then(() => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                finish(performance.now() - t0);
            })
                .catch(() => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                finish(performance.now() - t0);
            });
        },
        destroy() {
            /* nothing */
        },
    };
}
//# sourceMappingURL=gpu-frame-timer.js.map