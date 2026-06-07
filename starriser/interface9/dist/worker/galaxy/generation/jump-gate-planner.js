import { angleXZ, pointAtAngle } from "../../../math/galaxy-xz-math.js";
const ANGLE_THRESHOLD = (15 * Math.PI) / 180;
export function createJumpGatePlanner({ clusters, nextSystemId, }) {
    let systemCounter = nextSystemId;
    const clusterJumpGates = new Map();
    for (const cluster of clusters) {
        clusterJumpGates.set(cluster.id, cluster.solarSystems.filter((s) => s.isJumpGate));
    }
    const findExistingJumpGate = (cluster, targetAngle) => {
        const existingGates = clusterJumpGates.get(cluster.id) ?? [];
        for (const gate of existingGates) {
            const gateAngle = angleXZ(cluster.position, gate.position);
            let angleDiff = Math.abs(targetAngle - gateAngle);
            if (angleDiff > Math.PI) {
                angleDiff = 2 * Math.PI - angleDiff;
            }
            if (angleDiff <= ANGLE_THRESHOLD) {
                return gate;
            }
        }
        return null;
    };
    const getOrCreateJumpGate = (cluster, targetCluster) => {
        const targetAngle = angleXZ(cluster.position, targetCluster.position);
        const existingGate = findExistingJumpGate(cluster, targetAngle);
        if (existingGate) {
            return existingGate;
        }
        const radius = cluster.radius * 1.07;
        const pos = pointAtAngle(cluster.position, radius, targetAngle);
        const newGate = {
            id: systemCounter++,
            name: `JumpGate ${cluster.id}->${targetCluster.id}`,
            position: pos,
            connections: [],
            isJumpGate: true,
            connectedToClusterId: targetCluster.id,
        };
        const gates = clusterJumpGates.get(cluster.id) ?? [];
        gates.push(newGate);
        clusterJumpGates.set(cluster.id, gates);
        return newGate;
    };
    return {
        getOrCreateJumpGate,
        getNextSystemId: () => systemCounter,
    };
}
//# sourceMappingURL=jump-gate-planner.js.map