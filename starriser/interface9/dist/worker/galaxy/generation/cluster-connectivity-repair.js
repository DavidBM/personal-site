/** Repair disconnected islands locally, freeing saturated ports only from cycles. */
export function repairClusterConnectivity(clusters, edges, maximum, nearby, replace) {
    const byId = new Map(clusters.map(cluster => [cluster.id, cluster]));
    let groups = components(clusters, byId);
    while (groups.length > 1) {
        const membership = new Map(groups.flatMap((group, index) => group.map(cluster => [cluster.id, index])));
        let joined = false;
        // Keep the largest component intact unless a cycle port there is needed.
        for (const group of groups.slice(1)) {
            if (joinGroup(group, byId, membership, edges, maximum, nearby, replace)) {
                joined = true;
                break;
            }
        }
        if (!joined)
            break; // Geometric/degree constraints can make the requested graph impossible.
        groups = components(clusters, byId);
    }
    if (groups.length > 1)
        throw new Error(`Galaxy generation could not connect ${groups.length} components within the degree and geometry constraints. Try different generation settings.`);
}
function joinGroup(group, byId, membership, edges, maximum, nearby, replace) {
    for (const a of group) {
        const portsA = cyclePorts(a, byId, edges, maximum);
        if (!portsA.length)
            continue;
        for (const b of nearby(a)) {
            if (membership.get(a.id) === membership.get(b.id))
                continue;
            const portsB = cyclePorts(b, byId, edges, maximum);
            for (const portA of portsA)
                for (const portB of portsB) {
                    if (replace(a, b, [portA, portB].filter((edge) => !!edge)))
                        return true;
                }
        }
    }
    return false;
}
function cyclePorts(cluster, byId, edges, maximum) {
    if (cluster.connectedTo.length < maximum)
        return [undefined];
    const choices = [];
    for (const other of cluster.connectedTo) {
        if (!hasAlternatePath(cluster.id, other, byId))
            continue;
        const edge = edges.find(edge => (edge.clusterA.id === cluster.id && edge.clusterB.id === other)
            || (edge.clusterB.id === cluster.id && edge.clusterA.id === other));
        if (edge)
            choices.push(edge);
    }
    return choices;
}
function hasAlternatePath(from, to, byId) {
    const pending = [from];
    const seen = new Set(pending);
    for (let cursor = 0; cursor < pending.length; cursor++) {
        const current = pending[cursor];
        for (const neighbor of byId.get(current).connectedTo) {
            if (current === from && neighbor === to)
                continue;
            if (neighbor === to)
                return true;
            if (!seen.has(neighbor)) {
                seen.add(neighbor);
                pending.push(neighbor);
            }
        }
    }
    return false;
}
function components(clusters, byId) {
    const remaining = new Set(clusters.map(cluster => cluster.id));
    const groups = [];
    for (const cluster of clusters) {
        if (!remaining.delete(cluster.id))
            continue;
        const group = [cluster];
        for (let cursor = 0; cursor < group.length; cursor++) {
            for (const id of group[cursor].connectedTo)
                if (remaining.delete(id))
                    group.push(byId.get(id));
        }
        groups.push(group);
    }
    return groups.sort((a, b) => b.length - a.length);
}
//# sourceMappingURL=cluster-connectivity-repair.js.map