import { copySelector, copySnapshot } from './copy.js';
/** Connection-owned view lifecycle. Codec validates shape; this owner validates cuts and membership. */
import { create } from '@bufbuild/protobuf';
import { ViewRequestSchema } from '../generated/galaxy/v1/galaxy_pb.js';
import { opaqueIdAt } from '../../contracts/opaque-id.js';
import { counter, validateSelector, validateViewEvent } from './validate.js';
import { applyRows, emptyRows, rowsComplete } from './rows.js';
import { ownedRosterPage } from './owned-roster.js';
function signature(s) {
    if (s.kind.case === 'overview')
        return JSON.stringify({ whole: s.kind.value.wholeKnownGalaxy, systems: s.kind.value.systemIds.map(id => opaqueIdAt(id)).sort(), clusters: s.kind.value.clusterIds.map(id => opaqueIdAt(id)).sort() });
    if (s.kind.case === 'detail')
        return `detail:${opaqueIdAt(s.kind.value.systemId)}`;
    return 'owned';
}
export function createPlayerViewCache(world, connection, changed = () => { }, barrier = () => { }) {
    world = new Uint8Array(world);
    counter(connection);
    let disposed = false;
    let epoch = 0n;
    const slots = new Map([1, 2, 3].map(slot => [slot, { slot, requestedGeneration: 0n, status: 'closed', stale: false, signature: '', baselineGeneration: 0n, baselineId: '', retired: 0n }]));
    function get(slot) { if (disposed || !slots.has(slot))
        throw new Error('View unavailable'); return slots.get(slot); }
    function requestIdentity(s, generation, sig) {
        if (generation < s.requestedGeneration || (generation === s.requestedGeneration && sig !== s.signature))
            throw new Error('View generation identity conflict');
    }
    function request(slot, generation, selector) {
        const s = get(slot);
        counter(generation);
        if (selector)
            validateSelector(selector, slot);
        const sig = selector ? signature(selector) : 'close';
        requestIdentity(s, generation, sig);
        if (generation > s.requestedGeneration) {
            s.requestedGeneration = generation;
            s.signature = sig;
            s.requested = selector && copySelector(selector);
            s.staged = undefined;
            s.baselineGeneration = 0n;
            s.baselineId = '';
            s.retired = 0n;
            s.status = selector ? 'loading' : 'closed';
            s.stale = !!s.displayed;
            if (!selector) {
                s.displayed = undefined;
                s.stale = false;
            }
            changed(slot);
        }
        return create(ViewRequestSchema, { worldId: new Uint8Array(world), slot, requestGeneration: generation, operation: selector ? { case: 'replace', value: copySelector(selector) } : { case: 'close', value: {} } });
    }
    function clearEpoch(next, status) {
        epoch = next;
        for (const s of slots.values()) {
            s.displayed = undefined;
            s.staged = undefined;
            s.stale = false;
            s.status = s.requested ? status : 'closed';
        }
        // Complete the user-wide mutation before any reentrant observer can read it.
        barrier(next);
        for (const s of slots.values())
            changed(s.slot);
    }
    function advanceEpoch(next) { if (next > epoch)
        clearEpoch(next, 'loading'); }
    function membership(s, rows) {
        if (rows.case !== 'detail' || s.requested?.kind.case !== 'detail')
            return;
        if (opaqueIdAt(rows.value.observation.scope.systemId) !== opaqueIdAt(s.requested.kind.value.systemId))
            throw new Error('Detail selector membership');
    }
    function begin(s, v, message) {
        if (!s.requested || signature(v.selector) !== s.signature)
            throw new Error('View selector changed');
        if (v.baselineGeneration <= s.retired)
            return false;
        const id = opaqueIdAt(v.baselineId);
        if (v.baselineGeneration < s.baselineGeneration)
            return false;
        if (v.baselineGeneration === s.baselineGeneration) {
            if (id !== s.baselineId)
                throw new Error('View baseline identity conflict');
            return false;
        }
        s.baselineGeneration = v.baselineGeneration;
        s.baselineId = id;
        s.staged = { id, topologyRevision: v.topologyRevision, baselineGeneration: v.baselineGeneration, requestGeneration: s.requestedGeneration, visibilityEpoch: message.visibilityEpoch, sequence: 0n, selector: copySelector(v.selector), rows: emptyRows(), complete: false, chunks: 0, bytes: 0 };
        s.status = 'loading';
        s.stale = !!s.displayed;
        return true;
    }
    function chunk(s, v, bytes) {
        const b = s.staged;
        if (!b || b.id !== opaqueIdAt(v.baselineId) || b.baselineGeneration !== v.baselineGeneration)
            return false;
        if (v.chunkIndex !== b.chunks)
            throw new Error('View chunk gap');
        stagingBudget(s, b, bytes);
        membership(s, v.rows);
        applyRows(b.rows, v.rows, true);
        b.chunks++;
        b.bytes += bytes;
        return true;
    }
    function stagingBudget(s, b, bytes) {
        const limit = s.slot === 3 ? 4 * 1024 * 1024 : 8 * 1024 * 1024;
        const total = [...slots.values()].reduce((n, x) => n + (x.staged?.bytes ?? 0), 0);
        if (!Number.isInteger(bytes) || bytes <= 0 || bytes > 128 * 1024 || b.bytes + bytes > limit || total + bytes > 8 * 1024 * 1024)
            throw new Error('View staging byte budget');
    }
    function ready(s, v) {
        const b = s.staged;
        if (!b || b.id !== opaqueIdAt(v.baselineId) || b.baselineGeneration !== v.baselineGeneration)
            return false;
        if (b.chunks !== v.chunkCount)
            throw new Error('Incomplete view baseline');
        b.complete = v.complete;
        s.displayed = b;
        s.staged = undefined;
        s.status = 'ready';
        s.stale = false;
        return true;
    }
    function delta(s, v) {
        const b = s.displayed;
        if (s.staged || !b || b.requestGeneration !== s.requestedGeneration || b.id !== opaqueIdAt(v.baselineId) || b.baselineGeneration !== v.baselineGeneration)
            return false;
        if (v.sequence <= b.sequence)
            return false;
        if (v.baseSequence !== b.sequence)
            throw new Error('View replay required');
        membership(s, v.rows);
        applyRows(b.rows, v.rows, false);
        b.complete = rowsComplete(b.rows, s.slot);
        b.sequence = v.sequence;
        return true;
    }
    function data(s, m, bytes) {
        const r = m.result;
        if (r.case === 'chunk')
            return chunk(s, r.value, bytes);
        if (r.case === 'ready')
            return ready(s, r.value);
        if (r.case === 'delta')
            return delta(s, r.value);
        return false;
    }
    function invalidate(next) { clearEpoch(next, 'unavailable'); }
    function invalidated(s, m) {
        if (m.result.case !== 'invalidated')
            return false;
        if (m.result.value.reason === 1) {
            if (m.visibilityEpoch <= epoch)
                return false;
            invalidate(m.visibilityEpoch);
            return true;
        }
        if (m.requestGeneration !== s.requestedGeneration)
            return false;
        const retired = m.result.value.baselineGeneration;
        if (retired <= s.retired || retired < s.baselineGeneration)
            return false;
        // A reserved source-reset can overtake a Begin that its expired guard discards.
        if (retired > s.baselineGeneration && m.result.value.reason !== 4)
            throw new Error('Future invalidation baseline');
        advanceEpoch(m.visibilityEpoch);
        s.retired = retired;
        s.baselineGeneration = retired;
        s.displayed = undefined;
        s.staged = undefined;
        s.stale = false;
        s.status = 'unavailable';
        changed(s.slot);
        return true;
    }
    function dispatch(s, m, bytes) {
        let applied = true;
        if (m.result.case === 'begin')
            applied = begin(s, m.result.value, m);
        else if (m.result.case === 'rejected') {
            s.staged = undefined;
            s.status = 'rejected';
            s.stale = !!s.displayed;
        }
        else if (m.result.case === 'closed') {
            s.staged = undefined;
            s.displayed = undefined;
            s.status = 'closed';
            s.stale = false;
        }
        else
            applied = data(s, m, bytes);
        if (applied && m.result.case !== 'chunk')
            changed(s.slot);
        return applied;
    }
    function receive(m, generation, encodedBytes) {
        if (disposed || generation !== connection || opaqueIdAt(m.worldId) !== opaqueIdAt(world))
            return false;
        validateViewEvent(m);
        const s = get(m.slot);
        if (m.visibilityEpoch < epoch)
            return false;
        // A user-wide policy invalidation is effective even if its view request became obsolete.
        if (m.result.case === 'invalidated') {
            return invalidated(s, m);
        }
        if (m.requestGeneration !== s.requestedGeneration)
            return false;
        advanceEpoch(m.visibilityEpoch);
        return dispatch(s, m, encodedBytes);
    }
    function admittedReceive(m, generation, bytes) {
        try {
            return receive(m, generation, bytes);
        }
        catch (error) {
            const s = slots.get(m.slot);
            if (s) {
                s.displayed = undefined;
                s.staged = undefined;
                s.status = 'unavailable';
                s.stale = false;
                changed(s.slot);
            }
            throw error;
        }
    }
    return { request, receive: admittedReceive,
        frontier(slot) {
            const s = get(slot), b = s.displayed;
            return { slot, status: s.status, stale: s.stale, requestGeneration: s.requestedGeneration, visibilityEpoch: epoch,
                displayed: b && { id: b.id, topologyRevision: b.topologyRevision, requestGeneration: b.requestGeneration, baselineGeneration: b.baselineGeneration, visibilityEpoch: b.visibilityEpoch, sequence: b.sequence } };
        },
        ownedPage(localConnection, query) { const s = get(2); if (!s.displayed || s.staged || s.stale)
            throw new Error('Owned roster unavailable'); return ownedRosterPage(localConnection, s.displayed, query); },
        snapshot(slot) { const { staged: _staged, signature: _signature, baselineGeneration: _baselineGeneration, baselineId: _baselineId, retired: _retired, ...s } = get(slot); return copySnapshot(s); },
        dispose() { disposed = true; slots.clear(); }, };
}
//# sourceMappingURL=cache.js.map