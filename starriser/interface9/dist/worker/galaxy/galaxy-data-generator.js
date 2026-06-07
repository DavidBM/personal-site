import { buildClusterSolarSystemPlan } from "../../cluster-solar-system-plan.js";
import { OperationBatcher } from "./flush/operation-batcher.js";
import { planClusterConnections } from "./generation/cluster-connection-planner.js";
import { placeCluster } from "./generation/cluster-placement.js";
import { emitAddCluster, emitAddSolarSystem, emitClusterConnection, emitRemoveCluster, emitSolarSystemConnection, } from "./generation/galaxy-op-emitter.js";
import { normalizeGalaxyParams, } from "./generation/generation-params.js";
class GalaxyGenerator {
    constructor(params) {
        this.params = normalizeGalaxyParams(params);
        this.globalSystemCounter = 1;
        this.globalClusterCounter = 1;
        this.connectionSet = new Set();
        this.clusters = [];
        this.galaxyRadius = this.params.galaxySize;
        this.heightVar =
            (this.galaxyRadius * this.params.heightVariation) / 100;
        this.clusterPositions = [];
        this.opBatcher = new OperationBatcher({
            batchSize: this.params.batchSize,
            onBatch: this.params.onBatch,
        });
    }
    flush() {
        this.opBatcher.flush(true);
    }
    generateCluster() {
        const cluster = placeCluster({
            id: this.globalClusterCounter,
            galaxyRadius: this.galaxyRadius,
            heightVar: this.heightVar,
            minDistance: this.params.minDistance,
            centerBias: this.params.centerBias,
            clusterPositions: this.clusterPositions,
        });
        if (!cluster)
            return null;
        this.globalClusterCounter++;
        this.clusters.push(cluster);
        emitAddCluster(this.opBatcher, cluster);
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
            emitAddSolarSystem(this.opBatcher, cluster.id, sys);
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
                emitSolarSystemConnection(this.opBatcher, cluster.id, sys1, sys2);
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
        const plan = planClusterConnections({
            clusters: this.clusters,
            maxConnections: this.params.maxConnections,
            minDistance: this.params.minDistance,
            connectionSet: this.connectionSet,
            nextSystemId: this.globalSystemCounter,
        });
        this.globalSystemCounter = plan.nextSystemId;
        for (const connection of plan.connections) {
            for (const { cluster, gate } of connection.gateAdditions) {
                emitAddSolarSystem(this.opBatcher, cluster.id, gate);
            }
            emitClusterConnection(this.opBatcher, connection);
            this.opBatcher.flush(true);
        }
    }
    removeEmptyClusters() {
        for (let k = this.clusters.length - 1; k >= 0; --k) {
            const cluster = this.clusters[k];
            if (cluster.connectedTo.length === 0) {
                this.clusters.splice(k, 1);
                emitRemoveCluster(this.opBatcher, cluster.id);
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
export function generateGalaxyData(params) {
    const generator = new GalaxyGenerator(params);
    return generator.generate();
}
//# sourceMappingURL=galaxy-data-generator.js.map