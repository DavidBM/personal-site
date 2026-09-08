export async function measureIsolatedFrame(ports, withGpu, options) {
    assertAvailable(ports);
    const wasRunning = ports.isRunning();
    ports.stop();
    let profiler = null;
    let canResume = true;
    try {
        profiler = withGpu ? ports.createProfiler() : null;
        canResume = false;
        await ports.drain();
        assertAvailable(ports);
        // Once rendering starts, an encode or completion failure stops the loop.
        canResume = false;
        const result = await measureDrained(ports, profiler, options);
        canResume = true;
        return result;
    }
    finally {
        profiler?.dispose();
        if (wasRunning && canResume && !ports.isUnavailable())
            ports.start();
    }
}
async function measureDrained(ports, profiler, options) {
    const started = ports.now();
    const cpuMs = ports.render(profiler ?? undefined, options);
    await ports.drain();
    assertAvailable(ports);
    const endToEndMs = ports.now() - started;
    const gpu = await profiler?.complete() ?? null;
    assertAvailable(ports);
    return { cpuMs, endToEndMs, gpu };
}
function assertAvailable(ports) {
    if (ports.isUnavailable())
        throw new Error("Cannot measure a disposed or lost renderer");
}
//# sourceMappingURL=frame-measurement.js.map