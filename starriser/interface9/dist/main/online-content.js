import { forgetWorkerContent } from '../lib/world-content/worker-client.js';
import { createWorldContentLoader } from '../lib/world-content/loader.js';
import { createIndexedContentStore } from '../lib/world-content/indexed-cache.js';
import { ContentHttpError } from '../lib/world-content/http.js';
import { contentSystemId } from '../lib/world-content/records.js';
import { waitForConsumer } from '../lib/world-content/scheduler.js';
import { createOnlineSystemContent } from './online-system-content.js';
/** The App session is the sole content lifetime owner. Immutable content does not
 * change fleet node handles, routes, discovery grants or command authority. */
export function createOnlineContent(options) {
    let welcome, loader;
    let lifetime;
    let denied = false;
    let lastTopology;
    let detailRequest = 0n;
    let partition;
    let disposal, forgetting;
    let epoch = 0n, closed = false, selected, available = false;
    let destination;
    const consumer = options.consumer;
    const systems = createOnlineSystemContent({
        load: (id, signal) => loader.loadSystem(id, { signal }),
        selected: record => consumer.system(record),
        preview: record => consumer.previewSystem?.(record),
        failed: failure,
    });
    const persistence = options.persistence ?? (scope => createIndexedContentStore({ scope }));
    const credential = Array.from(options.credential, n => n.toString(16).padStart(2, '0')).join('');
    function reset() {
        lifetime?.abort();
        systems.reset();
        destination = undefined;
        available = false;
        consumer.reset();
    }
    function failure(error, signal) {
        if (closed || signal.aborted)
            return;
        if (error instanceof ContentHttpError && [401, 403].includes(error.status)) {
            denied = error.status === 403;
            selected = undefined;
            reset();
        }
        consumer.status('unavailable', 0, 0);
    }
    async function atlas(signal) {
        try {
            const manifest = await loader.loadManifest(signal);
            signal.throwIfAborted();
            available = true;
            systems.select(selected);
            systems.prefetch(destination);
            const total = manifest.atlas.segmentCount;
            for (let index = 0; index < total; index++) {
                consumer.status('loading', index, total);
                const clusters = await loader.loadAtlas(index, { signal });
                signal.throwIfAborted();
                await waitForConsumer(Promise.resolve(consumer.atlas(clusters, index, total)), signal);
            }
            signal.throwIfAborted();
            consumer.status('ready', total, total);
        }
        catch (error) {
            failure(error, signal);
        }
    }
    function activate(next, freshTopology = false) {
        if (!welcome?.contentEndpoint || next < 1n || next < epoch)
            return;
        if (next === epoch && !(freshTopology && denied))
            return;
        // Old selection is not a discovery grant in the replacement visibility cut.
        selected = undefined;
        denied = false;
        reset();
        epoch = next;
        const scope = { credential, visibilityEpoch: next.toString() };
        if (loader)
            loader.reconnect(scope);
        else {
            partition = `${welcome.contentEndpoint}\n${welcome.worldId}\n${welcome.playerId}`;
            loader = createWorldContentLoader({ ...scope, endpoint: welcome.contentEndpoint, worldId: welcome.worldId,
                persistence: options.persistence ? persistence(partition) : undefined, persistenceScope: partition, allowLoopbackHttp: true,
                fetch: options.fetch, pace: options.pace });
        }
        lifetime = new AbortController();
        consumer.status('loading', 0, 0);
        void atlas(lifetime.signal);
    }
    function selectSystem(opaque) {
        if (closed)
            return;
        const id = contentSystemId(opaque);
        if (denied && id !== undefined)
            activate(epoch, true);
        if (selected !== id) {
            selected = id;
            void consumer.system(undefined);
        }
        if (available)
            systems.select(id);
    }
    function prefetchSystem(opaque) {
        if (closed || denied)
            return;
        destination = opaque ? contentSystemId(opaque) : undefined;
        if (available)
            systems.prefetch(destination);
    }
    function topology(value) {
        const token = value.viewToken;
        if (!token || token.connection !== options.generation || token.epoch < epoch)
            return;
        if (lastTopology && !newerTopology(token, lastTopology))
            return;
        lastTopology = { ...token };
        activate(token.epoch, true);
        selectSystem(value.subscription.systemId);
    }
    function acceptedDetail(s) {
        const t = s.displayed;
        return s.state === 'ready' && !s.stale && !!t && t.connection === options.generation && t.request === s.requestedGeneration && t.epoch >= epoch && t.epoch > 0n;
    }
    function detailChanged(s) {
        if (s.slot !== 'detail' || s.requestedGeneration < detailRequest)
            return;
        if (acceptedDetail(s) && s.requested?.kind === 'detail') {
            detailRequest = s.requestedGeneration;
            activate(s.displayed.epoch);
            selectSystem(s.requested.systemId);
            return;
        }
        if (['closed', 'rejected', 'loading', 'unavailable'].includes(s.state))
            detailRequest = s.requestedGeneration;
        if (['closed', 'rejected'].includes(s.state))
            selectSystem('');
    }
    function selectionEvent(value) {
        if (value.type === 'viewChanged')
            detailChanged(value.status);
        if (value.type === 'viewInterests' && value.interests.slots.detail === null)
            selectSystem('');
        if (value.type === 'state' && value.state === 'closed')
            reset();
    }
    function event(value) {
        if (closed || ('generation' in value && value.generation !== options.generation))
            return;
        switch (value.type) {
            case 'welcome':
                detailRequest = 0n;
                welcome = value;
                consumer.status(value.contentEndpoint ? 'waiting' : 'unavailable', 0, 0);
                return;
            case 'viewBarrier':
                activate(value.epoch);
                return;
            case 'topology':
                topology(value);
                return;
            default: selectionEvent(value);
        }
    }
    function dispose(forget = false) {
        if (!disposal) {
            closed = true;
            reset();
            disposal = loader?.dispose() ?? Promise.resolve();
        }
        if (!forget || !partition)
            return disposal;
        // Sign out can follow an already closed transport/database. Reopen only this
        // authenticated identity partition for deletion, never for publication.
        return forgetting ?? (forgetting = disposal.then(async () => {
            if (typeof window !== 'undefined' && !options.persistence) {
                await forgetWorkerContent(partition);
                return;
            }
            const store = persistence(partition);
            try {
                await store.clear();
            }
            finally {
                store.close();
            }
        }).catch(() => { }));
    }
    return { event, selectSystem, prefetchSystem, dispose,
        inspect: () => ({ epoch, available, selected, closed, cache: loader?.inspect() }),
    };
}
function newerTopology(next, previous) {
    for (const field of ['epoch', 'request', 'baseline', 'sequence']) {
        if (next[field] !== previous[field])
            return next[field] > previous[field];
    }
    return false;
}
//# sourceMappingURL=online-content.js.map