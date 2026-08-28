/**
 * Topology-scoped model LOD eligibility (pure).
 *
 * When the map is deep enough for textured models, only fleets in the
 * **focus cluster** (look-at) plus fleets at **jump-gate systems on edges
 * into that cluster** (neighbor side + focus side) may take model slots.
 * Distant cluster interiors stay triangle/icon even under the height gate.
 *
 * No GPU / DOM — map-view supplies cluster centers, jump edges, and fleet nodes.
 */
export function fleetSystemKey(clusterId, solarSystemId) {
    return `${clusterId | 0}:${solarSystemId | 0}`;
}
/**
 * Parse inter-cluster connection key from {@link makeConnectionKey}
 * (`c1_c2_jg1_jg2`). Returns null for solar keys (`a-b_c`) or malformed.
 */
export function parseInterClusterConnectionKey(key) {
    if (typeof key !== "string" || key.length === 0)
        return null;
    // Solar keys always contain a dash (`sysA-sysB_cluster`).
    if (key.includes("-"))
        return null;
    const parts = key.split("_");
    if (parts.length !== 4)
        return null;
    const cluster1 = Number(parts[0]);
    const cluster2 = Number(parts[1]);
    const jumpGate1 = Number(parts[2]);
    const jumpGate2 = Number(parts[3]);
    if (!Number.isFinite(cluster1) ||
        !Number.isFinite(cluster2) ||
        !Number.isFinite(jumpGate1) ||
        !Number.isFinite(jumpGate2)) {
        return null;
    }
    return { cluster1, cluster2, jumpGate1, jumpGate2 };
}
/**
 * Focus cluster under the camera look-at: prefer a cluster whose radius
 * contains the target, else nearest cluster center on XZ.
 */
export function chooseFocusClusterId(targetX, targetZ, clusters) {
    if (clusters.length === 0)
        return null;
    let nearestId = clusters[0].id;
    let nearestD = Infinity;
    let containId = null;
    let containD = Infinity;
    for (let i = 0; i < clusters.length; i++) {
        const c = clusters[i];
        const dx = c.x - targetX;
        const dz = c.z - targetZ;
        const d = Math.hypot(dx, dz);
        if (d < nearestD) {
            nearestD = d;
            nearestId = c.id;
        }
        const r = c.radius ?? 0;
        // Small margin so look-at near the rim still counts as “inside”.
        if (r > 0 && d <= r * 1.15 && d < containD) {
            containD = d;
            containId = c.id;
        }
    }
    return containId ?? nearestId;
}
/**
 * Focus cluster for model LOD, updated every frame from live look-at.
 *
 * When following a ship, prefer the followed fleet's discrete topology so
 * mid-hop focus tracks the hop (endpoint closer to look-at among start/end),
 * instead of freezing on the cluster where follow started. Falls back to
 * {@link chooseFocusClusterId}(look-at) when no follow loc is provided.
 */
export function resolveModelFocusClusterId(lookAtX, lookAtZ, clusters, followLoc) {
    if (followLoc != null) {
        if (followLoc.mode === "jumping" &&
            followLoc.startClusterId != null &&
            followLoc.endClusterId != null) {
            const startId = followLoc.startClusterId | 0;
            const endId = followLoc.endClusterId | 0;
            let startC = null;
            let endC = null;
            for (let i = 0; i < clusters.length; i++) {
                const c = clusters[i];
                if (c.id === startId)
                    startC = c;
                if (c.id === endId)
                    endC = c;
            }
            if (startC && endC) {
                const dS = Math.hypot(startC.x - lookAtX, startC.z - lookAtZ);
                const dE = Math.hypot(endC.x - lookAtX, endC.z - lookAtZ);
                // As the chase look-at moves along the hop, focus flips to the nearer end.
                return dE < dS ? endId : startId;
            }
            return endId;
        }
        // Parked / cooldown / awaiting: focus = domain node cluster (moves on retarget).
        return followLoc.clusterId | 0;
    }
    return chooseFocusClusterId(lookAtX, lookAtZ, clusters);
}
/**
 * While follow is active and global model height gate is on, the followed
 * fleet is always model-eligible (even if topology pre-filter would drop it
 * mid-hop between neighborhoods).
 */
export function shouldForceIncludeFollowedFleet(followActive, modelHeightGateOn) {
    return followActive === true && modelHeightGateOn === true;
}
/**
 * Build neighbor + connecting-system sets for a focus cluster from jump edges.
 * O(edges) — only edges incident on focus contribute.
 */
export function buildModelTopologyContext(focusClusterId, jumpEdges) {
    const focus = focusClusterId | 0;
    const neighborClusterIds = new Set();
    const connectingSystemKeys = new Set();
    for (let i = 0; i < jumpEdges.length; i++) {
        const e = jumpEdges[i];
        if (e.cluster1 === focus) {
            neighborClusterIds.add(e.cluster2);
            connectingSystemKeys.add(fleetSystemKey(e.cluster1, e.jumpGate1));
            connectingSystemKeys.add(fleetSystemKey(e.cluster2, e.jumpGate2));
        }
        else if (e.cluster2 === focus) {
            neighborClusterIds.add(e.cluster1);
            connectingSystemKeys.add(fleetSystemKey(e.cluster2, e.jumpGate2));
            connectingSystemKeys.add(fleetSystemKey(e.cluster1, e.jumpGate1));
        }
    }
    return { focusClusterId: focus, neighborClusterIds, connectingSystemKeys };
}
/**
 * True if this fleet may take textured model instances under topology policy.
 *
 * Inbound hops into the focus cluster are eligible for the **whole hop**
 * (start outside / neighbor gate → end in focus), not only after park.
 * Neighbor **interiors** stay blocked when parked; neighbor **gates** and
 * hops that touch a connecting gate or focus are allowed.
 */
export function isFleetModelTopologyEligible(loc, ctx) {
    const focus = ctx.focusClusterId;
    if (loc.mode === "parked") {
        if (loc.clusterId === focus)
            return true;
        if (ctx.neighborClusterIds.has(loc.clusterId) &&
            ctx.connectingSystemKeys.has(fleetSystemKey(loc.clusterId, loc.solarSystemId))) {
            return true;
        }
        return false;
    }
    // Jumping: destination in focus → eligible immediately (inbound gate hop).
    const endC = (loc.endClusterId ?? loc.clusterId) | 0;
    const endS = (loc.endSolarSystemId ?? loc.solarSystemId) | 0;
    if (endC === focus)
        return true;
    const startC = (loc.startClusterId ?? loc.clusterId) | 0;
    const startS = (loc.startSolarSystemId ?? loc.solarSystemId) | 0;
    if (startC === focus)
        return true;
    // Either endpoint on a connecting jump-gate (neighbor or focus side).
    if (ctx.connectingSystemKeys.has(fleetSystemKey(endC, endS)) ||
        ctx.connectingSystemKeys.has(fleetSystemKey(startC, startS))) {
        return true;
    }
    return false;
}
/**
 * World XZ used for model **view cull**.
 *
 * Ships orbit/sim around **pathEnd**, while FleetGpu.pos eases the marker
 * independently. Using the marker alone holds inbound fleets as triangles
 * until the hop finishes (marker still outside the look-at cull ball).
 * Prefer pathEnd so topology-eligible fleets near the destination gate match
 * peers already drawing models in the focus neighborhood.
 */
export function modelLodFleetCullPos(pathEndX, pathEndZ, fleetPosX, fleetPosZ, lookAtX, lookAtZ) {
    const dEnd = (pathEndX - lookAtX) * (pathEndX - lookAtX) +
        (pathEndZ - lookAtZ) * (pathEndZ - lookAtZ);
    const dPos = (fleetPosX - lookAtX) * (fleetPosX - lookAtX) +
        (fleetPosZ - lookAtZ) * (fleetPosZ - lookAtZ);
    // Closer of marker vs pathEnd — inbound uses pathEnd near the gate.
    if (dEnd <= dPos)
        return { x: pathEndX, z: pathEndZ };
    return { x: fleetPosX, z: fleetPosZ };
}
/** Domain FleetState → topology location for eligibility. */
export function fleetTopologyLocFromState(state) {
    if (state.state === "jumping") {
        return {
            mode: "jumping",
            clusterId: state.endNode.clusterId,
            solarSystemId: state.endNode.solarSystemId,
            startClusterId: state.startNode.clusterId,
            startSolarSystemId: state.startNode.solarSystemId,
            endClusterId: state.endNode.clusterId,
            endSolarSystemId: state.endNode.solarSystemId,
        };
    }
    const node = state.node;
    return {
        mode: "parked",
        clusterId: node.clusterId,
        solarSystemId: node.solarSystemId,
    };
}
/**
 * True when this fleet's discrete loc is in the CPU SystemSceneSet.
 * Jumping uses {@link fleetTopologyLocFromState} → `endNode` (whole inbound hop).
 * `"parked"` is only the loc mode — do not invent a domain `"parked"` FleetState.
 */
export function fleetLocInSystemScene(state, sceneIds) {
    if (sceneIds == null || sceneIds.size === 0)
        return false;
    return sceneIds.has(fleetTopologyLocFromState(state).solarSystemId);
}
function nodeKey(n) {
    return fleetSystemKey(n.clusterId, n.solarSystemId);
}
/**
 * True when discrete path identity changed enough that trails must reset
 * (spawn handled separately). Significant = new pathEnd / park node / hop ends.
 */
export function shouldResetFleetTrails(prev, next) {
    // Entering or leaving a hop always resets.
    if (prev.state === "jumping" && next.state === "jumping") {
        return (nodeKey(prev.startNode) !== nodeKey(next.startNode) ||
            nodeKey(prev.endNode) !== nodeKey(next.endNode));
    }
    if (prev.state === "jumping" || next.state === "jumping") {
        return true;
    }
    // Both parked (awaiting / cooldown): reset only if node identity changed.
    return nodeKey(prev.node) !== nodeKey(next.node);
}
//# sourceMappingURL=model-topology-lod.js.map