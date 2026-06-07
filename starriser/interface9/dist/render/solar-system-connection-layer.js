import * as THREE from "../vendor/three.js";
import GalaxyConnectionLines from "../gfx-utils/galaxy-connection-lines.js";
const RENDER_PLANE_Y = 0;
export class SolarSystemConnectionLayer {
    constructor(scene) {
        const material = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.7,
            linewidth: 1,
        });
        this.lines = new GalaxyConnectionLines(material, 2000);
        scene.add(this.lines.getGroup());
    }
    addConnection(cluster, solarSystemA, solarSystemB, options = {}) {
        if (!solarSystemA || !solarSystemB)
            return;
        const key = GalaxyConnectionLines.makeKey(solarSystemA.id, solarSystemB.id) +
            `_${cluster.id}`;
        const color = options.color || 0xffc700;
        this.lines.addConnection(projectToRenderPlane(solarSystemA.position), projectToRenderPlane(solarSystemB.position), color, key);
    }
    removeConnection(cluster, solarSystemA, solarSystemB) {
        const key = GalaxyConnectionLines.makeKey(solarSystemA.id, solarSystemB.id) +
            `_${cluster.id}`;
        return this.lines.removeConnection(key);
    }
    updateClusterConnections(cluster) {
        const idToSystem = new Map();
        for (const sys of cluster.solarSystems) {
            idToSystem.set(sys.id, sys);
        }
        for (const sys of cluster.solarSystems) {
            if (!Array.isArray(sys.connections))
                continue;
            for (const connectedId of sys.connections) {
                if (connectedId <= sys.id)
                    continue;
                const other = idToSystem.get(connectedId);
                if (!other)
                    continue;
                const key = GalaxyConnectionLines.makeKey(sys.id, other.id) + `_${cluster.id}`;
                this.lines.updateConnection(key, projectToRenderPlane(sys.position), projectToRenderPlane(other.position));
            }
        }
    }
    finalize() {
        this.lines.finalizeBuffers();
    }
    clear() {
        this.lines.clear();
    }
}
function projectToRenderPlane(position) {
    return new THREE.Vector3(position.x, RENDER_PLANE_Y, position.z);
}
//# sourceMappingURL=solar-system-connection-layer.js.map