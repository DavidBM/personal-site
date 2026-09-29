/** Report the first causes, not an unbounded stream of invalid-frame fallout.
 * No polling, GPU waits, error scopes, or per-frame work. Keep browser logging.
 */
const reporters = new WeakMap();
export function observeGpuErrors(device, report) {
    const seen = new Set();
    const notify = (message) => {
        if (seen.size >= 3)
            return;
        message = message.slice(0, 4000);
        if (seen.has(message))
            return;
        seen.add(message);
        report(message);
    };
    const receive = (event) => {
        const error = event.error;
        notify(`${error.constructor.name}: ${error.message}`);
    };
    reporters.set(device, notify);
    device.addEventListener('uncapturederror', receive);
    return () => { device.removeEventListener('uncapturederror', receive); reporters.delete(device); };
}
/** Synchronous resource setup only. Pop immediately so unrelated async work
 * cannot enter these scopes; attach labels even when the driver message is empty.
 */
export function withGpuResourceDiagnostics(device, label, create) {
    const report = reporters.get(device);
    if (!report)
        return create();
    device.pushErrorScope('out-of-memory');
    device.pushErrorScope('internal');
    device.pushErrorScope('validation');
    try {
        return create();
    }
    finally {
        for (let i = 0; i < 3; i++) {
            void device.popErrorScope().then(error => {
                if (error) {
                    const message = `${label}: ${error.constructor.name}: ${error.message || '(driver supplied no details)'}`;
                    console.error(message);
                    report(message);
                }
            }).catch(error => report(`${label}: GPU error scope failed: ${String(error)}`));
        }
    }
}
//# sourceMappingURL=runtime-errors.js.map