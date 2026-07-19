function resolveId(value) {
    return typeof value === "object" ? value.id : value;
}
/**
 * Canonical inter-cluster connection key.
 * Order-normalized so (A,B,g1,g2) and (B,A,g2,g1) map to the same string.
 * Shared by main model, renderer buffers, and business BFS coloring.
 */
export function makeConnectionKey(cluster1, cluster2, jumpGate1, jumpGate2) {
    const c1 = resolveId(cluster1);
    const c2 = resolveId(cluster2);
    const jg1 = resolveId(jumpGate1);
    const jg2 = resolveId(jumpGate2);
    if (c1 > c2 || (c1 === c2 && jg1 > jg2)) {
        return `${c2}_${c1}_${jg2}_${jg1}`;
    }
    return `${c1}_${c2}_${jg1}_${jg2}`;
}
/**
 * Canonical intra-cluster solar-system connection key (order-normalized).
 * Shared by connection store / view bridge / fleet mirrors.
 */
export function makeSolarConnectionKey(clusterId, solarSystemId1, solarSystemId2) {
    const c = resolveId(clusterId);
    const a = resolveId(solarSystemId1);
    const b = resolveId(solarSystemId2);
    return a < b ? `${a}-${b}_${c}` : `${b}-${a}_${c}`;
}
/**
 * Cluster id from a solar connection key (`a-b_c`). Null for inter-cluster
 * keys (underscores only) or malformed strings.
 */
export function solarConnectionClusterId(key) {
    // Solar keys always contain a dash (`sysA-sysB_cluster`); jump edges do not.
    const dash = key.indexOf("-");
    if (dash < 0)
        return null;
    const under = key.indexOf("_", dash + 1);
    if (under < 0 || under + 1 >= key.length)
        return null;
    const id = Number(key.slice(under + 1));
    return Number.isFinite(id) ? id : null;
}
//# sourceMappingURL=connection-key.js.map