import { onGameplayChange } from './live.js';
import { requestSurvey } from './survey.js';
import { requestBattle } from '../../lib/battle-content/client.js';
export function attachBattleScene(port) {
    let version = 0;
    const feed = createBattleSceneFeed(value => port.postMessage({ version, value }));
    port.onmessage = ({ data }) => {
        if (data.type === 'scope') {
            version = data.version;
            feed.scope(data.scope, data.ready);
        }
        if (data.type === 'refresh')
            feed.refresh(data.replay);
        if (data.type === 'close') {
            feed.dispose();
            port.close();
        }
    };
    port.start();
}
/** One bounded, event-driven scene reader. No selection, periodic polling or
 * per-ship state. The renderer owns choreography for these accepted battles. */
export function createBattleSceneFeed(publish, api = { survey: requestSurvey, battle: requestBattle }) {
    let scope, ready = false, closed = false, busy = false, dirty = false;
    let owner = new AbortController(), timer, attempt = 0;
    const active = new Map();
    const unwatch = onGameplayChange(topics => { if (topics & 2)
        refresh(); });
    function cancel() { owner.abort(); owner = new AbortController(); clearTimeout(timer); timer = undefined; }
    function reset() { cancel(); active.clear(); publish({ type: 'reset' }); }
    function schedule(delay = 0) { if (closed || !ready || !scope || busy || timer)
        return; timer = setTimeout(() => { timer = undefined; void run(); }, delay); }
    function refresh(replay = false) { if (replay)
        for (const [id, row] of active)
            active.set(id, [id, row[1], '']); dirty = true; attempt = 0; schedule(); }
    function setScope(next, available) {
        const same = sameScope(next, scope);
        if (!same)
            reset();
        else if (!available)
            cancel();
        scope = next;
        ready = available && !!next;
        if (ready)
            refresh();
    }
    async function discover(current, signal) {
        const rows = new Map();
        let after;
        for (let page = 0; page < 4; page++) {
            const value = await api.survey(current, { action: 'battleScene', system: current.system, after }, signal);
            signal.throwIfAborted();
            for (const row of value.battles ?? [])
                rows.set(row[0], row);
            if (!value.next)
                return rows;
            if (after && value.next <= after)
                throw new Error('Scene battle cursor did not advance');
            after = value.next;
        }
        throw new Error('Scene exceeds 64 simultaneous battles');
    }
    async function read(current, row, signal) {
        const value = await api.battle(current, { systemId: current.system, fleetId: row[1] }, { action: 'read', battleId: row[0] }, signal);
        signal.throwIfAborted();
        if (!value.visuals || value.battleId !== row[0])
            throw new Error('Battle scene is missing matching participant visuals');
        publish({ type: 'battle', value });
        if (value.finished)
            active.delete(row[0]);
        else
            active.set(row[0], [row[0], row[1], String(value.revision)]);
    }
    async function update(current, signal) {
        const rows = await discover(current, signal);
        for (const row of rows.values())
            if (active.get(row[0])?.[2] !== row[2])
                await read(current, row, signal);
        // Fetch the final accepted counts even after a battle leaves the active index.
        for (const [id, row] of [...active])
            if (!rows.has(id)) {
                try {
                    await read(current, row, signal);
                }
                catch (e) {
                    signal.throwIfAborted();
                    if (![404, 409].includes(e.status ?? 0))
                        throw e;
                    active.delete(id);
                    publish({ type: 'remove', id });
                }
            }
    }
    async function run() {
        if (closed || !ready || !scope || busy)
            return;
        const signal = owner.signal, current = scope;
        busy = true;
        dirty = false;
        let delay = 0;
        try {
            await update(current, signal);
            attempt = 0;
        }
        catch (error) {
            if (!signal.aborted) {
                publish({ type: 'error', message: error instanceof Error ? error.message : 'Battle scene unavailable' });
                if (attempt < 3) {
                    delay = 250 * 4 ** attempt++;
                    dirty = true;
                }
            }
        }
        finally {
            busy = false;
            if (dirty)
                schedule(delay);
        }
    }
    return { scope: setScope, refresh, dispose() { closed = true; unwatch(); reset(); scope = undefined; }, inspect: () => ({ active: active.size, busy, ready }) };
}
function sameScope(a, b) {
    if (!a || !b)
        return a === b;
    return a.worldId === b.worldId && a.visibilityEpoch === b.visibilityEpoch && a.system === b.system;
}
//# sourceMappingURL=battle-scene.js.map