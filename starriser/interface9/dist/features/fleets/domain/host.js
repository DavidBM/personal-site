import { opaqueIdBytes } from '../../../contracts/opaque-id.js';
import { copyToken, requireSeedSuccessor, sameToken, validateSeed, validateToken } from './seed.js';
import { createRoutePreview } from './routes.js';
/** Exactly one bounded Rust state owner. Online state is replaced from the
 * authoritative projection; previews cannot commit or advance its deadlines. */
export function createDomainHost(rules, mode, onAccepted) {
    let system = null;
    let token = null;
    let playerId = '';
    let transferPolicy = null;
    let fleets = 0;
    let positionDimensions = 2;
    let closed = false;
    const version = rules.rule_version();
    const routes = createRoutePreview(rules);
    function status() {
        return { mode, ruleVersion: version, token: token ? copyToken(token) : null, fleets, nextDeadlineMs: system?.next_deadline_ms() ?? null };
    }
    function seed(value) {
        validateSeed(value);
        requireSeedSuccessor(token, value.token);
        if (value.ruleVersion !== version)
            throw new Error('Shared rule version mismatch');
        const replacement = new rules.RuleSystem(opaqueIdBytes(value.token.watermark.scope.systemId), value.token.watermark.systemRevision, value.committedTimeMs, value.identities, value.revisions, value.positions, value.times);
        try {
            if (value.pathOffsets && replacement.set_movement_paths(value.pathOffsets, value.pathPoints) !== 0)
                throw new Error('Invalid authoritative movement paths');
            if (value.orbitOffsets && replacement.set_orbits(value.orbitOffsets, value.orbitBytes) !== 0)
                throw new Error('Invalid authoritative orbits');
            if (value.movementContext) {
                const c = value.movementContext;
                if (replacement.set_movement_context(c.catalogId, c.version, 0n, c.speedPerSecond, c.clearance, c.extent, c.sunClearance) !== 0)
                    throw new Error('Unsupported movement geometry');
            }
        }
        catch (error) {
            replacement.free();
            throw error;
        }
        const previous = system;
        system = replacement;
        token = copyToken(value.token);
        playerId = value.playerId;
        fleets = value.revisions.length;
        positionDimensions = value.positionDimensions ?? 2;
        transferPolicy = value.transferPolicy ? { ...value.transferPolicy } : mode === 'offline' ? defaultPolicy(rules) : null;
        previous?.free();
        return status();
    }
    function current(required) {
        validateToken(required);
        if (!system || !token || !sameToken(required, token))
            throw new Error('Stale or missing domain seed');
        return system;
    }
    function stageMove(state, move) {
        if (move.orbitBody !== undefined) {
            if (move.expectedFleetRevision === undefined)
                throw new Error('Orbit requires fleet revision');
            return state.stage_orbit(opaqueIdBytes(playerId), opaqueIdBytes(move.orderId), opaqueIdBytes(move.fleetId), move.orbitBody, move.nowMs, move.expectedFleetRevision);
        }
        if (move.expectedFleetRevision !== undefined) {
            if (move.expectedSystemRevision !== undefined)
                throw new Error('Move revision guards are mutually exclusive');
            return state.stage_retarget_xyz(opaqueIdBytes(playerId), opaqueIdBytes(move.orderId), opaqueIdBytes(move.fleetId), move.targetX, move.targetY ?? 0, move.targetZ, move.nowMs, move.expectedFleetRevision);
        }
        if (positionDimensions === 2 && move.targetY === undefined) {
            return state.stage_move(opaqueIdBytes(playerId), opaqueIdBytes(move.orderId), opaqueIdBytes(move.fleetId), move.targetX, move.targetZ, move.nowMs, move.expectedSystemRevision);
        }
        return state.stage_move_xyz(opaqueIdBytes(playerId), opaqueIdBytes(move.orderId), opaqueIdBytes(move.fleetId), move.targetX, move.targetY ?? 0, move.targetZ, move.nowMs, move.expectedSystemRevision);
    }
    function preview(move) {
        const state = current(move.token);
        try {
            const code = stageMove(state, move);
            return { kind: 'preview', token: copyToken(token), code, proposal: code === 0 ? changeFromPending(state, token) : null };
        }
        finally {
            state.discard();
        }
    }
    function offline(request) {
        if (mode !== 'offline')
            throw new Error('Online previews cannot commit accepted state');
        const required = request.type === 'offlineMove' ? request.move.token : request.token;
        const state = current(required);
        if (token.watermark.sequence === 0xffffffffffffffffn)
            throw new Error('Offline projection sequence exhausted; replace the stream');
        try {
            const code = request.type === 'offlineMove' ? stageMove(state, request.move) : state.stage_due(request.nowMs, request.limit);
            if (code !== 0)
                return commitResult(code, false);
            const change = changeFromPending(state, token);
            if (!change)
                return commitResult(0, false);
            const committed = state.commit();
            if (committed !== 0)
                return commitResult(committed, false);
            token = { ...token, watermark: { ...token.watermark, sequence: token.watermark.sequence + 1n, systemRevision: state.revision() } };
            onAccepted({ ...change, token: copyToken(token) });
            return commitResult(0, true);
        }
        finally {
            state.discard();
        }
    }
    function commitResult(code, committed) {
        return { kind: 'commit', token: copyToken(token), code, committed, nextDeadlineMs: system.next_deadline_ms() ?? null };
    }
    return {
        status,
        request(request) {
            if (closed)
                throw new Error('Domain host is disposed');
            if (request.type === 'seed')
                return seed(request.seed);
            if (request.type === 'seedTopology')
                return routes.seed(request.topology);
            if (request.type === 'previewMove')
                return preview(request.move);
            if (request.type === 'previewRoute')
                return routes.preview(current(request.route.token), playerId, request.route, transferPolicy);
            return offline(request);
        },
        dispose() {
            if (closed)
                return;
            closed = true;
            system?.free();
            routes.dispose();
            system = null;
            token = null;
            fleets = 0;
        },
    };
}
function changeFromPending(state, token) {
    const meta = state.pending_meta();
    if (meta.length === 0)
        return null;
    const positions = state.pending_positions(), revisions = state.pending_revisions();
    return { positionDimensions: positions.length === revisions.length * 6 ? 3 : 2, token: copyToken(token), meta, identities: state.pending_identities(), revisions,
        orbitOffsets: state.pending_orbit_offsets(), orbitBytes: state.pending_orbit_bytes(),
        pathOffsets: state.pending_path_offsets(), pathPoints: state.pending_path_points(),
        positions, times: state.pending_times(), orderIds: state.pending_order_ids(), events: state.pending_events() };
}
/** wasm-bindgen returns owned JS copies; transferring them cannot detach WASM. */
export function changeBuffers(change) {
    return [...new Set([change.meta.buffer, change.identities.buffer, change.revisions.buffer, change.positions.buffer,
            change.times.buffer, change.orderIds.buffer, change.events.buffer, ...(change.orbitOffsets ? [change.orbitOffsets.buffer, change.orbitBytes.buffer] : []), ...(change.pathOffsets ? [change.pathOffsets.buffer, change.pathPoints.buffer] : [])])];
}
function defaultPolicy(rules) {
    const [jumpMs, cooldownMs, configurationRevision, modifierRevision] = rules.default_transfer_policy();
    return { jumpMs, cooldownMs, configurationRevision, modifierRevision };
}
//# sourceMappingURL=host.js.map