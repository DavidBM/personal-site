import { PLANET_PAGE_BYTES, bytesPerCell } from '../../lib/planet-content/contracts.js';
import { PURE_BIOME_LABELS, PURE_BIOME_DEBUG_RGB } from '../../gpu/planet-texture/biome-palette.js';
export const PLANET_VIEW_WIDTH = 256;
export const PLANET_VIEW_HEIGHT = 128;
const wrap = (n, size) => ((n % size) + size) % size;
/** Window origins are level cells; player selections always stay in canonical pixels. */
export function planetWindow(masterWidth, level, centerX, centerY) {
    if (!Number.isInteger(level) || level < 2 || masterWidth % level)
        throw new Error('Invalid planet view level');
    const width = Math.min(PLANET_VIEW_WIDTH, level), height = Math.min(PLANET_VIEW_HEIGHT, level / 2), scale = masterWidth / level;
    return { level, width, height, scale,
        x: width === level ? 0 : wrap(Math.floor(centerX / scale) - Math.floor(width / 2), level),
        y: Math.max(0, Math.min(level / 2 - height, Math.floor(centerY / scale) - Math.floor(height / 2))),
    };
}
export function canonicalPixel(view, x, y) {
    const column = Math.max(0, Math.min(view.width - 1, Math.floor(x))), row = Math.max(0, Math.min(view.height - 1, Math.floor(y)));
    return { x: Math.floor((wrap(view.x + column, view.level) + 0.5) * view.scale), y: Math.floor((view.y + row + 0.5) * view.scale) };
}
export function centeredPixel(view, horizontal, vertical) {
    return canonicalPixel(view, view.width / 2 + horizontal * view.width / 2, view.height / 2 + vertical * view.height / 2);
}
/** Only pages intersecting the visible window; repeated row segments share one read. */
export function planetPagePlan(view, field) {
    const perPage = PLANET_PAGE_BYTES / bytesPerCell(field), pages = new Map();
    for (let row = 0; row < view.height; row++) {
        let column = 0;
        while (column < view.width) {
            const x = wrap(view.x + column, view.level), cell = (view.y + row) * view.level + x, page = Math.floor(cell / perPage);
            const length = Math.min(view.width - column, view.level - x, perPage - cell % perPage);
            const spans = pages.get(page) ?? [];
            spans.push({ source: cell % perPage, destination: row * view.width + column, length });
            pages.set(page, spans);
            column += length;
        }
    }
    return Array.from(pages, ([page, spans]) => ({ page, spans }));
}
export function initialField(manifest) {
    const preferred = manifest.planetClass === 'gas' ? 'atmosphericVariation' : manifest.fields.biome ? 'biome' : 'elevation';
    return manifest.fields[preferred] ? preferred : Object.keys(manifest.fields)[0];
}
export function fieldLabel(name) {
    if (name === 'atmosphericVariation')
        return 'Atmospheric variation';
    return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
}
export function pixelLabel(field, value) {
    if (field.kind === 'category')
        return `${field.labels[value]} (${value})`;
    return `${Object.is(value, -0) ? '-0' : String(value)} ${fieldUnits(field.units)}`;
}
export function fieldUnits(units) { return units === 'normalized-generator' ? 'Relative scale' : units; }
const biomeColors = new Map(Object.entries(PURE_BIOME_LABELS).map(([id, label]) => {
    const c = PURE_BIOME_DEBUG_RGB[Number(id)];
    return [label, [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)]];
}));
const categoryColors = [
    [/ocean|water|sea/, [24, 70, 109]], [/forest|jungle/, [38, 104, 74]],
    [/grass|plain|savanna/, [93, 133, 79]], [/desert|sand|arid/, [194, 161, 105]],
    [/ice|snow|frozen/, [187, 221, 233]], [/lava|magma|volcan/, [195, 80, 47]],
    [/rock|mountain/, [113, 116, 126]], [/tundra/, [142, 159, 142]],
];
function categoryColor(label, index, count) {
    const known = biomeColors.get(label);
    if (known)
        return known;
    const color = categoryColors.find(([pattern]) => pattern.test(label.toLowerCase()));
    const t = index / Math.max(1, count - 1);
    return color?.[1] ?? [90 + Math.round(80 * t), 95 + Math.round(45 * t), 130 - Math.round(35 * t)];
}
/** Display palette only. No biome, sea level or physical elevation is inferred. */
export function paintPlanetSpans(rgba, values, spans, field) {
    const colors = field.kind === 'category' ? field.labels.map((label, i) => categoryColor(label, i, field.labels.length)) : undefined;
    for (const span of spans)
        for (let i = 0; i < span.length; i++) {
            const value = values[span.source + i], offset = (span.destination + i) * 4;
            const t = field.kind === 'category' ? value / Math.max(1, field.labels.length - 1) : Math.max(0, Math.min(1, value));
            if (colors) {
                const color = colors[value];
                rgba[offset] = color[0];
                rgba[offset + 1] = color[1];
                rgba[offset + 2] = color[2];
                rgba[offset + 3] = 255;
                continue;
            }
            rgba[offset] = Math.round(30 + 215 * t);
            rgba[offset + 1] = Math.round(60 + 145 * t);
            rgba[offset + 2] = Math.round(125 - 85 * t);
            rgba[offset + 3] = 255;
        }
}
//# sourceMappingURL=view.js.map