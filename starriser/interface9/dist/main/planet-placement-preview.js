import { featureRequest } from '../features/http-worker/client.js';
import { loadSharedRules } from '../lib/shared-rules/loader.js';
import { bindText, setText } from '../ui/dom-bindings.js';
/** Local geometry only. Accepted occupancy, ownership and spending stay native. */
export function createPlanetPlacementPreview(parent, changed, load = workerFootprintRules) {
    const root = document.createElement('section'), label = document.createElement('label'), kind = document.createElement('select');
    root.className = 'planet-complex-preview';
    label.textContent = 'Complex footprint preview';
    kind.setAttribute('aria-label', 'Complex footprint preview');
    for (const [value, name] of [['', 'No preview'], ['1', 'Industrial complex'], ['2', 'Enclosed habitat'], ['3', 'Gas platform']]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = name;
        kind.append(option);
    }
    kind.style.cssText = 'width:100%;min-width:0';
    label.append(kind);
    root.append(label);
    const explanation = document.createElement('p');
    explanation.textContent = 'Preview only. Construction, ownership, terrain suitability and existing buildings are not checked.';
    const output = document.createElement('p');
    output.setAttribute('role', 'status');
    root.append(explanation, output);
    parent.append(root);
    const text = bindText(output, { height: '62px', lineHeight: '20px', wrap: true });
    let className, pixel, serial = 0, disposed = false;
    function clear() {
        serial++;
        className = undefined;
        pixel = undefined;
        kind.disabled = true;
        changed([]);
        setText(text, '');
    }
    async function update() {
        const ticket = ++serial, current = pixel, name = className, type = Number(kind.value);
        changed([]);
        if (!name || !type || !current) {
            setText(text, kind.value ? 'Select a global pixel to preview this footprint.' : '');
            return;
        }
        setText(text, 'Checking footprint…');
        try {
            const rules = await load();
            if (disposed || ticket !== serial)
                return;
            const coordinates = await rules.planet_footprint(name, type, current.x, current.y);
            if (disposed || ticket !== serial)
                return;
            const pixels = unpack(coordinates);
            changed(pixels);
            setText(text, `${pixels.length} global pixels: ${pixels.map(p => `(${p.x}, ${p.y})`).join(', ')}.`);
        }
        catch (error) {
            if (disposed || ticket !== serial)
                return;
            setText(text, previewError(error));
        }
    }
    const onChange = () => { void update(); };
    kind.addEventListener('change', onChange);
    clear();
    return { clear,
        surface(value) { if (disposed || className === value)
            return; className = value; kind.disabled = false; void update(); },
        pixel(x, y) {
            if (disposed || (pixel?.x === x && pixel?.y === y))
                return;
            pixel = { x, y };
            void update();
        },
        dispose() { if (disposed)
            return; disposed = true; clear(); kind.removeEventListener('change', onChange); root.remove(); },
    };
}
function unpack(values) {
    if (values.length < 6 || values.length > 8 || values.length % 2)
        throw new Error('Invalid footprint');
    const pixels = [];
    for (let i = 0; i < values.length; i += 2)
        pixels.push({ x: values[i], y: values[i + 1] });
    return pixels;
}
function previewError(error) {
    if (String(error).includes('UnsupportedSurface'))
        return 'This complex type does not support this planet class.';
    if (String(error).includes('InvalidPixel'))
        return 'This footprint extends beyond the planet map. Select a different latitude.';
    return 'Footprint preview is unavailable. Reload the page to retry.';
}
async function workerFootprintRules() {
    if (typeof window === 'undefined')
        return loadSharedRules();
    return { planet_footprint: (name, kind, x, y) => featureRequest('footprint', [name, kind, x, y], new AbortController().signal) };
}
//# sourceMappingURL=planet-placement-preview.js.map