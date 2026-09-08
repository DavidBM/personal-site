import { compareStrategic, strategicDisposed } from '../network/strategic-contracts.js';
/** One UI query owner. The observed sequence fences successes AND failures from
 * an older query, including availability changes within one interest. */
export function createStrategicView(options) {
    let frontier = { connectionGeneration: options.generation, interestGeneration: 0n, sequence: 0n };
    let closed = false;
    let querying = false;
    let replacing = false;
    let dirty = false;
    let stopped = false;
    let delay = 500;
    let consumed;
    let pending;
    let timer;
    function clear(status) { options.render({ ...frontier, status, systems: [] }); }
    function later() {
        if (closed || stopped || timer)
            return;
        timer = setTimeout(() => { timer = undefined; if (pending)
            void replace();
        else
            void query(); }, delay);
        delay = Math.min(5000, delay * 2);
    }
    function failed(error, started) {
        if (closed)
            return;
        if (compareStrategic(started, frontier) === 0)
            clear('unavailable');
        dirty = true;
        if (strategicDisposed(error)) {
            stopped = true;
            clearTimeout(timer);
            timer = undefined;
        }
        else
            later();
    }
    function apply(result) {
        if (closed)
            return;
        if (result.connectionGeneration !== options.generation || result.interestGeneration !== frontier.interestGeneration) {
            dirty = true;
            later();
            return;
        }
        if (compareStrategic(result, frontier) < 0) {
            dirty = true;
            later();
            return;
        }
        frontier = { connectionGeneration: result.connectionGeneration, interestGeneration: result.interestGeneration, sequence: result.sequence };
        consumed = frontier;
        dirty = false;
        delay = 500;
        options.render(result);
    }
    async function query() {
        if (closed || stopped || querying || pending || !dirty)
            return;
        const started = { ...frontier };
        querying = true;
        dirty = false;
        try {
            apply(await options.query());
        }
        catch (error) {
            failed(error, started);
        }
        finally {
            querying = false;
        }
        if (dirty && !timer)
            void query();
    }
    async function replace() {
        if (closed || stopped || replacing || !pending)
            return;
        const sent = pending;
        replacing = true;
        try {
            await options.replace(sent);
            if (pending === sent) {
                pending = undefined;
                dirty = true;
                delay = 500;
            }
        }
        catch (error) {
            failed(error, { ...sent, sequence: 0n });
        }
        finally {
            replacing = false;
        }
        continueReplacement(sent);
    }
    function continueReplacement(sent) {
        if (closed || stopped)
            return;
        if (pending && pending !== sent)
            void replace();
        else if (!pending)
            void query();
    }
    return {
        select(systemIds) {
            if (closed)
                return;
            clearTimeout(timer);
            timer = undefined;
            frontier = { connectionGeneration: options.generation, interestGeneration: frontier.interestGeneration + 1n, sequence: 0n };
            pending = { ...frontier, systemIds: [...systemIds] };
            dirty = true;
            clear('pending');
            void replace();
        },
        refresh(value) {
            if (closed || value.connectionGeneration !== options.generation || value.interestGeneration !== frontier.interestGeneration)
                return;
            if (compareStrategic(value, frontier) < 0)
                return;
            if (!dirty && consumed && compareStrategic(value, consumed) <= 0)
                return;
            frontier = { ...value };
            dirty = true;
            clear('pending');
            void query();
        },
        resume() { if (closed)
            return; dirty = true; if (pending)
            void replace();
        else
            void query(); },
        dispose() { closed = true; clearTimeout(timer); pending = undefined; },
    };
}
//# sourceMappingURL=strategic-view.js.map