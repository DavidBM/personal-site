import { opAddCluster, opAddSolarSystem, opConnectClusters, opConnectSolarSystems, opRemoveCluster, } from "./galaxy-ops.js";
import { distZX, tooCloseZX, lineSegmentsCrossXZ, angleXZ, pointAtAngle, lineIntersectsClusterZX, bellCurveRandomRadius, } from "./galaxy-xz-math.js";
import { randomPointInDisk_PositiveY, randomClusterColor, } from "./galaxy-utils.js";
import { OperationBatcher } from "./flush/operation-batcher.js";
import { buildClusterSolarSystemPlan } from "../../cluster-solar-system-plan.js";
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
        const jumpGates = cluster.solarSystems.filter((s) => s.isJumpGate);
        if (!jumpGates.length) {
            console.error("No jump gates found in cluster", cluster);
            return;
        }
        const plan = buildClusterSolarSystemPlan({
            clusterId: cluster.id,
            clusterPosition: cluster.position,
            clusterRadius: cluster.radius,
            numSolarSystems: this.params.numSolarSystems,
            jumpGates: jumpGates.map((gate) => ({
                id: gate.id,
                name: gate.name,
                position: gate.position,
                connectedToClusterId: gate.connectedToClusterId ?? null,
            })),
            nextSystemId: this.globalSystemCounter,
        });
        this.globalSystemCounter = plan.nextSystemId;
        if (!plan.success) {
            console.warn("Failed to generate valid solar system connectivity in cluster", cluster.id);
            cluster.solarSystems = jumpGates;
            cluster.maxSystemDistance = 0;
            return;
        }
        const newSystems = plan.systems.map((sys) => ({
            id: sys.id,
            name: sys.name,
            position: sys.position,
            connections: [],
            isJumpGate: false,
            connectedToClusterId: null,
        }));
        cluster.solarSystems = [...jumpGates, ...newSystems];
        for (const sys of cluster.solarSystems) {
            sys.connections = [];
        }
        for (const sys of newSystems) {
            this.opBatcher.add(opAddSolarSystem(cluster.id, {
                id: sys.id,
                name: sys.name,
                position: sys.position,
                connections: [],
                isJumpGate: sys.isJumpGate,
                connectedToClusterId: sys.connectedToClusterId ?? null,
            }));
        }
        const idToSys = new Map(cluster.solarSystems.map((sys) => [sys.id, sys]));
        const processedConnections = new Set();
        for (const [id1, id2] of plan.connections) {
            const sys1 = idToSys.get(id1);
            const sys2 = idToSys.get(id2);
            if (!sys1 || !sys2)
                continue;
            if (!sys1.connections.includes(sys2.id)) {
                sys1.connections.push(sys2.id);
            }
            if (!sys2.connections.includes(sys1.id)) {
                sys2.connections.push(sys1.id);
            }
            const connectionKey = sys1.id < sys2.id ? `${sys1.id}-${sys2.id}` : `${sys2.id}-${sys1.id}`;
            if (!processedConnections.has(connectionKey)) {
                processedConnections.add(connectionKey);
                this.opBatcher.add(opConnectSolarSystems(cluster.id, sys1.id, sys2.id));
            }
        }
        cluster.maxSystemDistance = plan.maxSystemDistance;
    }
    generateAllSolarSystems() {
        for (let cIdx = 0; cIdx < this.clusters.length; ++cIdx) {
            this.generateSolarSystemsForCluster(this.clusters[cIdx]);
        }
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