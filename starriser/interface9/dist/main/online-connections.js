const pair = (a, b) => [a, b].sort().join(':');
const numericId = (id) => Number.parseInt(id.slice(-8), 16);
const point = (p) => ({ x: p[0], y: p[1], z: p[2] });
function jumpKey(a, b, from, to) {
    return a <= b ? `online:jump:${a}:${b}:${from.join(',')}:${to.join(',')}` : jumpKey(b, a, to, from);
}
/** Connection geometry outlives a viewport subscription, never its visibility
 * lifetime. These strokes have no system handles, picking or route authority. */
export function createOnlineConnections(draw, clusterHandle = () => undefined) {
    const drawn = new Map();
    const known = new Map();
    function add(line, upsert) {
        if (JSON.stringify(drawn.get(line.key)) !== JSON.stringify(line))
            upsert.push(line);
        drawn.set(line.key, line);
    }
    function acceptAtlas(rows) {
        const upsert = [];
        for (const row of rows)
            for (const link of row.links ?? []) {
                add({ key: jumpKey(row.id, link.clusterId, link.from, link.to), a: point(link.from), b: point(link.to), color: 0x4488ff }, upsert);
            }
        if (upsert.length)
            draw({ upsert });
    }
    function replace(view) {
        const systems = new Map(view.systems.map(row => [row.id, row]));
        const present = new Set(), upsert = [], remove = [];
        for (const edge of view.connections) {
            const a = systems.get(edge.a), b = systems.get(edge.b);
            if (!a || !b)
                continue;
            const line = systemLine(a, b, clusterHandle(a.clusterId));
            present.add(line.key);
            add(line, upsert);
            known.set(line.key, { a: a.id, b: b.id });
        }
        // A withdrawal with both endpoints still in scope is a real graph change.
        // An endpoint leaving the viewport is only a subscription change.
        for (const [key, edge] of known)
            if (systems.has(edge.a) && systems.has(edge.b) && !present.has(key)) {
                known.delete(key);
                drawn.delete(key);
                remove.push(key);
            }
        if (upsert.length || remove.length)
            draw({ upsert, remove });
    }
    function reset() { drawn.clear(); known.clear(); draw({ clear: true }); }
    return { acceptAtlas, replace, reset };
}
function systemLine(a, b, handle) {
    if (a.clusterId === b.clusterId)
        return { key: `online:system:${handle === undefined ? '' : `${handle}:`}${pair(a.id, b.id)}`, a: { x: a.x, y: 0, z: a.z }, b: { x: b.x, y: 0, z: b.z }, color: 0x336655 };
    const ca = numericId(a.clusterId), cb = numericId(b.clusterId), from = [a.x, 0, a.z], to = [b.x, 0, b.z];
    return { key: jumpKey(ca, cb, from, to), a: point(ca < cb ? from : to), b: point(ca < cb ? to : from), color: 0x4488ff };
}
//# sourceMappingURL=online-connections.js.map