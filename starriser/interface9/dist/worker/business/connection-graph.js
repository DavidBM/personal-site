import { makeColorGradient, rgbToHex } from "../../utils/color.js";
export function makeConnectionKey(cluster1, cluster2, jumpGate1, jumpGate2) {
    const c1id = typeof cluster1 === "object" ? cluster1.id : cluster1;
    const c2id = typeof cluster2 === "object" ? cluster2.id : cluster2;
    const jg1id = typeof jumpGate1 === "object" ? jumpGate1.id : jumpGate1;
    const jg2id = typeof jumpGate2 === "object" ? jumpGate2.id : jumpGate2;
    let arr = [c1id, c2id, jg1id, jg2id];
    if (c1id > c2id || (c1id === c2id && jg1id > jg2id)) {
        arr = [c2id, c1id, jg2id, jg1id];
    }
    return arr.join("_");
}
export function computeConnectionGradient(selectedId, maxJumps, connections) {
    const connectionGraph = new Map();
    const connectionsFlat = connections ?? [];
    for (const conn of connectionsFlat) {
        const c1 = conn.cluster1.id;
        const c2 = conn.cluster2.id;
        const list1 = connectionGraph.get(c1) ?? [];
        const list2 = connectionGraph.get(c2) ?? [];
        const connKey = makeConnectionKey(c1, c2, conn.jumpGate1.id, conn.jumpGate2.id);
        list1.push({ to: c2, key: connKey });
        list2.push({ to: c1, key: connKey });
        connectionGraph.set(c1, list1);
        connectionGraph.set(c2, list2);
    }
    const queue = [
        { id: selectedId, dist: 0 },
    ];
    const visited = new Set([selectedId]);
    const connToDist = new Map();
    while (queue.length > 0) {
        const current = queue.shift();
        if (!current)
            break;
        const { id, dist } = current;
        if (dist > maxJumps)
            continue;
        const neighbors = connectionGraph.get(id) ?? [];
        for (const neighbor of neighbors) {
            if (!visited.has(neighbor.to)) {
                visited.add(neighbor.to);
                queue.push({ id: neighbor.to, dist: dist + 1 });
            }
            if (dist < maxJumps) {
                const prev = connToDist.get(neighbor.key);
                const nextDist = Math.min(dist + 1, prev ?? Infinity);
                connToDist.set(neighbor.key, nextDist);
            }
        }
    }
    const gradient = makeColorGradient(0xff3c3c, 0x3c5cff, maxJumps, true);
    const out = {};
    for (const [key, dist] of connToDist.entries()) {
        if (dist >= 1 && dist <= maxJumps) {
            out[key] = rgbToHex(gradient[dist - 1]);
        }
    }
    return out;
}
//# sourceMappingURL=connection-graph.js.map