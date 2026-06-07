import * as THREE from "../vendor/three.js";
import GalaxyConnectionLines from "../gfx-utils/galaxy-connection-lines.js";
const RENDER_PLANE_Y = 0;
export class GalaxyConnectionLayer {
    constructor(scene) {
        const material = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.7,
            linewidth: 1,
        });
        this.lines = new GalaxyConnectionLines(material, 1000);
        this.connections = [];
        scene.add(this.lines.getGroup());
    }
    makeConnectionKey(cluster1, cluster2, jumpGate1, jumpGate2) {
        let arr = [cluster1.id, cluster2.id, jumpGate1.id, jumpGate2.id];
        if (cluster1.id > cluster2.id ||
            (cluster1.id === cluster2.id && jumpGate1.id > jumpGate2.id)) {
            arr = [cluster2.id, cluster1.id, jumpGate2.id, jumpGate1.id];
        }
        return arr.join("_");
    }
    connectClusters(cluster1, cluster2, jumpGate1, jumpGate2) {
        if (!jumpGate1 || !jumpGate2)
            return;
        const key = this.makeConnectionKey(cluster1, cluster2, jumpGate1, jumpGate2);
        this.lines.addConnection(projectToRenderPlane(jumpGate1.position), projectToRenderPlane(jumpGate2.position), 0x00ffff, key);
        this.connections.push({ cluster1, cluster2, jumpGate1, jumpGate2 });
        if (!cluster1.connectedConnectionKeys)
            cluster1.connectedConnectionKeys = [];
        if (!cluster2.connectedConnectionKeys)
            cluster2.connectedConnectionKeys = [];
        cluster1.connectedConnectionKeys.push(key);
        cluster2.connectedConnectionKeys.push(key);
    }
    updateClusterConnections(clusterId) {
        for (const conn of this.connections) {
            if (conn.cluster1.id !== clusterId && conn.cluster2.id !== clusterId) {
                continue;
            }
            const key = this.makeConnectionKey(conn.cluster1, conn.cluster2, conn.jumpGate1, conn.jumpGate2);
            this.lines.updateConnection(key, projectToRenderPlane(conn.jumpGate1.position), projectToRenderPlane(conn.jumpGate2.position));
        }
    }
    removeConnectionByKey(key) {
        return this.lines.removeConnection(key);
    }
    removeClusterConnection(cluster1, cluster2, jumpGate1, jumpGate2) {
        const key = this.makeConnectionKey(cluster1, cluster2, jumpGate1, jumpGate2);
        for (let i = this.connections.length - 1; i >= 0; i--) {
            const conn = this.connections[i];
            if (conn.cluster1.id === cluster1.id &&
                conn.cluster2.id === cluster2.id &&
                conn.jumpGate1.id === jumpGate1.id &&
                conn.jumpGate2.id === jumpGate2.id) {
                this.connections.splice(i, 1);
            }
        }
        return this.removeConnectionByKey(key);
    }
    getConnectionSlot(key) {
        return this.lines.keyToIndex.get(key);
    }
    get positions() {
        return this.lines.positions;
    }
    finalize() {
        this.lines.finalizeBuffers();
    }
    clear() {
        this.lines.clear();
        this.connections.length = 0;
    }
}
function projectToRenderPlane(position) {
    return new THREE.Vector3(position.x, RENDER_PLANE_Y, position.z);
}
//# sourceMappingURL=galaxy-connection-layer.js.map