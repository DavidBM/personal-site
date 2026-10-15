import { featureRequest } from '../features/http-worker/client.js';
export function createOnlineJourneyScene(options) {
    const channel = new MessageChannel(), owner = new AbortController();
    let world = '', epoch = 0n, version = 0, started = false, authorized = false;
    const send = (value) => channel.port1.postMessage(value);
    function scope() { send({ type: 'scope', version: ++version, scope: authorized && world && epoch > 0n ? { worldId: world, visibilityEpoch: String(epoch) } : undefined }); }
    function start() { if (started)
        return; started = true; void featureRequest('journeyScene', [channel.port2], owner.signal, [channel.port2]).catch(e => { if (!owner.signal.aborted)
        options.error(e.message); }); }
    channel.port1.onmessage = ({ data }) => {
        if (owner.signal.aborted || data.version !== version)
            return;
        const v = data.value;
        if (v.type === 'error') {
            options.error(v.message);
            return;
        }
        const value = v.type === 'journey' ? v.value : undefined;
        const node = (id) => { const row = v.type === 'journey' ? v.nodes.find(n => n[0] === id) : undefined; return row ? options.node(row[0], row[1]) : undefined; };
        const position = (id) => { const row = v.type === 'journey' ? v.nodes.find(n => n[0] === id) : undefined; return row ? { x: row[2], y: 0, z: row[3] } : undefined; };
        const stamp = version;
        void options.renderer.query({ type: 'remoteJourney', generation: options.generation, fleetId: v.type === 'remove' ? v.id : undefined, value: value && {
                fleetId: value.fleetId, journeyId: value.journeyId, revision: value.revision, completedLegs: value.completedLegs, serverNowMs: value.serverNowMs,
                phase: value.phase.phase, sourcePosition: position(value.currentSystem), destinationPosition: position(value.destinationSystem), source: node(value.currentSystem), destination: node(value.destinationSystem), destinationSystem: value.destinationSystem, arrivalPosition: value.arrivalPosition,
                ...(value.phase.phase === 'transit' ? { departureMs: value.phase.departureMs, arrivalMs: value.phase.arrivalMs } : {})
            } }).then(reply => { if (!owner.signal.aborted && stamp === version) {
            const arrived = reply.journeyArrival;
            if (arrived)
                options.arrival?.(arrived);
        } }).catch(e => { if (!owner.signal.aborted && stamp === version)
            options.error(`Journey scene: ${e.message}`); });
    };
    channel.port1.start();
    function acceptedToken(s) {
        const t = s.displayed;
        return s.state === 'ready' && !s.stale && t?.connection === options.generation && t.request === s.requestedGeneration && t.epoch >= epoch ? t : undefined;
    }
    function changed(s) {
        const t = acceptedToken(s);
        if (!t) {
            if (s.slot === 'detail')
                send({ type: 'system' });
            return;
        }
        start();
        if (t.epoch > epoch || !authorized) {
            epoch = t.epoch;
            authorized = true;
            scope();
        }
        if (s.slot === 'detail' && s.requested?.kind === 'detail')
            send({ type: 'system', system: s.requested.systemId });
    }
    function event(e) {
        if ('generation' in e && e.generation !== options.generation)
            return;
        switch (e.type) {
            case 'welcome':
                world = e.worldId;
                epoch = 0n;
                authorized = false;
                scope();
                return;
            case 'viewBarrier':
                if (e.epoch > epoch) {
                    epoch = e.epoch;
                    authorized = false;
                    scope();
                }
                return;
            case 'state':
                if (e.state === 'closed') {
                    world = '';
                    epoch = 0n;
                    authorized = false;
                    scope();
                }
                return;
            case 'viewChanged':
                changed(e.status);
                return;
        }
    }
    return { event, seed(value) { send({ type: 'seed', value }); }, roster(rows) {
            if (!rows.length)
                send({ type: 'roster', rows: [], begin: true, end: true });
            for (let i = 0; i < rows.length; i += 64)
                send({ type: 'roster', begin: i === 0, end: i + 64 >= rows.length, rows: rows.slice(i, i + 64).map(r => [r.id, r.routeVersion ?? '', r.onlineSystemId, r.moving]) });
        }, dispose() { send({ type: 'close' }); owner.abort(); channel.port1.close(); channel.port2.close(); } };
}
//# sourceMappingURL=online-journey-scene.js.map