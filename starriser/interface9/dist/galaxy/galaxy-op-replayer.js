import { Cluster } from "../cluster.js";
import { SolarSystem } from "../solar-system.js";
import { applyOps } from "../worker/galaxy/apply-ops.js";
export function replayGalaxyOps(galaxy, ops, state) {
    let maxSolarSystemId = state.maxSolarSystemId;
    applyOps(ops, {
        addCluster: (payload) => {
            const cluster = new Cluster(payload);
            galaxy.addCluster(cluster);
        },
        addSolarSystem: (payload) => {
            const cluster = galaxy.getClusterById(payload.clusterId);
            if (!cluster)
                return;
            const solarSystem = new SolarSystem(payload);
            galaxy.addSolarSystem(cluster, solarSystem);
            if (solarSystem.id > maxSolarSystemId) {
                maxSolarSystemId = solarSystem.id;
            }
        },
        removeSolarSystem: ({ clusterId, solarSystemId }) => {
            const cluster = galaxy.getClusterById(clusterId);
            const solarSystem = cluster
                ? galaxy.getSolarSystemById(clusterId, solarSystemId)
                : null;
            if (cluster && solarSystem) {
                galaxy.removeSolarSystem(cluster, solarSystem);
            }
        },
        connectSolarSystems: ({ clusterId, solarSystemId1, solarSystemId2 }) => {
            const cluster = galaxy.getClusterById(clusterId);
            if (!cluster)
                return;
            const solarSystem1 = galaxy.getSolarSystemById(clusterId, solarSystemId1);
            const solarSystem2 = galaxy.getSolarSystemById(clusterId, solarSystemId2);
            if (solarSystem1 && solarSystem2) {
                galaxy.addSolarSystemConnection(cluster, solarSystem1, solarSystem2);
            }
        },
        connectClusters: ({ clusterId1, clusterId2, jumpGate1, jumpGate2 }) => {
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
        },
        removeConnection: ({ clusterId1, clusterId2, jumpGate1, jumpGate2 }) => {
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
        },
        removeCluster: ({ clusterId }) => {
            const cluster = galaxy.getClusterById(clusterId);
            if (cluster) {
                galaxy.removeCluster(cluster);
            }
        },
    });
    return { maxSolarSystemId };
}
//# sourceMappingURL=galaxy-op-replayer.js.map