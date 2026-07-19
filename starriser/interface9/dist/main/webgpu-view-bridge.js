/**
 * GalaxyViewHooks → WebGpuMapView (points + connections; fleets via status API).
 */
import { makeConnectionKey, makeSolarConnectionKey, } from "../contracts/connection-key.js";
import { RENDER_PLANE_Y } from "../contracts/render-constants.js";
function endpoint(sys) {
    return {
        x: sys.position.x,
        y: RENDER_PLANE_Y,
        z: sys.position.z,
    };
}
export function createWebGpuViewHooks(view, getGalaxy) {
    return {
        onClusterAdded: () => { },
        onClusterRemoved: (cluster) => {
            for (const s of cluster.solarSystems) {
                view.removeSolarSystem(cluster, s);
            }
        },
        onSolarSystemAdded: (cluster, solarSystem) => {
            view.addSolarSystem(cluster, solarSystem);
        },
        onSolarSystemRemoved: (cluster, solarSystem) => {
            view.removeSolarSystem(cluster, solarSystem);
        },
        onClusterConnectionAdded: (c1, c2, g1, g2) => {
            const key = makeConnectionKey(c1, c2, g1, g2);
            view.addConnection(key, endpoint(g1), endpoint(g2), 0x4488ff);
        },
        onClusterConnectionRemoved: (c1, c2, g1, g2) => {
            view.removeConnection(makeConnectionKey(c1, c2, g1, g2));
        },
        onSolarSystemConnectionAdded: (cluster, a, b) => {
            const key = makeSolarConnectionKey(cluster.id, a.id, b.id);
            view.addConnection(key, endpoint(a), endpoint(b), 0x336655);
        },
        onSolarSystemConnectionRemoved: (cluster, a, b) => {
            view.removeConnection(makeSolarConnectionKey(cluster.id, a.id, b.id));
        },
        onSolarSystemPositionsUpdated: (systems) => {
            view.updateSolarSystemPositions(systems);
        },
        onSolarSystemConnectionsUpdated: (cluster) => {
            refreshSolarConnections(view, cluster);
        },
        onClusterConnectionsUpdated: (_clusterId) => {
            // Refresh all inter-cluster edges from topology (drag moves gates).
            refreshClusterConnections(view, getGalaxy());
        },
        onHoveredCluster: (cluster) => {
            if (!cluster) {
                view.setHoverRing(null);
                return;
            }
            view.setHoverRing({
                x: cluster.position.x,
                z: cluster.position.z,
                radius: cluster.radius || 400,
            });
        },
        onSelectedCluster: (cluster) => {
            if (!cluster) {
                view.setSelectRing(null);
                return;
            }
            view.setSelectRing({
                x: cluster.position.x,
                z: cluster.position.z,
                radius: cluster.radius || 400,
            });
        },
        onShowEditHandles: (clusterId, handles) => {
            const cluster = getGalaxy().getClusterById(clusterId);
            const radius = cluster?.radius ?? 400;
            view.showEditHandles(clusterId, handles, radius);
        },
        onHideEditHandles: () => {
            view.hideEditHandles();
        },
    };
}
function refreshSolarConnections(view, cluster) {
    for (const sys of cluster.solarSystems) {
        for (const otherId of sys.connections) {
            if (otherId <= sys.id)
                continue;
            const other = cluster.getSolarSystemById(otherId);
            if (!other)
                continue;
            const key = makeSolarConnectionKey(cluster.id, sys.id, other.id);
            if (!view.updateConnectionEndpoints(key, endpoint(sys), endpoint(other))) {
                view.addConnection(key, endpoint(sys), endpoint(other), 0x336655);
            }
        }
    }
}
function refreshClusterConnections(view, galaxy) {
    for (const edge of galaxy.connections) {
        const key = makeConnectionKey(edge.cluster1, edge.cluster2, edge.jumpGate1, edge.jumpGate2);
        if (!view.updateConnectionEndpoints(key, endpoint(edge.jumpGate1), endpoint(edge.jumpGate2))) {
            view.addConnection(key, endpoint(edge.jumpGate1), endpoint(edge.jumpGate2), 0x4488ff);
        }
    }
}
/** Finalize safety net: rebuild all edges from topology. */
export function rebuildWebGpuConnectionsFromGalaxy(view, galaxy) {
    view.clearLines();
    for (const cluster of galaxy.clusters) {
        refreshSolarConnections(view, cluster);
    }
    for (const edge of galaxy.connections) {
        const key = makeConnectionKey(edge.cluster1, edge.cluster2, edge.jumpGate1, edge.jumpGate2);
        view.addConnection(key, endpoint(edge.jumpGate1), endpoint(edge.jumpGate2), 0x4488ff);
    }
}
//# sourceMappingURL=webgpu-view-bridge.js.map