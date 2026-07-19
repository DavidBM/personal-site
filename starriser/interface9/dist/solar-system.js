import { copyPosition3D } from "./math/position3d.js";
/**
 * Topology entity for a solar system. No GPU / Three types.
 * `_bufferIndex` is a view-layer cache written by the point renderer.
 */
export class SolarSystem {
    constructor({ id, name, position, isJumpGate = false, connections = [], connectedToClusterId = null, }) {
        this.id = id;
        this.name = name;
        this.position = copyPosition3D(position);
        this.isJumpGate = isJumpGate;
        this.connectedToClusterId = connectedToClusterId;
        this.cluster = null;
        this.connections = connections;
    }
    dispose() { }
}
//# sourceMappingURL=solar-system.js.map