import { drawDevelopment } from '../../main/planet-development/overlay.js';
import { createPlanetInspectorController } from '../../main/planet-inspector/controller.js';
import { paintPlanetSpans } from '../../main/planet-inspector/view.js';
import { drawFootprint } from '../../main/planet-inspector/footprint.js';
let active = false;
/** One attached inspector per runtime; the canvas itself is transferred once. */
export function attachPlanetInspector(port, canvas) {
    if (active)
        throw new Error('Planet inspector capacity');
    active = true;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        active = false;
        throw new Error('Planet canvas unavailable');
    }
    let development = { buildings: [] };
    let closed = false, tag = 0, image, view, field, footprint = [];
    const post = (kind, ...args) => { if (!closed)
        port.postMessage({ kind, args, tag }); };
    function paint() { if (image && view) {
        ctx.putImageData(image, 0, 0);
        drawFootprint(ctx, view, footprint);
        drawDevelopment(ctx, view, development);
    } }
    const observer = {
        clear() { image = undefined; view = undefined; field = undefined; footprint = []; development = { buildings: [] }; ctx.clearRect(0, 0, canvas.width, canvas.height); post('clear'); },
        bodies: (...args) => post('bodies', ...args), status: (...args) => post('status', ...args), surface: (...args) => post('surface', ...args), pixel: (...args) => post('pixel', ...args),
        view(next, metadata) { view = next; field = metadata; canvas.width = next.width; canvas.height = next.height; image = ctx.createImageData(next.width, next.height); ctx.clearRect(0, 0, next.width, next.height); post('view', next, metadata); },
        page(values, spans, done, total) { if (image && field) {
            paintPlanetSpans(image.data, values, spans, field);
            paint();
        } post('page', undefined, [], done, total); },
    };
    const controller = createPlanetInspectorController(observer, { onSelection: value => post('selection', value) });
    port.onmessage = event => {
        const message = event.data;
        if (closed || !Number.isSafeInteger(message.tag) || message.tag < tag)
            return;
        tag = message.tag;
        try {
            if (message.kind === 'development') {
                development = message.args[0];
                paint();
                return;
            }
            if (message.kind === 'footprint') {
                footprint = message.args[0].slice(0, 64);
                paint();
                return;
            }
            if (message.kind === 'dispose') {
                controller.dispose();
                closed = true;
                active = false;
                port.close();
                return;
            }
            dispatch(controller, message.kind, message.args);
        }
        catch (e) {
            post('status', e instanceof Error ? e.message : 'Invalid planet operation');
        }
    };
    port.start();
}
function dispatch(owner, kind, args) {
    switch (kind) {
        case 'setContext':
            owner.setContext(args[0]);
            return;
        case 'suspend':
            owner.suspend();
            return;
        case 'selectBody':
            owner.selectBody(args[0]);
            return;
        case 'setField':
            owner.setField(args[0]);
            return;
        case 'inspect':
            owner.inspect(args[0], args[1]);
            return;
        case 'selectPlanet':
            owner.selectPlanet(args[0], args[1]);
            return;
        case 'setLevel':
            owner.setLevel(args[0]);
            return;
        case 'pan':
            owner.pan(args[0], args[1]);
            return;
        case 'pick':
            owner.pick(args[0], args[1]);
            return;
        default: throw new Error('Unknown planet operation');
    }
}
//# sourceMappingURL=planet-inspector.js.map