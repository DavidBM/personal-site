export const INSPECTOR_CONNECT = 'galaxy.bus-inspector.connect.v1';
/** One pull request at a time, at most five snapshots/second. Slow viewers never gate gameplay. */
export function serveInspector(port, source) {
    let closed = false, busy = false, lastSnapshot = -Infinity, dropped = 0;
    const lifetime = new AbortController();
    function send(value) {
        if (closed)
            return;
        try {
            port.postMessage(value);
        }
        catch {
            dropped++;
            dispose();
        }
    }
    async function receive(event) {
        if (closed)
            return;
        if (busy) {
            dropped++;
            return;
        }
        const request = event.data;
        if (request?.type !== 'snapshot' && request?.type !== 'mode') {
            dropped++;
            return;
        }
        busy = true;
        try {
            if (request.type === 'mode') {
                await boundedRequest(source.setMode(request.mode), lifetime.signal);
                send({ type: 'mode', mode: request.mode });
            }
            else if (performance.now() - lastSnapshot >= 200) {
                lastSnapshot = performance.now();
                send({ type: 'snapshot', value: await boundedRequest(source.snapshot(), lifetime.signal) });
            }
            else {
                dropped++;
                send({ type: 'error', message: 'Inspector snapshot rate limit' });
            }
        }
        catch {
            dropped++;
            send({ type: 'error', message: 'Diagnostics unavailable; game delivery is independent' });
        }
        finally {
            busy = false;
        }
    }
    function dispose() {
        if (closed)
            return;
        closed = true;
        lifetime.abort();
        port.removeEventListener('message', receive);
        port.removeEventListener('messageerror', dispose);
        port.close();
    }
    port.addEventListener('message', receive);
    port.addEventListener('messageerror', dispose);
    port.start();
    return { dispose, inspect: () => ({ closed, busy, dropped }) };
}
function boundedRequest(work, signal) {
    return new Promise((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', stop); };
        const stop = () => { cleanup(); reject(new Error('Inspector request ended')); };
        const timer = setTimeout(stop, 4000);
        signal.addEventListener('abort', stop, { once: true });
        if (signal.aborted)
            stop();
        void work.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    });
}
/** Called only by the opt-in application composition; the viewer owns no App or Bus. */
export function exposeBusInspector(source) {
    let viewer = null, disconnect = () => { }, closed = false;
    const name = `galaxy-bus-inspector-${crypto.randomUUID()}`;
    function connect(event) {
        if (closed || !viewer || event.source !== viewer || event.origin !== location.origin)
            return;
        if (event.data?.type !== INSPECTOR_CONNECT || event.ports.length !== 1)
            return;
        disconnect();
        disconnect = serveInspector(event.ports[0], source).dispose;
    }
    window.addEventListener('message', connect);
    return {
        open() {
            if (closed)
                return null;
            viewer = window.open('/bus-inspector.html', name);
            viewer?.focus();
            return viewer;
        },
        dispose() { if (closed)
            return; closed = true; disconnect(); window.removeEventListener('message', connect); viewer = null; },
    };
}
//# sourceMappingURL=bridge.js.map