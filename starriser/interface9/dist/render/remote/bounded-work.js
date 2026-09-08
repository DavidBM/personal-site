/** Yield packing/retirement without requiring the render loop to be running. */
function nextTask(signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(new Error('Projection packing aborted')); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 0);
        signal.addEventListener('abort', abort, { once: true });
    });
}
export async function runBounded(items, apply, signal, flush) {
    await nextTask(signal);
    let count = 0, started = performance.now();
    for (const item of items) {
        signal.throwIfAborted();
        apply(item);
        if (++count >= 256 || performance.now() - started >= 4) {
            flush?.();
            await nextTask(signal);
            count = 0;
            started = performance.now();
        }
    }
    flush?.();
}
//# sourceMappingURL=bounded-work.js.map