const COOLDOWN_MS = 10000;
const MIN_JUMP_MS = 1200;
const SPEED_UNITS_PER_SEC = 8000;
const TICK_MS = 120;
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
function buildFleetCounts() {
    return {
        red: randomInt(0, 2),
        blue: randomInt(20, 100),
        green: randomInt(100, 1000),
    };
}
export function busConstructor(bus) {
    const clusters = new Map();
    const clusterIds = [];
    const clusterEdges = new Map();
    const fleets = new Map();
    let fleetCounter = 1;
    let pubSubReady = false;
    let tickHandle = null;
    const ensureCluster = (clusterId) => {
        let cluster = clusters.get(clusterId);
        if (!cluster) {
            cluster = {
                id: clusterId,
                solarSystems: new Map(),
                solarSystemIds: [],
            };
            clusters.set(clusterId, cluster);
            clusterIds.push(clusterId);
        }
        if (!clusterEdges.has(clusterId)) {
            clusterEdges.set(clusterId, []);
        }
        return cluster;
    };
    const removeCluster = (clusterId) => {
        clusters.delete(clusterId);
        const idx = clusterIds.indexOf(clusterId);
        if (idx >= 0)
            clusterIds.splice(idx, 1);
        clusterEdges.delete(clusterId);
        for (const edges of clusterEdges.values()) {
            for (let i = edges.length - 1; i >= 0; i--) {
                if (edges[i].toClusterId === clusterId) {
                    edges.splice(i, 1);
                }
            }
        }
    };
    const addSolarSystem = (clusterId, system) => {
        const cluster = ensureCluster(clusterId);
        const existing = cluster.solarSystems.get(system.id);
        if (existing) {
            existing.position = system.position;
            existing.isJumpGate = system.isJumpGate ?? existing.isJumpGate;
            return;
        }
        const entry = {
            id: system.id,
            position: system.position,
            connections: new Set(),
            isJumpGate: system.isJumpGate ?? false,
        };
        cluster.solarSystems.set(system.id, entry);
        cluster.solarSystemIds.push(system.id);
    };
    const removeSolarSystem = (clusterId, solarSystemId) => {
        const cluster = clusters.get(clusterId);
        if (!cluster)
            return;
        cluster.solarSystems.delete(solarSystemId);
        const idx = cluster.solarSystemIds.indexOf(solarSystemId);
        if (idx >= 0)
            cluster.solarSystemIds.splice(idx, 1);
        for (const sys of cluster.solarSystems.values()) {
            sys.connections.delete(solarSystemId);
        }
    };
    const connectSolarSystems = (clusterId, solarSystemId1, solarSystemId2) => {
        const cluster = clusters.get(clusterId);
        if (!cluster)
            return;
        const sys1 = cluster.solarSystems.get(solarSystemId1);
        const sys2 = cluster.solarSystems.get(solarSystemId2);
        if (!sys1 || !sys2)
            return;
        sys1.connections.add(solarSystemId2);
        sys2.connections.add(solarSystemId1);
    };
    const connectClusters = (edge) => {
        ensureCluster(edge.fromClusterId);
        ensureCluster(edge.toClusterId);
        const edgesFrom = clusterEdges.get(edge.fromClusterId);
        const edgesTo = clusterEdges.get(edge.toClusterId);
        if (edgesFrom)
            edgesFrom.push(edge);
        if (edgesTo) {
            edgesTo.push({
                fromClusterId: edge.toClusterId,
                toClusterId: edge.fromClusterId,
                fromGateId: edge.toGateId,
                toGateId: edge.fromGateId,
            });
        }
    };
    const removeClusterConnection = (clusterId1, clusterId2, gate1, gate2) => {
        const removeEdge = (fromId, toId) => {
            const edges = clusterEdges.get(fromId);
            if (!edges)
                return;
            for (let i = edges.length - 1; i >= 0; i--) {
                const edge = edges[i];
                if (edge.toClusterId !== toId)
                    continue;
                if (typeof gate1 === "number" &&
                    typeof gate2 === "number" &&
                    !(edge.fromGateId === gate1 && edge.toGateId === gate2)) {
                    continue;
                }
                edges.splice(i, 1);
            }
        };
        removeEdge(clusterId1, clusterId2);
        if (typeof gate1 === "number" && typeof gate2 === "number") {
            const swap = gate1;
            gate1 = gate2;
            gate2 = swap;
        }
        removeEdge(clusterId2, clusterId1);
    };
    const handleOps = (ops) => {
        if (!Array.isArray(ops))
            return;
        for (const op of ops) {
            switch (op.type) {
                case "addCluster":
                    ensureCluster(op.payload.id);
                    break;
                case "removeCluster":
                    removeCluster(op.payload.clusterId);
                    break;
                case "addSolarSystem":
                    addSolarSystem(op.payload.clusterId, {
                        id: op.payload.id,
                        position: op.payload.position,
                        isJumpGate: op.payload.isJumpGate,
                    });
                    break;
                case "removeSolarSystem":
                    removeSolarSystem(op.payload.clusterId, op.payload.solarSystemId);
                    break;
                case "connectSolarSystems":
                    connectSolarSystems(op.payload.clusterId, op.payload.solarSystemId1, op.payload.solarSystemId2);
                    break;
                case "connectClusters":
                    connectClusters({
                        fromClusterId: op.payload.clusterId1,
                        toClusterId: op.payload.clusterId2,
                        fromGateId: op.payload.jumpGate1.id,
                        toGateId: op.payload.jumpGate2.id,
                    });
                    break;
                case "removeConnection":
                    removeClusterConnection(op.payload.clusterId1, op.payload.clusterId2, op.payload.jumpGate1?.id, op.payload.jumpGate2?.id);
                    break;
            }
        }
    };
    const handleClearGalaxy = () => {
        clusters.clear();
        clusterIds.length = 0;
        clusterEdges.clear();
        fleets.clear();
    };
    const getSolarPosition = (node) => {
        const cluster = clusters.get(node.clusterId);
        if (!cluster)
            return null;
        const sys = cluster.solarSystems.get(node.solarSystemId);
        return sys ? sys.position : null;
    };
    const computeJumpDuration = (start, end) => {
        const startPos = getSolarPosition(start);
        const endPos = getSolarPosition(end);
        if (!startPos || !endPos)
            return MIN_JUMP_MS;
        const dx = endPos.x - startPos.x;
        const dy = endPos.y - startPos.y;
        const dz = endPos.z - startPos.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const duration = (distance / SPEED_UNITS_PER_SEC) * 1000;
        return Math.max(MIN_JUMP_MS, Math.round(duration));
    };
    const findClusterPath = (startId, endId) => {
        if (startId === endId)
            return [];
        const queue = [startId];
        const visited = new Set([startId]);
        const parent = new Map();
        while (queue.length) {
            const current = queue.shift();
            if (current == null)
                break;
            if (current === endId)
                break;
            const edges = clusterEdges.get(current) ?? [];
            for (const edge of edges) {
                if (visited.has(edge.toClusterId))
                    continue;
                visited.add(edge.toClusterId);
                parent.set(edge.toClusterId, { prev: current, edge });
                queue.push(edge.toClusterId);
            }
        }
        if (!visited.has(endId))
            return [];
        const path = [];
        let cursor = endId;
        while (cursor !== startId) {
            const info = parent.get(cursor);
            if (!info)
                break;
            path.push(info.edge);
            cursor = info.prev;
        }
        return path.reverse();
    };
    const findSolarPath = (clusterId, startId, endId) => {
        if (startId === endId)
            return [startId];
        const cluster = clusters.get(clusterId);
        if (!cluster)
            return [startId, endId];
        const queue = [startId];
        const visited = new Set([startId]);
        const parent = new Map();
        while (queue.length) {
            const current = queue.shift();
            if (current == null)
                break;
            if (current === endId)
                break;
            const sys = cluster.solarSystems.get(current);
            if (!sys)
                continue;
            for (const neighbor of sys.connections) {
                if (visited.has(neighbor))
                    continue;
                visited.add(neighbor);
                parent.set(neighbor, current);
                queue.push(neighbor);
            }
        }
        if (!visited.has(endId))
            return [startId, endId];
        const path = [endId];
        let cursor = endId;
        while (cursor !== startId) {
            const prev = parent.get(cursor);
            if (prev == null)
                break;
            path.push(prev);
            cursor = prev;
        }
        return path.reverse();
    };
    const enqueueIntraPath = (fleet, clusterId, startId, endId) => {
        if (startId === endId)
            return null;
        const path = findSolarPath(clusterId, startId, endId);
        if (path.length < 2) {
            return { clusterId, solarSystemId: endId };
        }
        fleet.intraPath = path;
        fleet.intraIndex = 2;
        return { clusterId, solarSystemId: path[1] };
    };
    const getNextNode = (fleet) => {
        const current = fleet.currentNode;
        if (fleet.intraPath) {
            if (fleet.intraIndex < fleet.intraPath.length) {
                const nextId = fleet.intraPath[fleet.intraIndex];
                fleet.intraIndex += 1;
                return { clusterId: current.clusterId, solarSystemId: nextId };
            }
            fleet.intraPath = null;
        }
        if (fleet.pendingEdges.length > 0) {
            const edge = fleet.pendingEdges[0];
            if (current.clusterId === edge.fromClusterId) {
                if (current.solarSystemId !== edge.fromGateId) {
                    const next = enqueueIntraPath(fleet, current.clusterId, current.solarSystemId, edge.fromGateId);
                    if (next)
                        return next;
                }
                fleet.pendingEdges.shift();
                return {
                    clusterId: edge.toClusterId,
                    solarSystemId: edge.toGateId,
                };
            }
        }
        if (current.clusterId === fleet.destination.clusterId) {
            if (current.solarSystemId !== fleet.destination.solarSystemId) {
                const next = enqueueIntraPath(fleet, current.clusterId, current.solarSystemId, fleet.destination.solarSystemId);
                if (next)
                    return next;
                return fleet.destination;
            }
            return null;
        }
        return null;
    };
    const publishState = (fleet) => {
        bus.publish("fleet_state", { id: fleet.id, state: fleet.state }, 1);
    };
    const startNextJump = (fleet, now) => {
        const nextNode = getNextNode(fleet);
        if (!nextNode)
            return false;
        const durationMs = computeJumpDuration(fleet.currentNode, nextNode);
        fleet.state = {
            state: "jumping",
            startTime: now,
            startNode: fleet.currentNode,
            endNode: nextNode,
            durationMs,
        };
        publishState(fleet);
        return true;
    };
    const advanceFleet = (fleet, now) => {
        if (fleet.state.state === "jumping") {
            if (now - fleet.state.startTime >= fleet.state.durationMs) {
                fleet.currentNode = fleet.state.endNode;
                fleet.state = {
                    state: "cooldown",
                    startTime: now,
                    node: fleet.currentNode,
                    durationMs: COOLDOWN_MS,
                };
                publishState(fleet);
            }
            return;
        }
        if (fleet.state.state === "cooldown") {
            if (now - fleet.state.startTime >= fleet.state.durationMs) {
                if (!startNextJump(fleet, now)) {
                    fleets.delete(fleet.id);
                    bus.publish("fleet_removed", { id: fleet.id }, 1);
                }
            }
            return;
        }
    };
    const pickRandomNode = () => {
        if (clusterIds.length === 0)
            return null;
        for (let attempt = 0; attempt < 12; attempt++) {
            const clusterId = clusterIds[randomInt(0, clusterIds.length - 1)];
            const cluster = clusters.get(clusterId);
            if (!cluster || cluster.solarSystemIds.length === 0)
                continue;
            const solarSystemId = cluster.solarSystemIds[randomInt(0, cluster.solarSystemIds.length - 1)];
            return { clusterId, solarSystemId };
        }
        return null;
    };
    const spawnFleet = () => {
        const start = pickRandomNode();
        const destination = pickRandomNode();
        if (!start || !destination)
            return;
        if (start.clusterId === destination.clusterId &&
            start.solarSystemId === destination.solarSystemId) {
            return;
        }
        const path = findClusterPath(start.clusterId, destination.clusterId);
        const fleetId = `fleet_${fleetCounter++}`;
        const now = Date.now();
        const fleet = {
            id: fleetId,
            counts: buildFleetCounts(),
            currentNode: start,
            destination,
            pendingEdges: path,
            intraPath: null,
            intraIndex: 0,
            state: {
                state: "awaiting",
                node: start,
            },
        };
        fleets.set(fleetId, fleet);
        bus.publish("fleet_spawned", { id: fleetId, counts: fleet.counts, state: fleet.state }, 1);
        if (!startNextJump(fleet, now)) {
            fleets.delete(fleetId);
            bus.publish("fleet_removed", { id: fleetId }, 1);
        }
    };
    const tick = () => {
        if (fleets.size === 0)
            return;
        const now = Date.now();
        for (const fleet of fleets.values()) {
            advanceFleet(fleet, now);
        }
    };
    const ensureTicking = () => {
        if (tickHandle != null)
            return;
        tickHandle = self.setInterval(tick, TICK_MS);
    };
    const setupPubSubSubscriptions = () => {
        if (pubSubReady || !bus._brokerPort)
            return;
        pubSubReady = true;
        const debugLevel = bus._options.debug ?? 0;
        if (debugLevel >= 1) {
            console.log("📢 Fleets worker setting up pub/sub subscriptions");
        }
        bus.subscribe("ops", handleOps);
        bus.subscribe("ops_local", handleOps);
        bus.subscribe("clearGalaxy", handleClearGalaxy);
        bus.subscribe("generate_fleet", () => {
            spawnFleet();
        });
        ensureTicking();
    };
    if (bus._brokerPort) {
        setupPubSubSubscriptions();
    }
    bus.on("setup_broker_port", () => {
        setupPubSubSubscriptions();
    });
    bus.send("worker_ready", { role: "fleets" });
    return {
        destroy: () => {
            if (tickHandle != null) {
                clearInterval(tickHandle);
                tickHandle = null;
            }
            fleets.clear();
            clusters.clear();
            clusterIds.length = 0;
            clusterEdges.clear();
        },
    };
}
//# sourceMappingURL=fleets-worker.js.map