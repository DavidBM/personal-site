import { dependencyGraph, sourceHref } from './graph.js';
const NS = 'http://www.w3.org/2000/svg';
function svg(name, attributes) {
    const element = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attributes))
        element.setAttribute(key, value);
    return element;
}
/** Layout/render caps affect the view only; the complete bounded snapshot remains exportable. */
export function renderGraph(target, snapshot, filter) {
    const graph = dependencyGraph(snapshot, filter), nodes = graph.nodes.slice(0, 96);
    const positions = new Map();
    const rows = { service: 0, contract: 0, stage: 0 };
    for (const node of nodes)
        positions.set(node.id, { x: { service: 15, contract: 345, stage: 690 }[node.kind], y: 36 + rows[node.kind]++ * 68 });
    const canvas = svg('svg', { viewBox: `0 0 1030 ${Math.max(150, ...Object.values(rows).map(value => value * 68 + 25))}`, role: 'img', 'aria-label': 'Declared service dependency graph' });
    addArrow(canvas);
    let shown = 0;
    for (const edge of graph.edges) {
        const from = positions.get(edge.from), to = positions.get(edge.to);
        if (shown >= 256)
            break;
        if (!from || !to)
            continue;
        addEdge(canvas, from, to, edge.connected);
        shown++;
    }
    for (const node of nodes)
        addNode(canvas, node, positions.get(node.id));
    const note = document.createElement('p');
    note.textContent = `${nodes.length}/${graph.nodes.length} nodes · ${shown}/${graph.edges.length} edges shown. Solid: ready live binding. Dashed: declaration only. External stages are explicitly declared.`;
    target.replaceChildren(note, canvas);
}
function addArrow(canvas) {
    const defs = svg('defs', {}), marker = svg('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '6', markerHeight: '6', orient: 'auto-start-reverse' });
    marker.append(svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'currentColor' }));
    defs.append(marker);
    canvas.append(defs);
}
function addEdge(canvas, from, to, connected) {
    const direction = to.x >= from.x ? 1 : -1;
    const x1 = from.x + (direction > 0 ? 270 : 0), x2 = to.x + (direction > 0 ? 0 : 270);
    canvas.append(svg('path', { d: `M${x1},${from.y + 23} C${x1 + 30 * direction},${from.y + 23} ${x2 - 30 * direction},${to.y + 23} ${x2},${to.y + 23}`,
        class: `edge ${connected ? 'connected' : 'declared'}`, 'marker-end': 'url(#arrow)' }));
}
function addNode(canvas, node, position) {
    const group = svg('g', { transform: `translate(${position.x} ${position.y})` });
    group.append(svg('rect', { width: '270', height: '48', rx: '7', class: `node ${node.kind}` }));
    const label = svg('text', { x: '10', y: '19' });
    label.textContent = node.label.length > 36 ? `${node.label.slice(0, 33)}…` : node.label;
    const subtitle = svg('text', { x: '10', y: '36', class: 'subtitle' });
    subtitle.textContent = node.host ? `${node.ready ? 'ready' : 'registered'} · ${node.host.slice(0, 22)} · generation ${node.incarnation}` : node.kind;
    const title = svg('title', {});
    title.textContent = `${node.label}\n${node.source ?? ''}`;
    group.append(label, subtitle, title);
    const href = node.source && sourceHref(node.source);
    if (href) {
        const link = svg('a', { href, target: '_blank', rel: 'noopener' });
        link.append(group);
        canvas.append(link);
    }
    else
        canvas.append(group);
}
//# sourceMappingURL=view-graph.js.map