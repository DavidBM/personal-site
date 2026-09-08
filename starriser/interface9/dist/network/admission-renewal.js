import { opaqueIdAt } from '../contracts/opaque-id.js';
const EARLY_MS = 5 * 60000, RETRY_MS = 30000, RESPONSE_MS = 5000;
function copyGrant(value) {
    return { $typeName: 'galaxy.v1.AdmissionGrant', receiptHomeShardId: value.receiptHomeShardId.slice(),
        generation: value.generation, notAfterServerMs: value.notAfterServerMs, token: value.token.slice() };
}
/** One connection owns at most one refresh. Timers are advisory: new commands
 * also check their home after suspension. Retained intents never use this path. */
export function createAdmissionRenewal(options) {
    const homes = new Map();
    let pending, timer;
    let nextId = 0n, closed = false;
    function home(id) {
        let value = homes.get(id);
        if (!value) {
            if (homes.size >= 16)
                throw new Error('Admission home capacity exceeded');
            value = { id, retryAt: 0 };
            homes.set(id, value);
        }
        return value;
    }
    for (const grant of options.grants)
        home(opaqueIdAt(grant.receiptHomeShardId)).grant = copyGrant(grant);
    function usable(value) { return !!value.grant && value.grant.notAfterServerMs >= options.serverNow(); }
    function dueAt(value) {
        const remaining = value.grant ? value.grant.notAfterServerMs - options.serverNow() : 0n;
        const delay = Number(remaining > BigInt(EARLY_MS) ? remaining - BigInt(EARLY_MS) : 0n);
        return Math.max(value.retryAt, options.now() + Math.min(delay, 2147483647));
    }
    function arm() {
        clearTimeout(timer);
        timer = undefined;
        if (closed || pending || !homes.size)
            return;
        let selected, due = Infinity;
        for (const value of homes.values()) {
            const at = dueAt(value);
            if (at < due) {
                selected = value;
                due = at;
            }
        }
        timer = setTimeout(() => { timer = undefined; void refresh(selected); }, Math.max(0, due - options.now()));
    }
    function complete(attempt, retryMs) {
        if (pending !== attempt)
            return;
        clearTimeout(attempt.timer);
        pending = undefined;
        attempt.home.retryAt = options.now() + retryMs;
        attempt.finish();
        arm();
    }
    function refresh(value) {
        if (closed)
            return Promise.resolve();
        if (pending)
            return pending.promise;
        if (value.retryAt > options.now()) {
            arm();
            return Promise.resolve();
        }
        if (nextId === 0xffffffffffffffffn) {
            dispose();
            return Promise.resolve();
        }
        clearTimeout(timer);
        timer = undefined;
        let finish;
        const promise = new Promise(resolve => { finish = resolve; });
        const attempt = { home: value, id: ++nextId, sentAt: options.now(), promise, finish,
            timer: setTimeout(() => complete(attempt, RETRY_MS), RESPONSE_MS) };
        pending = attempt;
        void options.send(value.id, attempt.id).catch(() => complete(attempt, RETRY_MS));
        return promise;
    }
    function receive(value) {
        const attempt = pending;
        if (!attempt || value.requestId !== attempt.id || opaqueIdAt(value.receiptHomeShardId) !== attempt.home.id)
            return false;
        options.sample(value.serverTimeMs, attempt.sentAt);
        retainGrant(attempt.home, value.grant);
        const retry = value.retryAfterMs || (usable(attempt.home) && dueAt(attempt.home) > options.now() ? 0 : RETRY_MS);
        complete(attempt, retry);
        return true;
    }
    function retainGrant(value, grant) {
        if (!grant || grant.notAfterServerMs < options.serverNow())
            return;
        if (value.grant && grant.notAfterServerMs < value.grant.notAfterServerMs)
            return;
        value.grant = copyGrant(grant);
        options.accept(value.grant);
    }
    async function ensure(id) {
        if (closed)
            throw new Error('Admission renewal disposed');
        const value = home(id);
        if (usable(value))
            return;
        if (pending && pending.home !== value)
            await pending.promise;
        if (!closed && !usable(value))
            await refresh(value);
        if (closed)
            throw new Error('Admission renewal disposed');
        if (!usable(value))
            throw new Error('Command admission temporarily unavailable; try again shortly');
    }
    function expired(key) {
        const value = homes.get(opaqueIdAt(key.receiptHomeShardId));
        if (!value?.grant || value.grant.generation !== key.admissionGeneration)
            return;
        // Authority can know more than our clock observation. An old-key outcome
        // cannot invalidate a newer grant, and no retained intent is rewritten.
        value.grant = undefined;
        arm();
    }
    function dispose() {
        if (closed)
            return;
        closed = true;
        clearTimeout(timer);
        if (pending) {
            clearTimeout(pending.timer);
            pending.finish();
            pending = undefined;
        }
        homes.clear();
    }
    arm();
    return { ensure, receive, expired, dispose };
}
//# sourceMappingURL=admission-renewal.js.map