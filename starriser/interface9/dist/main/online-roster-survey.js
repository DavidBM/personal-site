import { createWorldContentLoader } from '../lib/world-content/loader.js';
import { contentSystemId, parseContentSystem } from '../lib/world-content/records.js';
import { atlasClusterId } from './online-viewport.js';
/** Login roster -> map facts. Never selects a detail view, installs topology or allocates ship models. */
export function createOnlineRosterSurvey(options) {
    let welcome;
    let content, epoch = 0n, ticket = 0, closed = false, busy = false, dirty = false;
    let attempt = 0;
    let timer;
    let lifetime = new AbortController();
    const nodes = new Map();
    function clear() {
        ticket++;
        dirty = false;
        attempt = 0;
        clearTimeout(timer);
        timer = undefined;
        options.publish([]);
    }
    function reset() {
        clear();
        lifetime.abort();
        lifetime = new AbortController();
        nodes.clear();
        epoch = 0n;
        void content?.dispose();
        content = undefined;
    }
    function activate(next) {
        if (!welcome?.contentEndpoint || next < 1n || next < epoch)
            return false;
        if (content && next === epoch)
            return true;
        reset();
        epoch = next;
        content = (options.content ?? createWorldContentLoader)({ endpoint: welcome.contentEndpoint,
            worldId: welcome.worldId, credential: Array.from(options.credential, n => n.toString(16).padStart(2, '0')).join(''),
            visibilityEpoch: String(epoch), allowLoopbackHttp: true });
        return true;
    }
    async function node(id, signal) {
        const found = nodes.get(id);
        if (found)
            return found;
        const numeric = contentSystemId(id);
        if (numeric === undefined)
            throw new Error('Fleet location has no content mapping');
        const record = content.loadSystem ? await content.loadSystem(numeric, { signal }) : parseContentSystem(await content.load(`system/${numeric}`, { signal }), numeric);
        signal.throwIfAborted();
        const value = { node: options.node(id, atlasClusterId(record.clusterId)), position: record.position };
        // Immutable metadata, bounded and scoped to the current permission epoch.
        if (nodes.size >= 512)
            nodes.delete(nodes.keys().next().value);
        nodes.set(id, value);
        return value;
    }
    async function project(row, signal) {
        const loc = row.location, transit = loc.kind === 'transit';
        const id = transit ? loc.destinationSystemId : loc.systemId;
        const destination = await node(id, signal);
        const source = transit ? await node(loc.sourceSystemId, signal) : undefined;
        return { id: row.id, routeVersion: `${row.revision}:${row.sourceRevision}:${row.committedMs}`, node: destination.node, source: source?.node, position: destination.position, sourcePosition: source?.position, onlineSystemId: id, ships: row.memberCount, moving: transit || loc.moving };
    }
    function current(expected, signal) { return !closed && !signal.aborted && expected === ticket; }
    async function projectPage(page, rows, expected, signal) {
        if (page.token.connection !== options.generation || page.token.epoch !== epoch || page.unavailableSourceIds.length || page.total > 16384)
            throw new Error('Fleet roster is unavailable');
        for (const fleet of page.fleets) {
            if (!current(expected, signal))
                return;
            if (fleet.availability === 1)
                rows.push(await project(fleet, signal));
        }
    }
    async function read(expected, signal) {
        const rows = [];
        let offset = 0, required;
        do {
            const page = await options.query({ offset, limit: 64, required });
            if (!current(expected, signal))
                return;
            required = page.token;
            await projectPage(page, rows, expected, signal);
            if (page.nextOffset === null)
                break;
            if (page.nextOffset <= offset)
                throw new Error('Invalid fleet roster page');
            offset = page.nextOffset;
        } while (offset < 16384);
        // Fence the final metadata fetch against a roster revision that changed mid-read.
        await options.query({ limit: 1, required });
        if (current(expected, signal))
            options.publish(rows);
    }
    async function refresh() {
        if (busy || closed || !dirty)
            return;
        busy = true;
        dirty = false;
        const expected = ticket, signal = lifetime.signal;
        try {
            await read(expected, signal);
            attempt = 0;
        }
        catch (error) {
            if (current(expected, signal)) {
                if (attempt < 3) {
                    dirty = true;
                    schedule(250 * 4 ** attempt++);
                }
                options.failed?.(error);
            }
        }
        finally {
            busy = false;
            if (dirty)
                schedule();
        }
    }
    function schedule(delay = 100) {
        if (timer || closed)
            return;
        timer = setTimeout(() => { timer = undefined; void refresh(); }, delay);
    }
    function event(value) {
        if (closed || ('generation' in value && value.generation !== options.generation))
            return;
        switch (value.type) {
            case 'welcome':
                welcome = value;
                return;
            case 'viewBarrier':
                reset();
                epoch = value.epoch;
                return;
            case 'state':
                if (value.state === 'closed')
                    reset();
                return;
            case 'viewChanged':
                changed(value.status);
                return;
        }
    }
    function changed(status) {
        if (status.slot !== 'owned')
            return;
        if (status.state !== 'ready' || status.stale || !status.displayed) {
            clear();
            return;
        }
        if (status.displayed.connection !== options.generation)
            return;
        if (!activate(status.displayed.epoch))
            return;
        ticket++;
        attempt = 0;
        dirty = true;
        schedule();
    }
    return { event, dispose() { closed = true; reset(); } };
}
//# sourceMappingURL=online-roster-survey.js.map