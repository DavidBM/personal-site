import { createViewInterests, normalizedSelector } from './interests.js';
import { create } from '@bufbuild/protobuf';
import { ViewSelectorSchema } from '../generated/galaxy/v1/galaxy_pb.js';
import { createPlayerViewCache } from './cache.js';
import { createDetailProjection } from './detail-projection.js';
import { createViewOverview } from './overview.js';
import { copyObservation, copyRow } from './copy.js';
import { ViewDeltaSchema } from '../generated/galaxy/v1/galaxy_pb.js';
import { opaqueIdAt, opaqueIdBytes } from '../../contracts/opaque-id.js';
import { watermark } from '../../render/remote/projection-state.js';
const slots = { overview: 1, owned: 2, detail: 3 };
const names = ['overview', 'owned', 'detail'];
export function createPlayerViewBridge(options) {
    const interests = createViewInterests(options.world, options.player, options.interests);
    let autoDetail = interests.snapshot().slots.detail === undefined;
    const publishInterests = () => void options.emit({ type: 'viewInterests', generation: options.generation, interests: interests.snapshot() });
    const selectors = new Map();
    let installed, pending, closed = false, projecting = false;
    let deferred = [];
    let deferredBytes = 0;
    const detail = createDetailProjection(options.generation, options.player, options.subscriptionId);
    const overview = createViewOverview(options.world, options.generation);
    function fence() { options.output.reset(); detail.invalidate(); projecting = false; deferred = []; deferredBytes = 0; }
    const cache = createPlayerViewCache(opaqueIdBytes(options.world), options.connection, slot => { void options.emit({ type: 'viewChanged', status: status(names[slot - 1], false) }); }, epoch => {
        fence();
        installed = undefined;
        pending = undefined;
        overview.clear();
        options.policy();
        void options.emit({ type: 'viewBarrier', generation: options.generation, epoch });
    });
    function status(slot, requested = true) {
        const f = cache.frontier(slots[slot]), b = f.displayed;
        return { slot, requested: requested ? selectors.get(slot) : undefined, requestedGeneration: f.requestGeneration, state: f.status, stale: f.stale,
            displayed: b && { connection: options.generation, request: b.requestGeneration, baseline: b.baselineGeneration, epoch: b.visibilityEpoch, sequence: b.sequence } };
    }
    async function replace(slot, selector) {
        if (closed)
            throw new Error('Player views closed');
        if (selector && selector.kind !== slot)
            throw new Error('Wrong player view slot');
        if (selector)
            selector = normalizedSelector(selector);
        if (slot === 'detail') {
            autoDetail = false;
            fence();
        }
        if (slot === 'overview') {
            fence();
            installed = undefined;
            pending = undefined;
        }
        if (selector)
            selectors.set(slot, selector);
        else
            selectors.delete(slot);
        const generation = cache.frontier(slots[slot]).requestGeneration + 1n;
        const request = cache.request(slots[slot], generation, selector && wireSelector(selector));
        interests.request(slot, generation, selector);
        publishInterests();
        await options.send(request);
        return status(slot);
    }
    function topology() {
        const baseline = cache.snapshot(1).displayed;
        if (!baseline)
            return;
        fence();
        installed = undefined;
        const view = overview.install(baseline);
        pending = { connection: options.generation, request: baseline.requestGeneration, baseline: baseline.baselineGeneration, epoch: baseline.visibilityEpoch, sequence: baseline.sequence };
        const requested = selectors.get('detail');
        const desired = requested?.kind === 'detail' ? requested.systemId : options.preferred;
        const systemId = desired && overview.node(desired) ? desired : overview.first() ?? '';
        void options.emit({ type: 'topology', generation: options.generation, topology: view, subscription: { worldId: options.world, systemId, subscriptionId: options.subscriptionId }, viewToken: { ...pending } });
        aggregateChanged();
    }
    function same(a, b) { return a.connection === b.connection && a.request === b.request && a.baseline === b.baseline && a.epoch === b.epoch && a.sequence === b.sequence; }
    async function topologyInstalled(token) {
        if (closed || !pending || !same(token, pending))
            return;
        installed = pending;
        pending = undefined;
        const requested = selectors.get('detail');
        if (requested?.kind === 'detail') {
            if (!overview.node(requested.systemId)) {
                await replace('detail');
                return;
            }
            projectDetail();
            return;
        }
        await defaultDetail();
    }
    async function defaultDetail() {
        if (!autoDetail)
            return;
        const desired = options.preferred && overview.node(options.preferred) ? options.preferred : overview.first();
        if (desired)
            await replace('detail', { kind: 'detail', systemId: desired });
    }
    function received(batch, complete) {
        void options.emit({ type: 'received', streamGeneration: batch.streamGeneration, sequence: batch.sequence, systemRevision: batch.systemRevision, snapshotComplete: complete, watermark: watermark(batch) });
    }
    function detailReady() {
        const frontier = cache.frontier(3), displayed = frontier.displayed;
        if (frontier.status !== 'ready' || frontier.stale || !displayed)
            return false;
        return displayed.requestGeneration === frontier.requestGeneration && displayed.visibilityEpoch === frontier.visibilityEpoch;
    }
    function currentDetail() {
        if (!detailReady())
            return;
        const systemId = selectors.get('detail');
        if (systemId?.kind !== 'detail')
            return;
        const baseline = cache.snapshot(3).displayed;
        if (!baseline?.complete || baseline.selector.kind.case !== 'detail')
            return;
        if (opaqueIdAt(baseline.selector.kind.value.systemId) !== systemId.systemId)
            return;
        return { baseline, systemId: systemId.systemId };
    }
    function projectDetail() {
        if (!installed || pending || closed)
            return;
        const current = currentDetail();
        if (!current)
            return;
        const { baseline, systemId } = current;
        const node = overview.node(systemId);
        if (!node)
            return;
        fence();
        options.output.reset({ identity: { worldId: options.world, systemId, subscriptionId: options.subscriptionId }, node });
        projecting = true;
        const source = detail.snapshot(baseline);
        function* pages() { for (const batch of source) {
            batch.clock = options.clock();
            received(batch, batch.snapshot.index + 1 === batch.snapshot.count);
            yield batch;
        } }
        options.output.stream(pages(), () => { projecting = false; const queued = deferred; deferred = []; deferredBytes = 0; for (const delta of queued)
            projectDelta(delta.value, delta.request, delta.epoch); });
    }
    function projectDelta(value, request, epoch) {
        const batch = detail.delta(value, request, epoch);
        if (!batch)
            return;
        batch.clock = options.clock();
        received(batch, true);
        options.output.enqueue(batch);
    }
    function aggregateChanged() { void options.emit({ type: 'strategic', frontier: overview.frontier() }); }
    function receive(value, bytes) {
        if (!cache.receive(value, options.connection, bytes))
            return;
        const result = value.result;
        recordInterest(value);
        if (result.case === 'invalidated' && value.slot === 3) {
            fence();
            return;
        }
        if (result.case === 'invalidated' && value.slot === 1) {
            fence();
            installed = undefined;
            pending = undefined;
            overview.clear();
            aggregateChanged();
            return;
        }
        if (result.case === 'ready') {
            if (value.slot === 1)
                topology();
            if (value.slot === 3)
                projectDetail();
        }
        if (result.case === 'delta')
            receiveDelta(result.value, value, bytes);
    }
    function recordInterest(value) {
        if (value.result.case === 'begin') {
            interests.accept(names[value.slot - 1], value.requestGeneration);
            publishInterests();
        }
        if (value.result.case === 'rejected') {
            interests.reject(names[value.slot - 1], value.requestGeneration);
            publishInterests();
        }
    }
    function receiveDelta(delta, value, bytes) {
        if (delta.rows.case === 'overview') {
            if (overview.delta(delta.rows.value, delta.sequence))
                topology();
            else
                aggregateChanged();
        }
        if (value.slot !== 3)
            return;
        if (!projecting) {
            projectDelta(delta, value.requestGeneration, value.visibilityEpoch);
            return;
        }
        if (deferredBytes + bytes > 1024 * 1024 || deferred.length >= 64)
            throw new Error('Detail projection consumer is too slow');
        deferred.push({ value: copyDetailDelta(delta), request: value.requestGeneration, epoch: value.visibilityEpoch, bytes });
        deferredBytes += bytes;
    }
    return { receive, replace, status, topologyInstalled, detail, overview,
        owned: (query) => cache.ownedPage(options.generation, query),
        async start() {
            const initial = interests.snapshot().slots;
            await replace('overview', initial.overview === null ? undefined : initial.overview ?? { kind: 'overview', scope: { kind: 'galaxy' } });
            await replace('owned', initial.owned === null ? undefined : initial.owned ?? { kind: 'owned' });
            if (initial.detail !== undefined)
                await replace('detail', initial.detail ?? undefined);
        },
        dispose() { closed = true; fence(); cache.dispose(); }, inspect: () => ({ installed, pending, projecting, queuedDeltas: deferred.length }) };
}
function wireSelector(value) {
    if (value.kind === 'owned')
        return create(ViewSelectorSchema, { kind: { case: 'owned', value: {} } });
    if (value.kind === 'detail')
        return create(ViewSelectorSchema, { kind: { case: 'detail', value: { systemId: opaqueIdBytes(value.systemId) } } });
    const scope = value.scope;
    return create(ViewSelectorSchema, { kind: { case: 'overview', value: { wholeKnownGalaxy: scope.kind === 'galaxy', systemIds: scope.kind === 'systems' ? scope.ids.map(opaqueIdBytes) : [], clusterIds: scope.kind === 'clusters' ? scope.ids.map(opaqueIdBytes) : [] } } });
}
/** Deferred frames own compact typed fields, never an entire decoder backing buffer. */
function copyDetailDelta(value) {
    if (value.rows.case !== 'detail')
        throw new Error('Expected detail delta');
    const rows = value.rows.value;
    return create(ViewDeltaSchema, { baselineId: new Uint8Array(value.baselineId), baselineGeneration: value.baselineGeneration, baseSequence: value.baseSequence, sequence: value.sequence, rows: { case: 'detail', value: { observation: copyObservation(rows.observation), upserts: rows.upserts.map(row => copyRow(row)), removedFleetIds: rows.removedFleetIds.map(id => new Uint8Array(id)) } } });
}
//# sourceMappingURL=bridge.js.map