import { featureRequest } from '../../features/http-worker/client.js';
/** Input and retained DOM callbacks only. Numeric pages and rasterization stay in the worker. */
export function createWorkerPlanetInspector(observer, canvas, onSelection) {
    const channel = new MessageChannel(), offscreen = canvas.transferControlToOffscreen(), lifetime = new AbortController();
    let tag = 0, closed = false, context;
    channel.port1.onmessage = event => {
        const message = event.data;
        if (closed || message.tag !== tag)
            return;
        if (message.kind === 'selection') {
            onSelection?.(message.args[0]);
            return;
        }
        const callback = observer[message.kind];
        if (typeof callback === 'function')
            callback(...message.args);
    };
    void featureRequest('planetInspector', [channel.port2, offscreen], lifetime.signal, [channel.port2, offscreen]).catch(error => { if (!closed)
        observer.status(error instanceof Error ? error.message : 'Planet worker unavailable'); });
    function send(kind, args = []) { if (!closed)
        channel.port1.postMessage({ kind, args, tag: ++tag }); }
    return {
        setContext(value) { context = value; send('setContext', [value]); },
        suspend() { context = undefined; send('suspend'); }, selectBody: id => send('selectBody', [id]), setField: id => send('setField', [id]), inspect: (x, y) => send('inspect', [x, y]),
        selectPlanet(system, id) { if (context?.systemId !== system || !context.bodies.some(b => b.bodyId === id))
            return false; send('selectPlanet', [system, id]); return true; },
        setLevel: value => send('setLevel', [value]), pan: (x, y) => send('pan', [x, y]), pick: (x, y) => send('pick', [x, y]),
        // Overlay changes do not invalidate pending surface metadata.
        development: value => { if (!closed)
            channel.port1.postMessage({ kind: 'development', args: [value], tag }); },
        footprint: pixels => { if (!closed)
            channel.port1.postMessage({ kind: 'footprint', args: [pixels], tag }); },
        dispose() { if (closed)
            return; send('dispose'); closed = true; context = undefined; channel.port1.close(); lifetime.abort(); },
    };
}
//# sourceMappingURL=worker-client.js.map