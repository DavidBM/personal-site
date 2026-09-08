import { createBusCapacity } from './bus-capacity.js';
import { ServiceError } from './service-types.js';
export const serviceQueueClock = () => performance.timeOrigin + performance.now();
export function eventDeadline(maxQueueAgeMs) {
    if (maxQueueAgeMs === undefined)
        return;
    if (!Number.isSafeInteger(maxQueueAgeMs) || maxQueueAgeMs < 0 || maxQueueAgeMs > 2147483647)
        throw new Error('Invalid service event queue age');
    return serviceQueueClock() + maxQueueAgeMs;
}
export function eventQueueLifetime(signals, expiresAt) {
    if (expiresAt !== undefined && !Number.isFinite(expiresAt))
        throw new Error('Invalid service event expiry');
    const deadline = new AbortController();
    const timer = expiresAt === undefined ? undefined : setTimeout(() => {
        deadline.abort(new ServiceError('EXPIRED', 'Disposable service event expired'));
    }, Math.max(0, expiresAt - serviceQueueClock()));
    return { signal: AbortSignal.any([...signals, deadline.signal]), close: () => clearTimeout(timer) };
}
/** Service slots last through handler completion; transport slots are separate. */
export function createServiceAdmission() {
    const total = createBusCapacity({ maxQueuedMessages: 2048 });
    const owners = new Map();
    const lifetimes = new Map();
    const size = { bytes: 256, control: false };
    function lifetime(member) {
        let value = lifetimes.get(member);
        if (!value) {
            value = new AbortController();
            lifetimes.set(member, value);
        }
        return value.signal;
    }
    function capacity(owner, contract, maximum) {
        let contracts = owners.get(owner);
        if (!contracts) {
            contracts = new Map();
            owners.set(owner, contracts);
        }
        let gate = contracts.get(contract);
        if (!gate) {
            gate = createBusCapacity({ maxQueuedMessages: maximum });
            contracts.set(contract, gate);
        }
        return gate;
    }
    function releaseBoth(a, b) {
        a.claim();
        b.claim();
        return () => { a.release(); b.release(); };
    }
    return {
        lifetime,
        tryAdmit(owner, contract, maximum) {
            const local = capacity(owner, contract, maximum).tryReserve(size);
            const shared = local && total.tryReserve(size);
            if (!local || !shared) {
                local?.release();
                throw new ServiceError('OVERLOADED', 'Owner delivery capacity exceeded');
            }
            return releaseBoth(local, shared);
        },
        async admit(owner, contract, maximum, signal) {
            const scope = AbortSignal.any([signal, lifetime(owner)]);
            let local;
            try {
                local = await capacity(owner, contract, maximum).reserve(size, scope);
                const shared = await total.reserve(size, scope);
                if (scope.aborted) {
                    shared.release();
                    throw scope.reason;
                }
                return releaseBoth(local, shared);
            }
            catch (error) {
                local?.release();
                throw scope.aborted ? scope.reason : error;
            }
        },
        remove(member) {
            lifetimes.get(member)?.abort(new ServiceError('DISPOSED', 'Service binding was disposed'));
            lifetimes.delete(member);
            for (const gate of owners.get(member)?.values() ?? [])
                gate.dispose();
            owners.delete(member);
        },
        dispose() {
            for (const controller of lifetimes.values())
                controller.abort(new ServiceError('DISPOSED', 'Service router was disposed'));
            for (const contracts of owners.values())
                for (const gate of contracts.values())
                    gate.dispose();
            total.dispose();
            owners.clear();
            lifetimes.clear();
        },
    };
}
//# sourceMappingURL=service-event-admission.js.map