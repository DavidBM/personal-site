import { compareStrategic, strategicDisposed } from './strategic-contracts.js';
/** Completion means main owns a refresh. Retain the newest frontier until that
 * acknowledgement, even if no later world change arrives. No decode awaits. */
export function createStrategicNotifier(send) {
    const lifetime = new AbortController();
    let latest;
    let running = false;
    let delay = 500;
    let timer;
    function failed(error) {
        if (strategicDisposed(error))
            lifetime.abort();
        if (lifetime.signal.aborted)
            return;
        timer = setTimeout(() => { timer = undefined; void pump(); }, delay);
        delay = Math.min(5000, delay * 2);
    }
    async function pump() {
        if (running || !latest || lifetime.signal.aborted)
            return;
        const sent = latest;
        running = true;
        try {
            await send(sent, lifetime.signal);
            if (latest === sent)
                latest = undefined;
            delay = 500;
        }
        catch (error) {
            failed(error);
        }
        finally {
            running = false;
        }
        if (!timer && latest && !lifetime.signal.aborted)
            void pump();
    }
    return {
        notify(value) {
            if (lifetime.signal.aborted || latest && compareStrategic(value, latest) < 0)
                return;
            latest = { ...value };
            if (!timer)
                void pump();
        },
        dispose() { lifetime.abort(); clearTimeout(timer); latest = undefined; },
    };
}
//# sourceMappingURL=strategic-notifier.js.map