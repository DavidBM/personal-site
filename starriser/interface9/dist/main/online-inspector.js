import { createBusInspector } from '../debug/bus/inspector.js';
import { exposeBusInspector } from '../debug/bus/bridge.js';
import { GAME_STAGES, GAME_DEPENDENCIES } from '../debug/game-stages.js';
import { workerClock } from '../debug/worker-traces.js';
/** Opt-in composition: metadata queries happen only when the real viewer pulls.
 * The inspector has no command, network or renderer lifetime authority. */
export function createOnlineInspector(app) {
    const clock = workerClock('main');
    const inspector = createBusInspector({ bus: app.mainBus, brokerClockId: `broker:${crypto.randomUUID()}`,
        stages: GAME_STAGES, dependencies: GAME_DEPENDENCIES, clocks: [clock] });
    let dropped = 0, closed = false, capturing;
    let progress = [];
    function acceptResult(result) {
        const value = result.status === 'fulfilled' ? result.value : undefined;
        if (value && typeof value === 'object' && 'kind' in value && value.kind === 'diagnostics')
            accept(value);
        else
            dropped++;
    }
    function accept(value) {
        if (closed)
            return;
        if (value.clocks.length > 32 || value.spans.length > 256) {
            dropped++;
            return;
        }
        for (const clock of value.clocks)
            inspector.registerClock(clock);
        for (const span of value.spans)
            inspector.record(span);
        dropped += value.dropped;
        if (value.progress)
            progress.push(value.progress);
    }
    async function collect() {
        progress = [];
        const session = app.online, renderer = app.renderClient;
        if (!session || !renderer)
            return;
        const results = await Promise.allSettled([
            session.takeDiagnostics(), renderer.query({ type: 'projectionDiagnostics' }),
        ]);
        if (closed || app.online !== session)
            return;
        for (const result of results)
            acceptResult(result);
    }
    function snapshot() {
        return capturing ?? (capturing = collect().then(() => inspector.snapshot())
            .then(value => ({ ...value, rejected: value.rejected + dropped, projectionProgress: progress }))
            .finally(() => { capturing = undefined; }));
    }
    const source = { snapshot, setMode: inspector.setMode };
    const viewer = exposeBusInspector(source);
    const button = document.createElement('button');
    button.textContent = 'Inspect services';
    button.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:20;padding:8px';
    button.addEventListener('click', () => viewer.open());
    document.body.append(button);
    return {
        ...source, open: viewer.open,
        async command(commandId, send) {
            // Diagnostic identity creation is best effort. A missing inspector must
            // never prevent submission of the already captured player intent.
            let context;
            try {
                if (!closed)
                    context = inspector.beginTrace();
            }
            catch {
                dropped++;
            }
            const startedMs = context ? performance.now() : 0;
            function finish(status, code) {
                if (!context)
                    return;
                inspector.record({ stage: 'ui.intent', context, clockId: clock.id, startedMs,
                    durationMs: performance.now() - startedMs, commandId, status, code });
            }
            try {
                const receipt = await send(context);
                finish(receipt.result.case === 'accepted' ? 'ok' : receipt.result.case === 'rejected' ? 'error' : 'unknown', receipt.result.case);
                return receipt;
            }
            catch (error) {
                finish('error', 'submission_failed');
                throw error;
            }
        },
        dispose() { if (closed)
            return; closed = true; button.remove(); viewer.dispose(); inspector.dispose(); },
    };
}
//# sourceMappingURL=online-inspector.js.map