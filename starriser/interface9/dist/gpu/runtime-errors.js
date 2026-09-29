/** Report the first causes, not an unbounded stream of invalid-frame fallout.
 * No polling, GPU waits, error scopes, or per-frame work. Keep browser logging.
 */
export function observeGpuErrors(device, report) {
    const seen = new Set();
    const receive = (event) => {
        if (seen.size >= 3)
            return;
        const error = event.error;
        const message = `${error.constructor.name}: ${error.message}`.slice(0, 4000);
        if (seen.has(message))
            return;
        seen.add(message);
        report(message);
    };
    device.addEventListener('uncapturederror', receive);
    return () => device.removeEventListener('uncapturederror', receive);
}
//# sourceMappingURL=runtime-errors.js.map