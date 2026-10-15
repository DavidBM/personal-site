/** Page-owned connection lifetime. Network I/O and snapshot decoding stay in workers.
 * A retry replaces the session, never replays gameplay commands or reloads the page. */
export const ONLINE_RECOVERY = { firstMs: 1000, maximumMs: 30000, freshAfterMs: 30000 };
export function createOnlineRecovery(ports) {
    const now = ports.now ?? Date.now, random = ports.random ?? Math.random;
    let enabled = false, online = true, visible = true, ready = false, failures = 0, readyAt = 0;
    let hiddenAt, controller;
    let running, timer;
    let lostDuringAttempt = false;
    function cancelTimer() { clearTimeout(timer); timer = undefined; }
    function retire() { ready = false; controller?.abort(); controller = undefined; ports.invalidate(); }
    function schedule(delay) {
        cancelTimer();
        if (!enabled || !online || !visible)
            return;
        if (delay)
            ports.status(`Connection interrupted · retrying in ${Math.ceil(delay / 1000)}s. Pending orders are retained.`);
        timer = setTimeout(() => { timer = undefined; void attempt(); }, delay);
    }
    function backoff() {
        const base = Math.min(ONLINE_RECOVERY.maximumMs, ONLINE_RECOVERY.firstMs * 2 ** Math.min(failures++, 5));
        schedule(Math.round(base * (0.8 + 0.2 * random())));
    }
    function current(owner) { return controller === owner && !owner.signal.aborted; }
    function failed(owner, error) {
        if (!current(owner))
            return;
        retire();
        if (ports.retryable(error))
            backoff();
        else {
            enabled = false;
            ports.status(error instanceof Error ? error.message : 'Connect again to sign in.');
        }
    }
    function finished() {
        running = undefined;
        // An aborted auth/startup still owns the slot until it settles.
        if (enabled && online && visible && !ready && !timer)
            schedule(0);
    }
    async function attempt() {
        if (!enabled || !online || running)
            return;
        if (ports.busy()) {
            schedule(250);
            return;
        }
        const owner = new AbortController();
        controller = owner;
        lostDuringAttempt = false;
        ports.status('Reconnecting · refreshing current game state…');
        running = ports.connect(owner.signal);
        try {
            await running;
            if (!current(owner))
                return;
            if (lostDuringAttempt)
                throw new Error('Connection closed while restoring game state');
            ready = true;
            readyAt = now();
            ports.status('Connected · Scroll to explore. Double-click a system to enter.');
        }
        catch (error) {
            failed(owner, error);
        }
        finally {
            finished();
        }
    }
    function lost() {
        if (!enabled)
            return;
        if (ready && now() - readyAt >= ONLINE_RECOVERY.freshAfterMs)
            failures = 0;
        if (ready) {
            retire();
            backoff();
        }
        else if (running)
            lostDuringAttempt = true;
        // During startup, the connect promise owns failure and its one retry.
    }
    return {
        start() { enabled = true; failures = 0; cancelTimer(); retire(); schedule(0); },
        lost,
        online(value) {
            online = value;
            if (!enabled)
                return;
            if (!value) {
                cancelTimer();
                retire();
                ports.status('Offline · waiting for a connection. Pending orders are retained.');
            }
            else if (!ready)
                schedule(0);
        },
        visibility(value) {
            // Hiding does not tear down a healthy connection. Android can suspend
            // workers/sockets independently; postpone retries until the player returns.
            visible = value;
            if (!visible) {
                hiddenAt = now();
                cancelTimer();
                return;
            }
            const stale = hiddenAt !== undefined && now() - hiddenAt >= ONLINE_RECOVERY.freshAfterMs;
            hiddenAt = undefined;
            if (stale && ready)
                lost();
            else if (enabled && online && !ready && !running)
                schedule(0);
        },
        stop() { enabled = false; cancelTimer(); retire(); },
    };
}
//# sourceMappingURL=online-recovery.js.map