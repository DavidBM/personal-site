import { Cluster } from "./cluster.js";
import { SolarSystem } from "./solar-system.js";
/**
 * Live builder for applying operation-log based galaxy mutations.
 * All methods operate on the provided Galaxy instance; updating it in-place.
 */
export class IncrementalGalaxyBuilder {
    /**
     * @param {Galaxy} galaxy - Existing Galaxy instance to mutate (rendered live!)
     */
    constructor(galaxy) {
        this.galaxy = galaxy;
        this.idToCluster = new Map();
        this.idToSolarSystem = new Map();
    }
    /**
     * Apply an array of ops (from the worker) directly to this.galaxy.
     */
    applyOps(ops) {
        for (const op of ops) {
            switch (op.type) {
                case "addCluster": {
                    const d = op.payload;
                    const cluster = new Cluster(d, this.galaxy);
                    this.galaxy.addCluster(cluster);
                    this.idToCluster.set(cluster.id, cluster);
                    break;
                }
                case "addSolarSystem": {
                    const d = op.payload;
                    const cluster = this.idToCluster.get(d.clusterId);
                    if (!cluster)
                        break;
                    const sys = new SolarSystem({
                        id: d.id,
                        name: d.name,
                        position: d.position,
                        isJumpGate: d.isJumpGate ?? false,
                        connections: d.connections ?? [],
                        connectedToClusterId: d.connectedToClusterId ?? null,
                    });
                    this.galaxy.addSolarSystem(cluster, sys);
                    this.idToSolarSystem.set(`${d.clusterId}:${d.id}`, sys);
                    break;
                }
                case "connectClusters": {
                    const { clusterId1, clusterId2, jumpGate1, jumpGate2 } = op.payload;
                    const cluster1 = this.idToCluster.get(clusterId1);
                    const cluster2 = this.idToCluster.get(clusterId2);
                    if (!cluster1 || !cluster2)
                        break;
                    const jumpGate1Obj = this.idToSolarSystem.get(`${clusterId1}:${jumpGate1.id}`);
                    const jumpGate2Obj = this.idToSolarSystem.get(`${clusterId2}:${jumpGate2.id}`);
                    if (!jumpGate1Obj || !jumpGate2Obj)
                        break;
                    this.galaxy.connectClusters(cluster1, cluster2, jumpGate1Obj, jumpGate2Obj);
                    break;
                }
                case "removeCluster": {
                    const { clusterId } = op.payload;
                    const cluster = this.idToCluster.get(clusterId);
                    if (!cluster)
                        break;
                    for (const solarSystem of cluster.solarSystems) {
                        const solarSystemKey = `${clusterId}:${solarSystem.id}`;
                        this.idToSolarSystem.delete(solarSystemKey);
                    }
                    this.galaxy.removeCluster(cluster);
                    this.idToCluster.delete(clusterId);
                    break;
                }
                default:
                    break;
            }
        }
    }
}
//# sourceMappingURL=incremental-galaxy-builder.js.map