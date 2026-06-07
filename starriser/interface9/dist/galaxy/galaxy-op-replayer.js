import { Cluster } from "../cluster.js";
import { SolarSystem } from "../solar-system.js";
export function replayGalaxyOps(galaxy, ops, state) {
    let maxSolarSystemId = state.maxSolarSystemId;
    if (!Array.isArray(ops)) {
        return { maxSolarSystemId };
    }
    for (const op of ops) {
        switch (op.type) {
            case "addCluster": {
                const cluster = new Cluster(op.payload, galaxy);
                galaxy.addCluster(cluster);
                break;
            }
            case "addSolarSystem": {
                const cluster = galaxy.getClusterById(op.payload.clusterId);
                if (!cluster)
                    break;
                const solarSystem = new SolarSystem(op.payload);
                galaxy.addSolarSystem(cluster, solarSystem);
                if (solarSystem.id > maxSolarSystemId) {
                    maxSolarSystemId = solarSystem.id;
                }
                break;
            }
            case "removeSolarSystem": {
                const { clusterId, solarSystemId } = op.payload;
                const cluster = galaxy.getClusterById(clusterId);
                const solarSystem = cluster
                    ? galaxy.getSolarSystemById(clusterId, solarSystemId)
                    : null;
                if (cluster && solarSystem) {
                    galaxy.removeSolarSystem(cluster, solarSystem);
                }
                break;
            }
            case "connectSolarSystems": {
                const { clusterId, solarSystemId1, solarSystemId2 } = op.payload;
                const cluster = galaxy.getClusterById(clusterId);
                if (!cluster)
                    break;
                const solarSystem1 = galaxy.getSolarSystemById(clusterId, solarSystemId1);
                const solarSystem2 = galaxy.getSolarSystemById(clusterId, solarSystemId2);
                if (solarSystem1 && solarSystem2) {
                    galaxy.addSolarSystemConnection(cluster, solarSystem1, solarSystem2);
                }
                break;
            }
            case "connectClusters": {
                const { clusterId1, clusterId2, jumpGate1, jumpGate2 } = op.payload;
                const cluster1 = galaxy.getClusterById(clusterId1);
                const cluster2 = galaxy.getClusterById(clusterId2);
                const jumpGateObj1 = cluster1
                    ? galaxy.getSolarSystemById(clusterId1, jumpGate1.id)
                    : null;
                const jumpGateObj2 = cluster2
                    ? galaxy.getSolarSystemById(clusterId2, jumpGate2.id)
                    : null;
                if (cluster1 && cluster2 && jumpGateObj1 && jumpGateObj2) {
                    galaxy.connectClusters(cluster1, cluster2, jumpGateObj1, jumpGateObj2);
                }
                break;
            }
            case "removeConnection": {
                const { clusterId1, clusterId2, jumpGate1, jumpGate2 } = op.payload;
                const cluster1 = galaxy.getClusterById(clusterId1);
                const cluster2 = galaxy.getClusterById(clusterId2);
                const jumpGateObj1 = cluster1 && jumpGate1
                    ? galaxy.getSolarSystemById(clusterId1, jumpGate1.id)
                    : null;
                const jumpGateObj2 = cluster2 && jumpGate2
                    ? galaxy.getSolarSystemById(clusterId2, jumpGate2.id)
                    : null;
                if (cluster1 && cluster2 && jumpGateObj1 && jumpGateObj2) {
                    galaxy.removeClusterConnection(cluster1, cluster2, jumpGateObj1, jumpGateObj2);
                }
                break;
            }
            case "removeCluster": {
                const cluster = galaxy.getClusterById(op.payload.clusterId);
                if (cluster) {
                    galaxy.removeCluster(cluster);
                }
                break;
            }
        }
    }
    return { maxSolarSystemId };
}
//# sourceMappingURL=galaxy-op-replayer.js.map