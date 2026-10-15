import { featureRequest } from '../features/http-worker/client.js';
/** Main only maps stable render handles and relays bounded display observations. */
export function createOnlineMapLayers(options) {
    const channel = new MessageChannel(), lifetime = new AbortController();
    let home, epoch = 0n, scopeGeneration = 0;
    const send = (value) => channel.port1.postMessage(value);
    channel.port1.onmessage = (event) => {
        if (lifetime.signal.aborted || event.data.generation !== scopeGeneration)
            return;
        const value = event.data.value;
        if (value.type === 'reset') {
            options.renderer.send({ type: 'mapColonies', rows: [] });
            options.renderer.send({ type: 'mapRoute', fleetId: '', reset: true });
        }
        if (value.type === 'presence')
            options.renderer.send({ type: 'planetPresence', systemId: value.value ? options.node(value.value.system, value.value.cluster).solarSystemId : undefined, value: value.value });
        if (value.type === 'routesReset')
            options.renderer.send({ type: 'mapRoute', fleetId: '', reset: true });
        if (value.type === 'planets')
            options.renderer.send({ type: 'mapColonies', reset: value.reset, rows: value.rows.map(([body, system, cluster, x, z]) => ({ body, system, cluster, node: options.node(system, cluster), position: [x, 0, z], relationship: 'own' })) });
        if (value.type === 'route')
            options.renderer.send({ type: 'mapRoute', fleetId: value.id, completedLegs: value.completed, path: value.page ? { fleetId: value.id, journeyId: value.page.journeyId, offset: value.page.offset, nodes: value.page.nodes.map(([system, cluster, x, z]) => ({ ...options.node(system, cluster), x, y: 0, z })) } : undefined });
    };
    channel.port1.start();
    void featureRequest('mapLayers', [channel.port2], lifetime.signal, [channel.port2]).catch(() => { });
    function scope() { options.renderer.send({ type: 'planetPresence' }); send({ type: 'scope', generation: ++scopeGeneration, scope: home && epoch > 0n ? { worldId: home.worldId, visibilityEpoch: String(epoch) } : undefined }); }
    function event(value) {
        if ('generation' in value && value.generation !== options.generation)
            return;
        if (value.type === 'welcome') {
            home = value;
            epoch = 0n;
            scope();
        }
        if (value.type === 'viewBarrier') {
            epoch = value.epoch;
            scope();
        }
        if (value.type === 'viewChanged' && value.status.state === 'ready' && !value.status.stale && value.status.displayed && value.status.displayed.epoch > epoch) {
            epoch = value.status.displayed.epoch;
            scope();
        }
        if (value.type === 'viewChanged' && value.status.slot === 'detail') {
            const s = value.status;
            if (s.state !== 'ready' || s.stale)
                options.renderer.send({ type: 'planetPresence' });
            send({ type: 'system', system: s.state === 'ready' && !s.stale && s.requested?.kind === 'detail' ? s.requested.systemId : undefined });
        }
        if (value.type === 'state' && value.state === 'closed') {
            home = undefined;
            epoch = 0n;
            scope();
        }
    }
    return { event, options: (value) => send({ type: 'options', value }), roster(rows) {
            if (!rows.length) {
                send({ type: 'roster', rows: [], begin: true, end: true });
                return;
            }
            for (let n = 0; n < rows.length; n += 64)
                send({ type: 'roster', rows: rows.slice(n, n + 64).map(r => [r.id, r.routeVersion ?? '']), begin: n === 0, end: n + 64 >= rows.length });
        }, dispose() { options.renderer.send({ type: 'planetPresence' }); send({ type: 'close' }); channel.port1.close(); lifetime.abort(); } };
}
//# sourceMappingURL=online-map-layers.js.map