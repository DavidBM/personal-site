import { createDevelopmentPanel } from '../planet-development/panel.js';
import { drawDevelopment } from '../planet-development/overlay.js';
import { createWorkerPlanetInspector } from './worker-client.js';
import { bindOptions, bindText, setText } from '../../ui/dom-bindings.js';
import { createPlanetInspectorController } from './controller.js';
import { fieldLabel, fieldUnits, paintPlanetSpans, pixelLabel } from './view.js';
import { createPlanetPlacementPreview } from '../planet-placement-preview.js';
import { drawFootprint } from './footprint.js';
function text(parent, tag, height = '22px') {
    const element = document.createElement(tag);
    parent.append(element);
    return bindText(element, { height, lineHeight: '20px', wrap: height !== '22px' });
}
function select(parent, label) {
    const row = document.createElement('label'), caption = document.createElement('span'), input = document.createElement('select');
    caption.textContent = label;
    input.setAttribute('aria-label', label);
    input.style.cssText = 'width:100%;min-width:0';
    row.style.cssText = 'display:grid;gap:4px;min-width:0';
    row.append(caption, input);
    parent.append(row);
    return input;
}
function button(parent, label) {
    const result = document.createElement('button');
    result.type = 'button';
    result.textContent = label;
    parent.append(result);
    return result;
}
function coordinate(parent, label) {
    const row = document.createElement('label'), input = document.createElement('input');
    row.textContent = label;
    input.type = 'number';
    input.min = '0';
    input.step = '1';
    input.value = '0';
    input.setAttribute('aria-label', `Global pixel ${label}`);
    input.style.cssText = 'width:100%;min-width:0';
    row.append(input);
    parent.append(row);
    return input;
}
function shell(parent) {
    const root = document.createElement('details');
    root.className = 'online-planet-inspector';
    root.style.cssText = 'width:100%;box-sizing:border-box;contain:layout style paint;border-top:1px solid #3b586b;padding:10px 0';
    const summary = document.createElement('summary');
    summary.textContent = 'Planet map';
    root.append(summary);
    const body = select(root, 'Planet'), status = text(root, 'p', '28px');
    status.parentElement.setAttribute('role', 'status');
    body.disabled = true;
    setText(status, 'Select a discovered system with a published planet catalog.');
    const controls = document.createElement('fieldset');
    controls.disabled = true;
    controls.style.cssText = 'border:0;padding:0;margin:0;min-width:0';
    root.append(controls);
    const metadata = text(controls, 'p', '28px'), channel = select(controls, 'Map field'), level = select(controls, 'Map detail');
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    canvas.tabIndex = 0;
    canvas.style.cssText = 'display:block;width:100%;aspect-ratio:2/1;image-rendering:pixelated;background:#0a1320;cursor:crosshair;margin-top:10px';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Planet map. Select a point, or use the global pixel inputs. Arrow keys pan.');
    controls.append(canvas);
    const legend = text(controls, 'p', '28px'), range = text(controls, 'p', '28px'), navigation = document.createElement('div');
    navigation.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px';
    controls.append(navigation);
    const north = button(navigation, 'North'), west = button(navigation, 'West'), east = button(navigation, 'East'), south = button(navigation, 'South');
    const coordinates = document.createElement('div');
    coordinates.style.cssText = 'display:grid;grid-template-columns:1fr 1fr auto;gap:6px;align-items:end;margin-top:8px';
    controls.append(coordinates);
    const x = coordinate(coordinates, 'X'), y = coordinate(coordinates, 'Y'), inspect = button(coordinates, 'Inspect');
    const pixel = text(controls, 'p', '62px');
    pixel.parentElement.setAttribute('aria-live', 'polite');
    parent.append(root);
    return { root, body, status, controls, metadata, channel, level, canvas, legend, range, north, west, east, south, x, y, inspect, pixel };
}
/** Retained DOM and at most 256×128 display pixels; there is no full-master raster. */
export function createPlanetInspector(parent, options = {}) {
    const openButton = button(parent, 'Open planet development');
    openButton.className = 'planet-development-open';
    if (options.showLauncher === false)
        openButton.hidden = true;
    const dialog = document.createElement('dialog');
    dialog.className = 'planet-screen';
    dialog.setAttribute('aria-label', 'Planet development');
    dialog.innerHTML = '<header class="planet-screen-header"><div><p class="planet-eyebrow">PLANETARY COMMAND</p><h1>Planet surface</h1></div><button type="button" aria-label="Close planet development">Back to space ×</button></header><div class="planet-screen-content"><main></main></div>';
    document.body.append(dialog);
    const heading = bindText(dialog.querySelector('h1'), { height: '36px', lineHeight: '36px' }), main = dialog.querySelector('main');
    const ui = shell(main), workerDrawing = !options.fetch && typeof window !== 'undefined';
    const context2d = workerDrawing ? null : ui.canvas.getContext('2d');
    if (!workerDrawing && !context2d)
        throw new Error('Planet map requires Canvas2D');
    const bodyOptions = bindOptions(ui.body), fieldOptions = bindOptions(ui.channel), levelOptions = bindOptions(ui.level), events = new AbortController();
    let image, field, view;
    let developmentOverlay = { buildings: [] }, planetContext;
    let sceneTarget;
    function sceneBody(systemId, bodyId) {
        const catalogId = planetContext?.bodies.find(b => b.bodyId === bodyId)?.visualCatalogId;
        if (sceneTarget?.systemId === systemId && sceneTarget.bodyId === bodyId && sceneTarget.catalogId === catalogId)
            return;
        sceneTarget = { systemId, bodyId, catalogId };
        setText(heading, planetContext?.bodies.find(b => b.bodyId === bodyId)?.name ?? 'Planet surface');
        if (dialog.open)
            options.onScene?.(sceneTarget, true);
    }
    let footprint = [];
    let workerController;
    function paint() {
        if (workerDrawing) {
            workerController?.footprint(footprint);
            return;
        }
        if (!image || !view)
            return;
        context2d.putImageData(image, 0, 0);
        drawFootprint(context2d, view, footprint);
        drawDevelopment(context2d, view, developmentOverlay);
    }
    const placement = createPlanetPlacementPreview(ui.controls, pixels => { footprint = pixels; paint(); }, options.placementRules);
    function clear() {
        image = undefined;
        view = undefined;
        field = undefined;
        ui.controls.disabled = true;
        context2d?.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
        fieldOptions.clear();
        levelOptions.clear();
        for (const node of [ui.metadata, ui.legend, ui.range, ui.pixel])
            setText(node, '');
        placement.clear();
    }
    function bodies(values, selected) {
        if (!values.length) {
            development.setContext(undefined);
            if (dialog.open)
                dialog.close();
        }
        if (sceneTarget && (!planetContext || sceneTarget.systemId !== planetContext.systemId || !values.some(b => b.bodyId === sceneTarget.bodyId)))
            sceneTarget = undefined;
        bodyOptions.update([{ bodyId: '', name: 'Choose a planet…', surface: true }, ...values], b => b.bodyId, b => `${b.name}${b.bodyId ? b.surface ? ' · Map ready' : ' · Map unprepared' : ''}`);
        ui.body.value = selected;
        ui.body.disabled = !values.length;
    }
    function surface(manifest, name, width) {
        placement.surface(manifest.planetClass);
        ui.controls.disabled = false;
        ui.x.max = String(manifest.masterWidth - 1);
        ui.y.max = String(manifest.masterHeight - 1);
        setText(ui.metadata, `${fieldLabel(manifest.planetClass)} planet · Global map ${manifest.masterWidth} × ${manifest.masterHeight}`);
        fieldOptions.update(Object.keys(manifest.fields), key => key, fieldLabel);
        ui.channel.value = name;
        levelOptions.update([...manifest.fields[name].levels].sort((a, b) => a.width - b.width), l => String(l.width), l => `${l.width} × ${l.height} · ${manifest.masterWidth / l.width} global pixels per cell`);
        ui.level.value = String(width);
    }
    const observer = { clear, bodies, surface, status: message => setText(ui.status, message.startsWith('Map ready') ? 'Map ready. Select a site to develop.' : message),
        view(next, metadata) {
            view = next;
            field = metadata;
            if (context2d) {
                ui.canvas.width = next.width;
                ui.canvas.height = next.height;
                image = context2d.createImageData(next.width, next.height);
                context2d.clearRect(0, 0, next.width, next.height);
            }
            setText(ui.pixel, 'Select a point to read its exact global pixel value.');
            setText(ui.range, `Visible cells: ${next.width} × ${next.height}. Global pixel origin: (${next.x * next.scale}, ${next.y * next.scale}). North is up; longitude wraps.`);
            setText(ui.legend, metadata.kind === 'scalar' ? `Color: 0–1 · ${fieldUnits(metadata.units)}, clipped for display. Exact values appear below.` : `Category colors · ${metadata.labels.length} named classes. Exact labels appear below.`);
        },
        page(values, spans, done, total) {
            if (image && field) {
                paintPlanetSpans(image.data, values, spans, field);
                paint();
            }
            setText(ui.status, `Loading visible planet region: ${done} of ${total} pages.`);
        },
        pixel(x, y, name, metadata, value) {
            placement.pixel(x, y);
            ui.x.value = String(x);
            ui.y.value = String(y);
            setText(ui.pixel, `Global pixel (${x}, ${y}) · ${fieldLabel(name)}: ${value === undefined ? 'Reading…' : pixelLabel(metadata, value)}`);
        },
    };
    const development = createDevelopmentPanel(dialog.querySelector('.planet-screen-content'), value => { developmentOverlay = value; workerController?.development(value); if (!workerDrawing)
        paint(); }, (x, y) => controller.inspect(x, y));
    const onSelection = (value) => { development.select(value); options.onSelection?.(value); if (value) {
        sceneBody(value.systemId, value.bodyId);
        const name = planetContext?.bodies.find(b => b.bodyId === value.bodyId)?.name;
        setText(heading, name ?? 'Planet surface');
    } };
    function open() { if (!dialog.open) {
        dialog.showModal();
        options.onScene?.(sceneTarget, true);
    } ui.root.open = true; development.visible(true); }
    openButton.onclick = () => {
        const preferred = options.preferredCatalogId?.();
        const body = planetContext?.bodies.find(b => !!preferred && b.visualCatalogId === preferred)
            ?? planetContext?.bodies.find(b => b.bodyId === sceneTarget?.bodyId)
            ?? planetContext?.bodies.find(b => b.surface) ?? planetContext?.bodies[0];
        if (body && planetContext) {
            controller.selectPlanet(planetContext.systemId, body.bodyId);
            sceneBody(planetContext.systemId, body.bodyId);
        }
        open();
    };
    dialog.querySelector('header button').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { if (dialog.open)
        return; development.visible(false); options.onScene?.(undefined, false); });
    const controller = workerDrawing ? (workerController = createWorkerPlanetInspector(observer, ui.canvas, onSelection)) : createPlanetInspectorController(observer, { ...options, onSelection });
    const listen = (element, type, callback) => element.addEventListener(type, callback, { signal: events.signal });
    listen(ui.body, 'change', () => { development.resetSelection(); if (planetContext && ui.body.value)
        sceneBody(planetContext.systemId, ui.body.value);
    else {
        sceneTarget = undefined;
        options.onScene?.(undefined, true);
    } controller.selectBody(ui.body.value); });
    listen(ui.channel, 'change', () => controller.setField(ui.channel.value));
    listen(ui.level, 'change', () => controller.setLevel(Number(ui.level.value)));
    listen(ui.north, 'click', () => controller.pan(0, -1));
    listen(ui.south, 'click', () => controller.pan(0, 1));
    listen(ui.west, 'click', () => controller.pan(-1, 0));
    listen(ui.east, 'click', () => controller.pan(1, 0));
    function inspect() {
        if (ui.x.reportValidity() && ui.y.reportValidity())
            controller.inspect(ui.x.valueAsNumber, ui.y.valueAsNumber);
    }
    listen(ui.inspect, 'click', inspect);
    const enter = (event) => { if (event.key === 'Enter') {
        event.preventDefault();
        inspect();
    } };
    listen(ui.x, 'keydown', enter);
    listen(ui.y, 'keydown', enter);
    listen(ui.canvas, 'click', event => {
        if (!view)
            return;
        const rectangle = ui.canvas.getBoundingClientRect(), click = event;
        controller.pick((click.clientX - rectangle.left) / rectangle.width * view.width, (click.clientY - rectangle.top) / rectangle.height * view.height);
    });
    listen(ui.canvas, 'keydown', event => {
        const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        const delta = move[event.key];
        if (delta) {
            event.preventDefault();
            controller.pan(...delta);
        }
    });
    return { selectPlanet(systemId, bodyId) {
            if (!controller.selectPlanet(systemId, bodyId))
                return false;
            development.resetSelection();
            sceneBody(systemId, bodyId);
            open();
            return true;
        }, setContext(value) { planetContext = value; development.setContext(value); controller.setContext(value); if (!value && dialog.open)
            dialog.close(); }, suspend() { development.suspend(); controller.suspend(); }, dispose() { options.onScene?.(undefined, false); events.abort(); development.dispose(); controller.dispose(); placement.dispose(); dialog.remove(); openButton.remove(); } };
}
//# sourceMappingURL=panel.js.map