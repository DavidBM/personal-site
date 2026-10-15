/** A ready wire view can still be waiting for topology attachment or packed
 * projection chunks. Owned rule seeds require the complete projected baseline. */
export async function waitForOnlineDetail(session, initial, systemId, current) {
    const deadline = performance.now() + 20000;
    let status = initial;
    while (true) {
        if (!current() || status.requestedGeneration !== initial.requestedGeneration
            || status.requested?.kind !== 'detail' || status.requested.systemId !== systemId) {
            throw new Error('System selection was superseded');
        }
        if (status.state === 'rejected' || status.state === 'closed')
            throw new Error('System details are unavailable');
        if (status.state === 'ready' && !status.stale && session.received()?.scope.systemId === systemId)
            return;
        if (performance.now() >= deadline)
            throw new Error('System details did not become ready');
        await new Promise(resolve => setTimeout(resolve, 100));
        if (!current())
            throw new Error('System selection was superseded');
        status = await session.viewStatus('detail');
    }
}
/** The replace RPC acknowledges sending, while readiness arrives independently. */
export async function waitForOnlineView(session, initial, signal) {
    const deadline = performance.now() + 20000;
    let status = initial;
    while (true) {
        signal.throwIfAborted();
        if (status.requestedGeneration !== initial.requestedGeneration)
            throw new Error('Map request was superseded');
        if (status.state === 'ready' || status.state === 'closed')
            return;
        if (status.state === 'rejected')
            throw new Error('This map region is unavailable. Zoom closer to request a smaller region.');
        if (performance.now() >= deadline)
            throw new Error('Map loading timed out. Move the map or reconnect to retry.');
        await new Promise(resolve => setTimeout(resolve, 100));
        signal.throwIfAborted();
        status = await session.viewStatus(initial.slot);
    }
}
//# sourceMappingURL=online-view-ready.js.map