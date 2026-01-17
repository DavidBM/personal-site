import { opAddCluster, opAddSolarSystem, opConnectClusters, opConnectSolarSystems, opRemoveCluster, } from "./galaxy-ops.js";
import { distZX, tooCloseZX, lineSegmentsCrossXZ, angleXZ, pointAtAngle, pointLineDistZX, lineIntersectsClusterZX, bellCurveRandomRadius, } from "./galaxy-xz-math.js";
import { randomPointInDisk_PositiveY, randomClusterColor, } from "./galaxy-utils.js";
import { OperationBatcher } from "./flush/operation-batcher.js";
const SOLAR_SYSTEM_MIN_DIST_FACTOR = 3; // Adjust: 1.0 = pure circumference-based, >1=spaced out
class GalaxyGenerator {
    constructor(params) {
        const { numClusters = 1000, numSolarSystems = 100, minDistance = 300, galaxySize = 25, heightVariation = 1.3, maxConnections = 3, batchSize = 100, onBatch, centerBias = 0.6, } = params;
        this.params = {
            numClusters,
            numSolarSystems,
            minDistance,
            galaxySize,
            heightVariation,
            maxConnections,
            batchSize,
            onBatch,
            centerBias,
        };
        this.globalSystemCounter = 1;
        this.globalClusterCounter = 1;
        this.connectionSet = new Set();
        this.clusters = [];
        this.galaxyRadius = galaxySize;
        this.heightVar = (this.galaxyRadius * heightVariation) / 100;
        this.clusterPositions = [];
        this.opBatcher = new OperationBatcher({
            batchSize,
            onBatch,
        });
    }
    flush() {
        this.opBatcher.flush(true);
    }
    generateCluster() {
        const { minDistance, centerBias } = this.params;
        const radius = bellCurveRandomRadius(this.galaxyRadius, centerBias);
        const pos = randomPointInDisk_PositiveY(radius, this.heightVar);
        if (tooCloseZX(pos, this.clusterPositions, minDistance)) {
            return null;
        }
        this.clusterPositions.push(pos);
        const id = this.globalClusterCounter++;
        const cluster = {
            id,
            name: `Cluster ${id}`,
            position: pos,
            color: randomClusterColor(),
            radius: 250,
            maxSystemDistance: 0,
            connectedTo: [],
            solarSystems: [],
        };
        this.clusters.push(cluster);
        this.opBatcher.add(opAddCluster(cluster));
        return cluster;
    }
    generateAllClusters() {
        for (let n = 0; n < this.params.numClusters; ++n) {
            this.generateCluster();
        }
    }
    generateSolarSystemsForCluster(cluster) {
        const numSolarSystems = this.params.numSolarSystems;
        const MAX_RETRIES = 2000;
        const N_NEIGHBORS = 3; // Maximum connections per system
        const jumpGates = cluster.solarSystems.filter((s) => s.isJumpGate);
        if (!jumpGates.length) {
            console.error("No jump gates found in cluster", cluster);
            return;
        }
        let attempt = 0;
        let success = false;
        while (!success && attempt < MAX_RETRIES) {
            cluster.solarSystems = cluster.solarSystems.filter((s) => s.isJumpGate);
            const sysPositions = [];
            const safeRadius = cluster.radius * 0.95;
            const minInterSSDist = ((2 * Math.PI * safeRadius) / numSolarSystems) *
                SOLAR_SYSTEM_MIN_DIST_FACTOR;
            let ssAttempt = 0;
            let s = 0;
            const maxSSA = numSolarSystems * 10;
            while (s < numSolarSystems && ssAttempt < maxSSA) {
                const r = Math.sqrt(Math.random()) * safeRadius;
                const theta = Math.random() * Math.PI * 2;
                const spos = {
                    x: cluster.position.x + r * Math.cos(theta),
                    y: cluster.position.y + Math.random() * 15,
                    z: cluster.position.z + r * Math.sin(theta),
                };
                if (tooCloseZX(spos, sysPositions, minInterSSDist)) {
                    ssAttempt++;
                    continue;
                }
                sysPositions.push(spos);
                const sysId = this.globalSystemCounter++;
                const sys = {
                    id: sysId,
                    name: `System ${cluster.id}-${sysPositions.length}`,
                    position: spos,
                    connections: [],
                    isJumpGate: false,
                    connectedToClusterId: null,
                };
                cluster.solarSystems.push(sys);
                s++;
                ssAttempt++;
            }
            for (const sys of cluster.solarSystems) {
                sys.connections = [];
            }
            const allSystems = [...cluster.solarSystems];
            const idToSys = new Map(allSystems.map((sys) => [sys.id, sys]));
            const existingConnections = [];
            const connectionExists = (sys1, sys2) => sys1.connections.includes(sys2.id);
            const addConnection = (sys1, sys2) => {
                if (!connectionExists(sys1, sys2) &&
                    sys1.connections.length < N_NEIGHBORS &&
                    sys2.connections.length < N_NEIGHBORS) {
                    sys1.connections.push(sys2.id);
                    sys2.connections.push(sys1.id);
                    existingConnections.push({ from: sys1, to: sys2 });
                    return true;
                }
                return false;
            };
            const connectionsWouldCross = (sys1, sys2) => {
                for (const conn of existingConnections) {
                    if (lineSegmentsCrossXZ(sys1.position, sys2.position, conn.from.position, conn.to.position)) {
                        return true;
                    }
                }
                const MIN_DISTANCE_TO_SYSTEM = 25;
                for (const otherSys of allSystems) {
                    if (otherSys.id === sys1.id || otherSys.id === sys2.id)
                        continue;
                    const distToConnection = pointLineDistZX(otherSys.position, sys1.position, sys2.position);
                    if (distToConnection < MIN_DISTANCE_TO_SYSTEM) {
                        return true;
                    }
                }
                return false;
            };
            const systemsToProcess = [...allSystems].sort((a, b) => a.id - b.id);
            for (const sys of systemsToProcess) {
                const candidates = allSystems
                    .filter((other) => other.id !== sys.id && !connectionExists(sys, other))
                    .map((other) => ({
                    sys: other,
                    dist: distZX(sys.position, other.position),
                }))
                    .sort((a, b) => a.dist - b.dist);
                for (const candidate of candidates) {
                    if (sys.connections.length >= N_NEIGHBORS)
                        break;
                    if (candidate.sys.connections.length >= N_NEIGHBORS)
                        continue;
                    if (sys.isJumpGate && candidate.sys.isJumpGate)
                        continue;
                    if (!connectionsWouldCross(sys, candidate.sys)) {
                        addConnection(sys, candidate.sys);
                    }
                }
            }
            const toRemove = [];
            for (const sys of allSystems) {
                if (!sys.isJumpGate && sys.connections.length === 0) {
                    toRemove.push(sys);
                }
            }
            for (const sys of toRemove) {
                const index = cluster.solarSystems.findIndex((s) => s.id === sys.id);
                if (index >= 0) {
                    cluster.solarSystems.splice(index, 1);
                }
            }
            if (this._checkFullConnectivity(cluster, jumpGates)) {
                success = true;
                break;
            }
            attempt++;
        }
        if (!success) {
            console.warn("Failed to generate valid solar system connectivity in cluster", cluster.id);
            cluster.solarSystems = cluster.solarSystems.filter((s) => s.isJumpGate);
            cluster.maxSystemDistance = 0;
            return;
        }
        for (const sys of cluster.solarSystems) {
            this.opBatcher.add(opAddSolarSystem(cluster.id, {
                id: sys.id,
                name: sys.name,
                position: sys.position,
                connections: [],
                isJumpGate: sys.isJumpGate,
                connectedToClusterId: sys.connectedToClusterId ?? null,
            }));
        }
        const processedConnections = new Set();
        for (const sys of cluster.solarSystems) {
            for (const connectedId of sys.connections) {
                const connectionKey = sys.id < connectedId
                    ? `${sys.id}-${connectedId}`
                    : `${connectedId}-${sys.id}`;
                if (!processedConnections.has(connectionKey)) {
                    processedConnections.add(connectionKey);
                    this.opBatcher.add(opConnectSolarSystems(cluster.id, sys.id, connectedId));
                }
            }
        }
        const regularPositions = cluster.solarSystems
            .filter((s) => !s.isJumpGate)
            .map((s) => s.position);
        cluster.maxSystemDistance =
            regularPositions.length > 0
                ? regularPositions.reduce((mx, p) => Math.max(mx, distZX(p, cluster.position)), 0)
                : 0;
    }
    generateAllSolarSystems() {
        for (let cIdx = 0; cIdx < this.clusters.length; ++cIdx) {
            this.generateSolarSystemsForCluster(this.clusters[cIdx]);
        }
    }
    _checkClusterConnectivity(cluster) {
        const sysList = cluster.solarSystems;
        const idToSys = new Map(sysList.map((s) => [s.id, s]));
        const getNeighbors = (s) => s.connections
            .map((id) => idToSys.get(id))
            .filter((sys) => !!sys);
        const jumpGates = sysList.filter((s) => s.isJumpGate);
        if (jumpGates.length === 0)
            return false;
        const visitedJG = new Set();
        const dfsJumpGate = (node) => {
            visitedJG.add(node.id);
            for (const n of getNeighbors(node)) {
                if (n.isJumpGate && !visitedJG.has(n.id))
                    dfsJumpGate(n);
            }
        };
        dfsJumpGate(jumpGates[0]);
        if (visitedJG.size < jumpGates.length)
            return false;
        for (const sys of sysList) {
            if (sys.isJumpGate)
                continue;
            const queue = [sys];
            const seen = new Set([sys.id]);
            let found = false;
            while (queue.length) {
                const curr = queue.shift();
                if (!curr)
                    break;
                if (curr.isJumpGate) {
                    found = true;
                    break;
                }
                for (const n of getNeighbors(curr)) {
                    if (!seen.has(n.id)) {
                        seen.add(n.id);
                        queue.push(n);
                    }
                }
            }
            if (!found)
                return false;
        }
        return true;
    }
    _checkFullConnectivity(cluster, jumpGates) {
        const sysList = cluster.solarSystems;
        const idToSys = new Map(sysList.map((s) => [s.id, s]));
        if (jumpGates.length === 0)
            return false;
        for (const sys of sysList) {
            const reachableJumpGates = new Set();
            const queue = [sys];
            const visited = new Set([sys.id]);
            while (queue.length > 0) {
                const current = queue.shift();
                if (!current)
                    break;
                if (current.isJumpGate) {
                    reachableJumpGates.add(current.id);
                }
                for (const connId of current.connections) {
                    const connSys = idToSys.get(connId);
                    if (connSys && !visited.has(connSys.id)) {
                        visited.add(connSys.id);
                        queue.push(connSys);
                    }
                }
            }
            if (reachableJumpGates.size < jumpGates.length) {
                return false;
            }
        }
        return true;
    }
    connectClusters() {
        const { maxConnections } = this.params;
        const ANGLE_THRESHOLD = (15 * Math.PI) / 180; // ±15 degrees
        const NEARBY_CANDIDATE_LIMIT = Math.max(12, maxConnections * 8);
        const cellSize = Math.max(this.params.minDistance, 1);
        const validConnections = [];
        const connectionCounts = new Map();
        const tempConnectionSet = new Set(this.connectionSet);
        for (const cl of this.clusters) {
            connectionCounts.set(cl.id, cl.connectedTo.length);
        }
        const clusterJumpGates = new Map();
        for (const cluster of this.clusters) {
            clusterJumpGates.set(cluster.id, cluster.solarSystems.filter((s) => s.isJumpGate));
        }
        const clusterGrid = new Map();
        const gridKey = (x, z) => `${Math.floor(x / cellSize)}:${Math.floor(z / cellSize)}`;
        const cellCoords = (pos) => [
            Math.floor(pos.x / cellSize),
            Math.floor(pos.z / cellSize),
        ];
        for (const cluster of this.clusters) {
            const key = gridKey(cluster.position.x, cluster.position.z);
            const cell = clusterGrid.get(key);
            if (cell) {
                cell.push(cluster);
            }
            else {
                clusterGrid.set(key, [cluster]);
            }
        }
        const collectNearbyClusters = (cluster, limit) => {
            const [cx, cz] = cellCoords(cluster.position);
            const nearby = [];
            const seen = new Set();
            const maxRing = 4;
            for (let ring = 0; ring <= maxRing && nearby.length < limit; ++ring) {
                for (let gx = cx - ring; gx <= cx + ring; ++gx) {
                    for (let gz = cz - ring; gz <= cz + ring; ++gz) {
                        if (ring > 0 &&
                            gx > cx - ring &&
                            gx < cx + ring &&
                            gz > cz - ring &&
                            gz < cz + ring) {
                            continue;
                        }
                        const cell = clusterGrid.get(`${gx}:${gz}`);
                        if (!cell)
                            continue;
                        for (const other of cell) {
                            if (seen.has(other.id))
                                continue;
                            seen.add(other.id);
                            nearby.push(other);
                            if (nearby.length >= limit)
                                break;
                        }
                        if (nearby.length >= limit)
                            break;
                    }
                    if (nearby.length >= limit)
                        break;
                }
            }
            return nearby;
        };
        const buildCandidates = (clusterA, clusters) => {
            const candidates = [];
            for (const clusterB of clusters) {
                if (clusterA === clusterB)
                    continue;
                if ((connectionCounts.get(clusterB.id) ?? 0) >= maxConnections)
                    continue;
                const key = `${Math.min(clusterA.id, clusterB.id)}:${Math.max(clusterA.id, clusterB.id)}`;
                if (tempConnectionSet.has(key))
                    continue;
                if (clusterA.connectedTo.includes(clusterB.id) ||
                    clusterB.connectedTo.includes(clusterA.id)) {
                    continue;
                }
                const distance = distZX(clusterA.position, clusterB.position);
                candidates.push({ clusterB, distance, key });
            }
            return candidates;
        };
        const findExistingJumpGate = (cluster, targetAngle) => {
            const existingGates = clusterJumpGates.get(cluster.id) ?? [];
            for (const gate of existingGates) {
                const gateAngle = angleXZ(cluster.position, gate.position);
                let angleDiff = Math.abs(targetAngle - gateAngle);
                if (angleDiff > Math.PI) {
                    angleDiff = 2 * Math.PI - angleDiff;
                }
                if (angleDiff <= ANGLE_THRESHOLD) {
                    return gate;
                }
            }
            return null;
        };
        const getOrCreateJumpGate = (cluster, targetCluster) => {
            const targetAngle = angleXZ(cluster.position, targetCluster.position);
            const existingGate = findExistingJumpGate(cluster, targetAngle);
            if (existingGate) {
                existingGate.connectedToClusterId = null;
                existingGate.name = `Shared JumpGate ${cluster.id}`;
                return existingGate;
            }
            const radius = cluster.radius * 1.07;
            const pos = pointAtAngle(cluster.position, radius, targetAngle);
            const newGate = {
                id: this.globalSystemCounter++,
                name: `JumpGate ${cluster.id}->${targetCluster.id}`,
                position: pos,
                connections: [],
                isJumpGate: true,
                connectedToClusterId: targetCluster.id,
            };
            const gates = clusterJumpGates.get(cluster.id) ?? [];
            gates.push(newGate);
            clusterJumpGates.set(cluster.id, gates);
            return newGate;
        };
        const addedGates = new Set();
        for (let i = 0; i < this.clusters.length; ++i) {
            const clusterA = this.clusters[i];
            if ((connectionCounts.get(clusterA.id) ?? 0) >= maxConnections)
                continue;
            const nearbyClusters = collectNearbyClusters(clusterA, NEARBY_CANDIDATE_LIMIT);
            let candidates = buildCandidates(clusterA, nearbyClusters);
            let usedFallback = false;
            if (!candidates.length) {
                candidates = buildCandidates(clusterA, this.clusters);
                usedFallback = true;
            }
            candidates.sort((a, b) => a.distance - b.distance);
            if (!usedFallback && candidates.length > NEARBY_CANDIDATE_LIMIT) {
                candidates.length = NEARBY_CANDIDATE_LIMIT;
            }
            for (const { clusterB, key } of candidates) {
                if ((connectionCounts.get(clusterA.id) ?? 0) >= maxConnections) {
                    continue;
                }
                if ((connectionCounts.get(clusterB.id) ?? 0) >= maxConnections) {
                    break;
                }
                const gateA = getOrCreateJumpGate(clusterA, clusterB);
                const gateB = getOrCreateJumpGate(clusterB, clusterA);
                const posA = { x: gateA.position.x, z: gateA.position.z };
                const posB = { x: gateB.position.x, z: gateB.position.z };
                let blocked = false;
                for (const validConn of validConnections) {
                    const posC = {
                        x: validConn.gateA.position.x,
                        z: validConn.gateA.position.z,
                    };
                    const posD = {
                        x: validConn.gateB.position.x,
                        z: validConn.gateB.position.z,
                    };
                    if (clusterA.id !== validConn.clusterA.id &&
                        clusterA.id !== validConn.clusterB.id &&
                        clusterB.id !== validConn.clusterA.id &&
                        clusterB.id !== validConn.clusterB.id &&
                        lineSegmentsCrossXZ(posA, posB, posC, posD)) {
                        blocked = true;
                        break;
                    }
                }
                if (!blocked &&
                    lineIntersectsClusterZX(posA, posB, this.clusters, [
                        clusterA.id,
                        clusterB.id,
                    ])) {
                    blocked = true;
                }
                if (!blocked) {
                    validConnections.push({
                        clusterA,
                        clusterB,
                        gateA,
                        gateB,
                        key,
                    });
                    tempConnectionSet.add(key);
                    connectionCounts.set(clusterA.id, (connectionCounts.get(clusterA.id) ?? 0) + 1);
                    connectionCounts.set(clusterB.id, (connectionCounts.get(clusterB.id) ?? 0) + 1);
                    this.connectionSet.add(key);
                    if (!addedGates.has(gateA.id)) {
                        if (!clusterA.solarSystems.find((s) => s.id === gateA.id)) {
                            clusterA.solarSystems.push(gateA);
                            this.opBatcher.add(opAddSolarSystem(clusterA.id, gateA));
                        }
                        addedGates.add(gateA.id);
                    }
                    if (!addedGates.has(gateB.id)) {
                        if (!clusterB.solarSystems.find((s) => s.id === gateB.id)) {
                            clusterB.solarSystems.push(gateB);
                            this.opBatcher.add(opAddSolarSystem(clusterB.id, gateB));
                        }
                        addedGates.add(gateB.id);
                    }
                    clusterA.connectedTo.push(clusterB.id);
                    clusterB.connectedTo.push(clusterA.id);
                    this.opBatcher.add(opConnectClusters(clusterA.id, clusterB.id, { id: gateA.id }, { id: gateB.id }));
                    this.opBatcher.flush(true);
                    if ((connectionCounts.get(clusterA.id) ?? 0) >= maxConnections)
                        break;
                }
            }
        }
    }
    removeEmptyClusters() {
        for (let k = this.clusters.length - 1; k >= 0; --k) {
            const cl = this.clusters[k];
            if (cl.connectedTo.length === 0) {
                this.clusters.splice(k, 1);
                this.opBatcher.add(opRemoveCluster(cl.id));
            }
        }
    }
    generate() {
        this.generateAllClusters();
        this.connectClusters();
        this.removeEmptyClusters();
        this.generateAllSolarSystems();
        this.flush();
        return { clusters: this.clusters };
    }
}
/**
 * Generate a galaxy: clusters and their solar systems, with inter-cluster connections.
 */
export function generateGalaxyData(params) {
    const generator = new GalaxyGenerator(params);
    return generator.generate();
}
//# sourceMappingURL=galaxy-data-generator.js.map