import { remotePathPosition } from '../gpu/map/fleets/remote-path.js';
import { countShips } from '../gpu/fleet-lod.js';
import { createCameraDirectorHost } from './camera-director-host.js';
const TERMINAL = new Set(['completed', 'cancelled', 'failed']);
/** One selected route, one pin, no world/ship walk. Geometry is uploaded only on
 * route/progress changes; frame work samples two accepted anchors at most. */
export function createSelectedTravel(state) {
    let selected = null, pathId, signal;
    let sampledAt = 0, framed, framingId, localJump;
    const nodes = [], anchors = new Map(), keys = new Set();
    const pin = { id: '', x: 0, y: 0, z: 0, clusterId: 0, systemId: null, state: 'ready', exact: false };
    function removeLines() { for (const key of keys)
        state.view.removeConnection(key); keys.clear(); }
    function clear() { removeLines(); nodes.length = 0; anchors.clear(); signal = undefined; pathId = undefined; framed = undefined; framingId = undefined; localJump = undefined; }
    function select(id) { if (id === selected)
        return; clear(); selected = id; }
    function lines() {
        removeLines();
        if (!selected || !signal || TERMINAL.has(signal.phase))
            return;
        for (let i = signal.completedLegs + 1; i < nodes.length; i++) {
            const a = nodes[i - 1], b = nodes[i];
            if (!a || !b)
                continue;
            const key = a.clusterId === b.clusterId ? `online:system:${a.clusterId}:travel:${i}` : `travel:jump:${i}`;
            state.view.addConnection(key, a, b, 0x72eaff);
            keys.add(key);
        }
    }
    function path(value) {
        if (!value) {
            clear();
            return;
        }
        if (value.fleetId !== selected)
            return;
        if (pathId !== value.journeyId) {
            removeLines();
            nodes.length = 0;
            anchors.clear();
            pathId = value.journeyId;
        }
        if (value.offset < 0 || value.offset + value.nodes.length > 1025 || value.nodes.length > 16)
            return;
        value.nodes.forEach((row, i) => { nodes[value.offset + i] = row; anchors.set(row.solarSystemId, row); });
        lines();
    }
    function accept(value) {
        if (!value) {
            signal = undefined;
            lines();
            return;
        }
        if (value.fleetId !== selected || signal?.journeyId === value.journeyId && value.revision < signal.revision)
            return;
        const changed = signal?.journeyId !== value.journeyId || signal.completedLegs !== value.completedLegs || signal.phase !== value.phase;
        signal = value;
        sampledAt = state.view.getSceneWallMs();
        if (changed)
            lines();
    }
    function currentVisual() {
        if (!selected)
            return;
        // UI snapshots are throttled and can still name a retired incarnation.
        if (state.remoteFleetVisual)
            return state.remoteFleetVisual(selected) ?? state.view.getFleetVisual(selected) ?? undefined;
        return state.view.getFleetVisual(state.sceneFleetRenderIds.get(selected) ?? selected) ?? undefined;
    }
    function lookup(node) {
        return state.galaxy.getSolarSystemById(node.clusterId, node.solarSystemId)?.position ?? anchors.get(node.solarSystemId) ?? null;
    }
    function endpoints() {
        return acceptedJump() ?? localJumpEndpoints();
    }
    function acceptedJump() {
        if (signal?.phase !== 'transit' || !signal.source || !signal.destination || signal.departureMs === undefined || signal.arrivalMs === undefined)
            return;
        const a = signal.sourcePosition ?? lookup(signal.source), b = signal.destinationPosition ?? lookup(signal.destination);
        if (!a || !b)
            return;
        const elapsed = Number((signal.serverNowMs ?? signal.departureMs) - signal.departureMs) + state.view.getSceneWallMs() - sampledAt;
        return { a, b, progress: Math.max(0, Math.min(1, elapsed / Number(signal.arrivalMs - signal.departureMs))), node: signal.destination, key: `${signal.journeyId}:${signal.completedLegs}` };
    }
    function localJumpEndpoints() {
        const s = currentVisual()?.state;
        if (s?.state !== 'jumping')
            return;
        const a = s.startPosition ?? lookup(s.startNode), b = s.endPosition ?? lookup(s.endNode);
        if (!a || !b)
            return;
        return { a, b, progress: Math.max(0, Math.min(1, (state.view.getSceneWallMs() - s.startTime) / s.durationMs)), node: s.endNode, key: `local:${s.startTime}` };
    }
    function sample() {
        if (!selected)
            return;
        const visual = currentVisual(), roster = state.view.survey.fleetTotals().rosterRow(`roster:${selected}`);
        pin.id = selected;
        pin.renderId = visual?.id;
        pin.ships = visual ? countShips(visual.counts) : roster?.ships;
        const jump = endpoints();
        return jump ? sampleJump(jump, visual?.id ?? selected) : sampleResident(visual, roster);
    }
    function sampleJump(jump, renderId) {
        pin.x = jump.a.x + (jump.b.x - jump.a.x) * jump.progress;
        pin.y = jump.a.y + (jump.b.y - jump.a.y) * jump.progress;
        pin.z = jump.a.z + (jump.b.z - jump.a.z) * jump.progress;
        pin.clusterId = jump.node.clusterId;
        pin.systemId = null;
        pin.state = 'jump';
        pin.exact = true;
        const followed = state.camera.isFollowing() && state.view.followedFleetPose?.(renderId);
        if (followed) {
            pin.x = followed.posX;
            pin.y = followed.posY;
            pin.z = followed.posZ;
        }
        return pin;
    }
    function residentNode(visual, roster) {
        if (visual && visual.state.state !== 'jumping')
            return visual.state.node;
        return (signal && !TERMINAL.has(signal.phase) ? signal.source : undefined) ?? roster?.node;
    }
    function residentState(visual, moving) {
        if (signal?.phase === 'ready' || visual?.state.state === 'cooldown')
            return 'cooldown';
        return signal?.phase === 'approaching' || signal?.phase === 'arriving' || moving ? 'move' : 'ready';
    }
    function sampleResident(visual, roster) {
        const node = residentNode(visual, roster);
        if (!node)
            return;
        const world = lookup(node) ?? rosterPosition(roster);
        if (!world)
            return;
        pin.clusterId = node.clusterId;
        pin.systemId = node.solarSystemId;
        pin.x = world.x;
        pin.y = world.y;
        pin.z = world.z;
        pin.exact = false;
        pin.state = residentState(visual, roster?.moving);
        if (visual && state.view.solarBodies.systemId === node.solarSystemId)
            sampleScene(visual, world);
        return pin;
    }
    function sampleScene(visual, world) {
        const local = scenePinPosition(state, visual);
        if (local) {
            pin.x = local.x + world.x;
            pin.y = local.y;
            pin.z = local.z + world.z;
            pin.exact = true;
        }
        const activity = state.view.sceneFleetActivity(visual.id)?.action;
        pin.state = scenePinState(visual, activity, pin.state);
    }
    function frameJump(force = false) {
        if (!force && (state.focusedFleetId !== selected || state.camera.isFollowing() || !state.camera.isOrbiting()))
            return false;
        const jump = endpoints();
        if (!jump || !force && framed === jump.key)
            return false;
        const camera = state.view.getCameraState(), to = jumpOverview(camera, jump.a, jump.b);
        state.camera.setSystemOrbitFree();
        state.camera.setFollowShip(null, 'jump-overview');
        state.view.setFollowShipIndex(null, 'jump-overview');
        state.director = createCameraDirectorHost({ applyPose: pose => state.camera.applyDirectorPose(pose) });
        state.director.enqueue({ kind: 'fly', from: camera, to, durationMs: 650 });
        framed = jump.key;
        framingId = selected ?? undefined;
        state.focusedFleetId = selected;
        return true;
    }
    function tick() {
        const current = currentVisual();
        if (selected && current && state.sceneFleetRenderIds.get(selected) !== current.id) {
            state.sceneFleetRenderIds.set(selected, current.id);
            state.view.setSelectedFleetId(current.id);
        }
        tickLocalRoute();
        frameJump();
    }
    function tickLocalRoute() {
        if (signal)
            return;
        // Local sandbox keeps the same selected path/pin, without a remote projection.
        const s = selected ? state.view.getFleetVisual(selected)?.state : undefined;
        if (s?.state !== 'jumping') {
            removeLines();
            localJump = undefined;
            return;
        }
        if (localJump === s.startTime)
            return;
        removeLines();
        localJump = s.startTime;
        const a = s.startPosition ?? lookup(s.startNode), b = s.endPosition ?? lookup(s.endNode);
        if (!a || !b)
            return;
        const key = s.startNode.clusterId === s.endNode.clusterId ? `online:system:${s.startNode.clusterId}:travel:local` : 'travel:jump:local';
        state.view.addConnection(key, a, b, 0x72eaff);
        keys.add(key);
    }
    return { select, path, accept, lookup, sample, tick, clear, frameJump, framing: (id) => framingId === id && state.focusedFleetId === id,
        inspect: () => ({ selected, pathId, nodes: anchors.size, segments: keys.size, pin: sample(), framed, leg: signal?.completedLegs, phase: signal?.phase }) };
}
function rosterPosition(roster) {
    const p = roster?.position;
    return p ? { x: p[0], y: p[1], z: p[2] } : null;
}
function scenePinState(visual, activity, fallback) {
    if (activity === 'Battle')
        return 'battle';
    if (visual.remote?.moving || visual.pendingMove?.path.moving)
        return 'move';
    return activity === 'Orbiting planet' || visual.remote?.orbit ? 'orbit' : fallback;
}
/** A missing GPU observation is not a position at the sun. Only one selected
 * fleet samples its existing accepted/optimistic path while readbacks warm up. */
function scenePinPosition(state, visual) {
    const observed = state.view.sceneFleetTrackingPoint(visual.id);
    if (observed)
        return observed;
    const path = visual.pendingMove?.path ?? visual.remote;
    return path ? remotePathPosition(path, state.view.getSceneTimeSec() * 1000) : null;
}
export function jumpOverview(camera, a, b) {
    const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2, z = (a.z + b.z) / 2;
    const half = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) / 2;
    const fov = Math.tan(camera.fovyDeg * Math.PI / 360) * Math.min(1, camera.viewportW / Math.max(1, camera.viewportH));
    const distance = Math.max(40, half / Math.max(.1, fov) * 1.3), yaw = Math.atan2(camera.eyeX - camera.targetX, camera.eyeZ - camera.targetZ), pitch = .65;
    return { eyeX: x + Math.sin(yaw) * Math.cos(pitch) * distance, eyeY: y + Math.sin(pitch) * distance, eyeZ: z + Math.cos(yaw) * Math.cos(pitch) * distance, targetX: x, targetY: y, targetZ: z };
}
//# sourceMappingURL=selected-travel.js.map