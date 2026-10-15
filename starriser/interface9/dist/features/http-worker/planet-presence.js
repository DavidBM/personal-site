import { requestSurvey } from './survey.js';
import { onGameplayChange } from './live.js';
/** Current detail owns a bounded snapshot. No idle polling or remembered garrisons. */
export function createPlanetPresenceFeed(publish, read = requestSurvey) {
    let scope, system, enabled = true, closed = false;
    let attempt = 0, busy = false, dirty = false;
    let owner = new AbortController(), timer;
    const unwatch = onGameplayChange((topics) => { if (topics & 32) {
        attempt = 0;
        refresh();
    } });
    function cancel() { busy = false; owner.abort(); owner = new AbortController(); clearTimeout(timer); timer = undefined; }
    function clear() { cancel(); attempt = 0; dirty = false; publish(undefined); }
    function schedule(delay = 100) {
        if (closed || !scope || !system || !enabled || busy || timer || !dirty)
            return;
        timer = setTimeout(() => { timer = undefined; void load(scope, system, owner.signal); }, delay);
    }
    function refresh() { dirty = true; schedule(); }
    async function readPages(context, id, signal) {
        let after, combined;
        for (let page = 0; page < 8; page++) {
            const value = await read(context, { action: 'planetPresence', system: id, after }, signal);
            signal.throwIfAborted();
            const row = value.presence;
            if (!row)
                throw new Error('Missing planet presence');
            combined = combined ? { ...row, direct: combined.direct && row.direct, owners: [...combined.owners, ...row.owners] } : row;
            if (!value.next)
                return combined.direct ? combined : { ...combined, stationed: [] };
            if (value.next === after)
                throw new Error('Repeated planet presence cursor');
            after = value.next;
        }
        throw new Error('Planet presence exceeds page budget');
    }
    async function load(context, id, signal) {
        busy = true;
        dirty = false;
        let delay = 100;
        try {
            const value = await readPages(context, id, signal);
            signal.throwIfAborted();
            attempt = 0;
            publish(value);
        }
        catch (error) {
            if (!signal.aborted) {
                if ([401, 403, 412].includes(error.status ?? 0)) {
                    clear();
                    return;
                }
                console.error('Planet presence refresh failed', error);
                if (attempt < 3) {
                    dirty = true;
                    delay = 250 * 4 ** attempt++;
                }
            }
        }
        finally {
            if (signal === owner.signal) {
                busy = false;
                if (dirty)
                    schedule(delay);
            }
        }
    }
    return {
        scope(value) { scope = value; system = undefined; clear(); },
        system(value) { if (system !== value) {
            clear();
            system = value;
        } refresh(); },
        enabled(value) { if (enabled === value)
            return; enabled = value; clear(); refresh(); },
        dispose() { closed = true; unwatch(); clear(); }
    };
}
//# sourceMappingURL=planet-presence.js.map