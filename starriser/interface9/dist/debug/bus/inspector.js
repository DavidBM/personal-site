import { newTrace } from './context.js';
import { createRecorder } from './recorder.js';
/** Development composition owns this lifetime. No polling or observer work is installed on the Bus. */
export function createBusInspector(options) {
    const recorder = createRecorder(options.stages ?? [], options.dependencies ?? [], options.clocks ?? []);
    let mode = 'disabled', disposed = false;
    let configuring, capturing;
    function setMode(value) {
        if (disposed)
            return Promise.reject(new Error('Inspector disposed'));
        if (!['disabled', 'sampled', 'full'].includes(value))
            return Promise.reject(new Error('Invalid trace mode'));
        if (configuring)
            return Promise.reject(new Error('Inspector mode change pending'));
        configuring = options.bus.setServiceTrace({ capacity: value === 'disabled' ? 0 : 1024, sampleEvery: value === 'sampled' ? 16 : 1 })
            .then(() => { if (disposed)
            throw new Error('Inspector disposed'); mode = value; recorder.configure(value); })
            .finally(() => { configuring = undefined; });
        return configuring;
    }
    function snapshot() {
        if (disposed)
            return Promise.reject(new Error('Inspector disposed'));
        return capturing ?? (capturing = options.bus.getServiceGraph().then(graph => {
            if (disposed)
                throw new Error('Inspector disposed');
            return { version: 1, capturedUnixMs: Date.now(), capturedMonotonicMs: performance.now(), mode, brokerClockId: options.brokerClockId,
                graph, ...recorder.snapshot() };
        }).finally(() => { capturing = undefined; }));
    }
    return {
        snapshot, setMode,
        registerClock: (clock) => !disposed && recorder.registerClock(clock),
        beginTrace: () => disposed ? undefined : newTrace(mode),
        record: (span) => { if (!disposed)
            recorder.record(span); },
        dispose() {
            if (disposed)
                return;
            disposed = true;
            void (configuring ?? Promise.resolve()).catch(() => { }).then(() => options.bus.setServiceTrace({ capacity: 0, sampleEvery: 1 })).catch(() => { });
        },
    };
}
//# sourceMappingURL=inspector.js.map