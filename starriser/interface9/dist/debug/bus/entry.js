import { INSPECTOR_CONNECT } from './bridge.js';
import { exportOtlp } from './export.js';
import { renderInspection } from './view.js';
const status = document.querySelector('#status');
const port = new MessageChannel();
let snapshot, previous;
let timer, deadline;
let pending = false, closed = false;
function filters() {
    const value = (id) => document.querySelector(`#${id}`).value.trim();
    return { service: value('service'), contract: value('contract'), traceId: value('trace'), commandId: value('command') };
}
function redraw() { if (snapshot)
    renderInspection(snapshot, filters(), previous); }
function request(value) {
    if (closed || pending)
        return;
    clearTimeout(timer);
    pending = true;
    deadline = setTimeout(() => { status.textContent = 'Inspector connection timed out. Reopen it from the running game.'; dispose(); }, 6000);
    port.port1.postMessage(value);
}
function receive(event) {
    if (closed || !pending)
        return;
    clearTimeout(deadline);
    pending = false;
    if (event.data?.type === 'snapshot') {
        previous = snapshot;
        snapshot = event.data.value;
        document.querySelector('#mode').value = snapshot.mode;
        status.textContent = `Live application snapshot · ${new Date(snapshot.capturedUnixMs).toLocaleTimeString()}`;
        redraw();
    }
    else if (event.data?.type === 'error')
        status.textContent = event.data.message;
    timer = setTimeout(() => request({ type: 'snapshot' }), 1000);
}
function download(value, filename) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}
function dispose() { closed = true; clearTimeout(timer); clearTimeout(deadline); port.port1.close(); }
port.port1.addEventListener('message', receive);
port.port1.addEventListener('messageerror', dispose);
port.port1.start();
document.querySelector('#filters').addEventListener('input', redraw);
document.querySelector('#filters').addEventListener('submit', event => event.preventDefault());
document.querySelector('#mode').addEventListener('change', event => request({ type: 'mode', mode: event.target.value }));
document.querySelector('#snapshot-export').addEventListener('click', () => { if (snapshot)
    download(snapshot, 'galaxy-diagnostics.json'); });
document.querySelector('#otlp-export').addEventListener('click', () => {
    if (!snapshot)
        return;
    const result = exportOtlp(snapshot, filters());
    status.textContent = `OTLP export: ${result.excludedWithoutClockAnchor} spans omitted because their clock has no epoch anchor.`;
    download(result.data, 'galaxy-traces.otlp.json');
});
window.addEventListener('pagehide', dispose, { once: true });
if (window.opener) {
    window.opener.postMessage({ type: INSPECTOR_CONNECT }, location.origin, [port.port2]);
    request({ type: 'snapshot' });
}
else {
    status.textContent = 'Open this inspector from the developer controls in a running game.';
    dispose();
}
//# sourceMappingURL=entry.js.map