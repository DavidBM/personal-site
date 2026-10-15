import { watchGameplay } from '../features/http-worker/client.js';
import { requestSurvey } from '../features/http-worker/survey.js';
/** Sparse viewport discovery and own alerts; independent of selected detail/panels. */
export function createOnlineSurvey(options) {
    let home, epoch = 0n, closed = false;
    let owner = new AbortController(), timer, busy = false;
    let visible = [], at = 0, viewport = 0;
    let cursor, rows = new Map(), pages = 0, alertsComplete = false, alertsRevision = 0;
    const unwatch = watchGameplay(2 | 32, () => { alertsRevision++; cursor = undefined; rows.clear(); pages = 0; alertsComplete = false; schedule(0); });
    const versions = new Map();
    function reset() { owner.abort(); owner = new AbortController(); clearTimeout(timer); timer = undefined; epoch = 0n; cursor = undefined; rows.clear(); pages = 0; alertsComplete = false; versions.clear(); at = 0; options.alerts([], false); }
    function scope() { return { worldId: home.worldId, visibilityEpoch: String(epoch) }; }
    function schedule(delay) { if (closed || timer || !home || epoch < 1n)
        return; timer = setTimeout(() => { timer = undefined; void refresh(); }, delay); }
    function catalog(reply, systems) {
        for (const row of reply.systems ?? []) {
            const system = systems.find(s => s.id === row[0]);
            if (!system || (versions.has(row[0]) && versions.get(row[0]) === row[2]))
                continue;
            if (versions.size >= 512)
                versions.delete(versions.keys().next().value);
            versions.set(row[0], row[2]);
            options.planets(row[0], options.node(row[0], system.clusterId), row[2]);
        }
    }
    function alerts(values) {
        for (const [id, system, cluster, revision] of values) {
            const node = options.node(system, cluster);
            rows.set(id, { id: `online:${id}`, revision, clusterId: node.clusterId, systemId: node.solarSystemId, involvement: 'own', active: true });
        }
    }
    function acceptAlerts(reply) {
        alerts(reply.alerts ?? []);
        pages++;
        cursor = reply.next ?? undefined;
        const partial = rows.size >= 64 || pages >= 64;
        if (cursor && !partial)
            return;
        options.alerts([...rows.values()].slice(0, 64), partial && !!cursor);
        rows = new Map();
        cursor = undefined;
        pages = 0;
        alertsComplete = true;
    }
    async function discover(signal) {
        const systems = visible.slice(at, at + 16), revision = viewport;
        if (!systems.length)
            return;
        const reply = await (options.request ?? requestSurvey)(scope(), { action: 'systems', systems: systems.map(s => s.id) }, signal);
        signal.throwIfAborted();
        catalog(reply, systems);
        if (revision === viewport)
            at += systems.length;
    }
    async function readAlerts(signal) {
        if (alertsComplete)
            return;
        const revision = alertsRevision;
        const reply = await (options.request ?? requestSurvey)(scope(), { action: 'alerts', cursor }, signal);
        signal.throwIfAborted();
        if (revision === alertsRevision)
            acceptAlerts(reply);
    }
    function failed(error, signal) {
        const status = error.status;
        if (!signal.aborted && (status === 403 || status === 401))
            reset();
    }
    async function refresh() {
        if (busy) {
            schedule(250);
            return;
        }
        busy = true;
        const signal = owner.signal;
        let retry = false;
        try {
            await discover(signal);
            await readAlerts(signal);
        }
        catch (error) {
            failed(error, signal);
            retry = !signal.aborted;
        }
        finally {
            busy = false;
            if (!signal.aborted && (retry || at < visible.length || !alertsComplete))
                schedule(retry ? 2000 : (options.pageDelayMs ?? 250));
        }
    }
    function topology(view) { viewport++; visible = view.systems.slice(0, 512); at = 0; clearTimeout(timer); timer = undefined; schedule(0); }
    function ready(value) {
        const status = value.status, token = status.displayed;
        if (status.state !== 'ready' || status.stale || token?.connection !== options.generation || token.epoch <= epoch)
            return;
        reset();
        epoch = token.epoch;
        schedule(0);
    }
    function event(value) {
        if (closed || ('generation' in value && value.generation !== options.generation))
            return;
        switch (value.type) {
            case 'welcome':
                reset();
                visible = [];
                home = value;
                return;
            case 'viewBarrier':
                reset();
                visible = [];
                epoch = value.epoch;
                schedule(0);
                return;
            case 'viewChanged':
                ready(value);
                return;
            case 'state':
                if (value.state === 'closed') {
                    reset();
                    home = undefined;
                }
                return;
        }
    }
    return { event, topology, dispose() { closed = true; unwatch(); reset(); home = undefined; visible = []; } };
}
//# sourceMappingURL=online-survey.js.map