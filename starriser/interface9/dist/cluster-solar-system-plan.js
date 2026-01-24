import { distZX, lineSegmentsCrossXZ, pointLineDistZX, tooCloseZX, } from "./worker/galaxy/galaxy-xz-math.js";
const SOLAR_SYSTEM_MIN_DIST_FACTOR = 3;
const MAX_RETRIES = 2000;
const N_NEIGHBORS = 3;
const MIN_DISTANCE_TO_SYSTEM = 25;
export function buildClusterSolarSystemPlan({ clusterId, clusterPosition, clusterRadius, numSolarSystems, jumpGates, nextSystemId, }) {
    if (!jumpGates.length) {
        return {
            systems: [],
            connections: [],
            nextSystemId,
            maxSystemDistance: 0,
            success: false,
        };
    }
    const safeRadius = clusterRadius * 0.95;
    const minInterSSDist = ((2 * Math.PI * safeRadius) / numSolarSystems) *
        SOLAR_SYSTEM_MIN_DIST_FACTOR;
    let attempt = 0;
    while (attempt < MAX_RETRIES) {
        const tempSystems = jumpGates.map((gate) => ({
            id: gate.id,
            name: gate.name,
            position: {
                x: gate.position.x,
                y: gate.position.y,
                z: gate.position.z,
            },
            connections: [],
            isJumpGate: true,
            connectedToClusterId: gate.connectedToClusterId ?? null,
        }));
        const sysPositions = [];
        let s = 0;
        let ssAttempt = 0;
        const maxSSA = numSolarSystems * 10;
        while (s < numSolarSystems && ssAttempt < maxSSA) {
            const r = Math.sqrt(Math.random()) * safeRadius;
            const theta = Math.random() * Math.PI * 2;
            const position = {
                x: clusterPosition.x + r * Math.cos(theta),
                y: clusterPosition.y + Math.random() * 15,
                z: clusterPosition.z + r * Math.sin(theta),
            };
            if (tooCloseZX(position, sysPositions, minInterSSDist)) {
                ssAttempt++;
                continue;
            }
            sysPositions.push(position);
            const sysId = nextSystemId++;
            tempSystems.push({
                id: sysId,
                name: `System ${clusterId}-${sysPositions.length}`,
                position,
                connections: [],
                isJumpGate: false,
                connectedToClusterId: null,
            });
            s++;
            ssAttempt++;
        }
        for (const sys of tempSystems) {
            sys.connections = [];
        }
        const existingConnections = [];
        const connectionExists = (a, b) => a.connections.includes(b.id);
        const addConnection = (a, b) => {
            if (!connectionExists(a, b) &&
                a.connections.length < N_NEIGHBORS &&
                b.connections.length < N_NEIGHBORS) {
                a.connections.push(b.id);
                b.connections.push(a.id);
                existingConnections.push({ from: a, to: b });
                return true;
            }
            return false;
        };
        const connectionsWouldCross = (a, b) => {
            for (const conn of existingConnections) {
                if (lineSegmentsCrossXZ(a.position, b.position, conn.from.position, conn.to.position)) {
                    return true;
                }
            }
            for (const other of tempSystems) {
                if (other.id === a.id || other.id === b.id)
                    continue;
                const distToConnection = pointLineDistZX(other.position, a.position, b.position);
                if (distToConnection < MIN_DISTANCE_TO_SYSTEM) {
                    return true;
                }
            }
            return false;
        };
        const systemsToProcess = [...tempSystems].sort((a, b) => a.id - b.id);
        for (const sys of systemsToProcess) {
            const candidates = tempSystems
                .filter((other) => other.id !== sys.id && !connectionExists(sys, other))
                .map((other) => ({
                sys: other,
                dist: distZX(sys.position, other.position),
            }))
                .sort((a, b) => a.dist - b.dist);
            for (const candidate of candidates) {
                if (sys.connections.length >= N_NEIGHBORS)
                    break;
                if (candidate.sys.connections.length >= N_NEIGHBORS)
                    continue;
                if (sys.isJumpGate && candidate.sys.isJumpGate)
                    continue;
                if (!connectionsWouldCross(sys, candidate.sys)) {
                    addConnection(sys, candidate.sys);
                }
            }
        }
        const filteredSystems = tempSystems.filter((sys) => sys.isJumpGate || sys.connections.length > 0);
        if (checkFullConnectivity(filteredSystems, jumpGates)) {
            const connections = [];
            const seen = new Set();
            for (const sys of filteredSystems) {
                for (const connectedId of sys.connections) {
                    const key = sys.id < connectedId
                        ? `${sys.id}-${connectedId}`
                        : `${connectedId}-${sys.id}`;
                    if (seen.has(key))
                        continue;
                    seen.add(key);
                    connections.push([sys.id, connectedId]);
                }
            }
            const newSystems = filteredSystems
                .filter((sys) => !sys.isJumpGate)
                .map((sys) => ({
                id: sys.id,
                name: sys.name,
                position: sys.position,
                connections: [],
                isJumpGate: false,
                connectedToClusterId: null,
            }));
            const regularPositions = newSystems.map((sys) => sys.position);
            const maxSystemDistance = regularPositions.length > 0
                ? regularPositions.reduce((mx, p) => Math.max(mx, distZX(p, clusterPosition)), 0)
                : 0;
            return {
                systems: newSystems,
                connections,
                nextSystemId,
                maxSystemDistance,
                success: true,
            };
        }
        attempt++;
    }
    return {
        systems: [],
        connections: [],
        nextSystemId,
        maxSystemDistance: 0,
        success: false,
    };
}
function checkFullConnectivity(systems, jumpGates) {
    if (!jumpGates.length)
        return false;
    const idToSys = new Map(systems.map((sys) => [sys.id, sys]));
    for (const sys of systems) {
        const reachableJumpGates = new Set();
        const queue = [sys];
        const visited = new Set([sys.id]);
        while (queue.length > 0) {
            const current = queue.shift();
            if (!current)
                break;
            if (current.isJumpGate) {
                reachableJumpGates.add(current.id);
            }
            for (const connId of current.connections) {
                const connSys = idToSys.get(connId);
                if (connSys && !visited.has(connSys.id)) {
                    visited.add(connSys.id);
                    queue.push(connSys);
                }
            }
        }
        if (reachableJumpGates.size < jumpGates.length) {
            return false;
        }
    }
    return true;
}
//# sourceMappingURL=cluster-solar-system-plan.js.map