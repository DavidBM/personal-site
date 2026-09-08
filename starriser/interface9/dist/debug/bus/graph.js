const join = (first, second) => `${first.length}:${first}${second}`;
/** A bipartite graph avoids multiplying providers by all consumers. Counters remain contract aggregates. */
export function dependencyGraph(snapshot, filter = {}) {
    const nodes = new Map(), edges = [];
    const declarations = new Map(snapshot.graph.declared.map(value => [value.binding, value]));
    for (const connection of snapshot.graph.connected) {
        const declaration = declarations.get(connection.binding);
        if (declaration)
            addBinding(declaration, connection, nodes, edges, filter);
    }
    addStages(snapshot, filter, nodes, edges);
    return { nodes: Array.from(nodes.values()), edges };
}
function addStages(snapshot, filter, nodes, edges) {
    for (const stage of snapshot.stages) {
        if (filter.service && !stage.service.includes(filter.service))
            continue;
        if (filter.contract)
            continue;
        nodes.set(`stage:${stage.id}`, { id: `stage:${stage.id}`, kind: 'stage', label: stage.id, service: stage.service, source: stage.source });
    }
    for (const link of snapshot.dependencies) {
        const from = `stage:${link.from}`, to = `stage:${link.to}`;
        if (nodes.has(from) && nodes.has(to))
            edges.push({ from, to, kind: 'external', contract: link.contract, connected: false });
    }
}
function addBinding(declaration, member, nodes, edges, filter) {
    const identity = declaration.identity;
    if (filter.service && !identity.service.includes(filter.service))
        return;
    const id = `binding:${member.binding}:${member.incarnation}`;
    nodes.set(id, { id, kind: 'service', label: `${identity.service} / ${identity.instance}`, service: identity.service,
        source: identity.source, connected: true, ready: member.ready, host: member.host, incarnation: member.incarnation });
    addContracts('provides', declaration, id, member.ready, nodes, edges, filter);
    addContracts('consumes', declaration, id, member.ready, nodes, edges, filter);
}
function addContracts(direction, declaration, id, ready, nodes, edges, filter) {
    const seen = new Set();
    for (const contract of declaration[direction]) {
        if (seen.has(contract.id) || (filter.contract && !contract.id.includes(filter.contract)))
            continue;
        seen.add(contract.id);
        const key = `contract:${join(declaration.identity.scope, contract.id)}`;
        nodes.set(key, { id: key, kind: 'contract', label: contract.id });
        // Requests go consumer -> owner; events and streams go provider -> consumer.
        const outward = (contract.kind === 'command' || contract.kind === 'query') === (direction === 'consumes');
        edges.push({ from: outward ? id : key, to: outward ? key : id, kind: 'declared', contract: contract.id, connected: ready });
    }
}
export function selectedSpans(snapshot, filter) {
    const selectedTraces = new Set(snapshot.spans.filter(span => span.commandId === filter.commandId).map(span => span.context.traceId));
    const services = new Map(snapshot.stages.map(stage => [stage.id, stage.service]));
    return snapshot.spans.filter(span => {
        if (filter.traceId && span.context.traceId !== filter.traceId)
            return false;
        if (filter.commandId && !selectedTraces.has(span.context.traceId))
            return false;
        if (filter.service && !services.get(span.stage)?.includes(filter.service))
            return false;
        return !filter.contract || span.contract?.includes(filter.contract);
    });
}
export function sourceHref(source) {
    if (!/^(js|crates|tests|docs)\/[a-zA-Z0-9_./-]+$/.test(source) || source.split('/').includes('..'))
        return;
    return `/${source}`;
}
//# sourceMappingURL=graph.js.map