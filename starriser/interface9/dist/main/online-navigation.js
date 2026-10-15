import { sameScope } from '../render/remote/projection-state.js';
function sameDetail(a, b) {
    return !!b && sameScope(a.scope, b.scope) && a.subscriptionId === b.subscriptionId
        && a.streamGeneration === b.streamGeneration;
}
async function prepare(options, current) {
    const lifetime = new AbortController();
    const abort = () => lifetime.abort();
    options.signal.addEventListener('abort', abort, { once: true });
    // Detail revocation may precede a new topology event. Keep only one local
    // cancellation check, with no worker query or queued render command per poll.
    const check = setInterval(() => { if (!current())
        abort(); }, 25);
    if (!current())
        abort();
    try {
        await options.renderer.waitForScenePreparation(lifetime.signal);
    }
    finally {
        clearInterval(check);
        options.signal.removeEventListener('abort', abort);
    }
}
async function waitForDetail(options) {
    const deadline = performance.now() + 20000;
    while (!options.signal.aborted && options.current()) {
        const detail = options.session.received();
        if (detail)
            return detail;
        if (performance.now() >= deadline)
            throw new Error('Fleet details did not become ready');
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Online navigation was superseded');
}
/** Navigation waits for the scene, then the render worker resolves the persistent
 * ID and takes follow ownership atomically. Main never retains a reusable slot. */
export async function followOnlineFleet(options, fleetId) {
    const { renderer, session, node } = options;
    let detail = session.received();
    // Selecting a roster destination acknowledges the request before its first
    // detail baseline arrives. That baseline, not the acknowledgement, is authority.
    if (!detail)
        detail = await waitForDetail(options);
    const current = () => !options.signal.aborted && options.current() && sameDetail(detail, session.received());
    const assertCurrent = () => { if (!current())
        throw new Error('Online navigation was superseded'); };
    function arrived() {
        const state = renderer.snapshot();
        return !!state && !state.director.playing && state.sceneNode?.clusterId === node.clusterId && state.sceneNode?.solarSystemId === node.solarSystemId;
    }
    // Cold shader compilation is a separate renderer lifetime, not camera travel.
    // It settles through preparation/error events even before frames are available.
    await prepare(options, current);
    assertCurrent();
    // The retained UI snapshot can still describe the scene before reconnect.
    // Flush pending renderer commands before deciding whether travel is needed.
    await renderer.query({ type: 'snapshot' }, { signal: options.signal });
    assertCurrent();
    // The director takes camera ownership itself. Clearing an idle follow would
    // create a follow-exit animation that could outlive the director's arrival.
    if (!arrived()) {
        options.navigate();
        // Observe the newly queued director, not its previous idle snapshot.
        await renderer.query({ type: 'snapshot' }, { signal: options.signal });
    }
    const deadline = performance.now() + 5000;
    while (!arrived()) {
        assertCurrent();
        if (renderer.isDeviceLost())
            throw new Error('Render worker is unavailable');
        if (performance.now() >= deadline)
            throw new Error('The fleet system scene did not become ready');
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    assertCurrent();
    const required = session.received();
    if (!required)
        throw new Error('Fleet projection is not ready');
    await renderer.query({ type: options.mode === 'focus' ? 'focusRemoteFleet' : 'followRemoteFleet', id: fleetId, required }, { signal: options.signal });
}
//# sourceMappingURL=online-navigation.js.map