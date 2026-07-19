import { copyPosition3D } from "./math/position3d.js";
/**
 * Topology + light visual identity for a cluster.
 * No GPU / Three types — view state lives in the renderer.
 * Edit-handle interaction lives on main input (edit-handle-pointer), not here.
 */
export class Cluster {
    constructor({ id, name, position, color, radius, maxSystemDistance, }) {
        this.id = id;
        this.name = name;
        this.position = copyPosition3D(position);
        this.color = color;
        this.radius = radius;
        this.maxSystemDistance = maxSystemDistance ?? 0;
        this.solarSystems = [];
    }
    /**
     * Add a solar system (cluster-local array only).
     * Call via Galaxy.addSolarSystem for full management.
     */
    addSolarSystem(solarSystem) {
        this.solarSystems.push(solarSystem);
        solarSystem.cluster = this;
    }
    getSolarSystemById(solarSystemId) {
        return this.solarSystems.find((ss) => ss.id === solarSystemId) || null;
    }
    removeSolarSystem(solarSystem) {
        const idx = this.solarSystems.indexOf(solarSystem);
        if (idx !== -1) {
            this.solarSystems.splice(idx, 1);
            solarSystem.dispose();
        }
    }
    dispose() {
        for (const sys of this.solarSystems)
            sys.dispose();
    }
}
//# sourceMappingURL=cluster.js.map