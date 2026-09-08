import { opaqueIdBytes } from '../../../contracts/opaque-id.js';
import { copyToken, requireSeedSuccessor, sameToken, validateSeed, validateToken } from './seed.js';
import { createRoutePreview } from './routes.js';
/** Exactly one bounded Rust state owner. Online state is replaced from the
 * authoritative projection; previews cannot commit or advance its deadlines. */
export function createDomainHost(rules, mode, onAccepted) {
    let system = null;
    let token = null;
    let playerId = '';
    let ships = 0;
    let closed = false;
    const version = rules.rule_version();
    const routes = createRoutePreview(rules);
    function status() {
        return { mode, ruleVersion: version, token: token ? copyToken(token) : null, ships, nextDeadlineMs: system?.next_deadline_ms() ?? null };
    }
    function seed(value) {
        validateSeed(value);
        requireSeedSuccessor(token, value.token);
        if (value.ruleVersion !== version)
            throw new Error('Shared rule version mismatch');
        const replacement = new rules.RuleSystem(opaqueIdBytes(value.token.watermark.scope.systemId), value.token.watermark.systemRevision, value.committedTimeMs, value.identities, value.revisions, value.positions, value.times);
        const previous = system;
        system = replacement;
        token = copyToken(value.token);
        playerId = value.playerId;
        ships = value.revisions.length;
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
        return state.stage_move(opaqueIdBytes(playerId), opaqueIdBytes(move.orderId), opaqueIdBytes(move.shipId), move.targetX, move.targetZ, move.nowMs, move.expectedSystemRevision);
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
                return routes.preview(current(request.route.token), playerId, request.route);
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
            ships = 0;
        },
    };
}
function changeFromPending(state, token) {
    const meta = state.pending_meta();
    if (meta.length === 0)
        return null;
    return { token: copyToken(token), meta, identities: state.pending_identities(), revisions: state.pending_revisions(),
        positions: state.pending_positions(), times: state.pending_times(), orderIds: state.pending_order_ids(), events: state.pending_events() };
}
/** wasm-bindgen returns owned JS copies; transferring them cannot detach WASM. */
export function changeBuffers(change) {
    return [...new Set([change.meta.buffer, change.identities.buffer, change.revisions.buffer, change.positions.buffer,
            change.times.buffer, change.orderIds.buffer, change.events.buffer])];
}
//# sourceMappingURL=host.js.map