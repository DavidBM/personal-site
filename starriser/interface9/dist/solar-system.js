import * as THREE from "./vendor/three.js";
/**
 * Visual SolarSystem entity. No domain logic.
 */
export class SolarSystem {
    constructor({ id, name, position, isJumpGate = false, connections = [], connectedToClusterId = null, }) {
        this.id = id;
        this.name = name;
        this.position =
            position instanceof THREE.Vector3
                ? position
                : new THREE.Vector3(position.x, position.y, position.z);
        this.isJumpGate = isJumpGate;
        this.connectedToClusterId = connectedToClusterId;
        this.cluster = null;
        this.connections = connections;
    }
    dispose() { }
}
//# sourceMappingURL=solar-system.js.map