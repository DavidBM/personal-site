import { create } from '@bufbuild/protobuf';
import { AdmissionGrantSchema, AuthorityScopeSchema } from '../generated/galaxy/v1/galaxy_pb.js';
import { opaqueIdAt, opaqueIdBytes } from '../../contracts/opaque-id.js';
/** Scoped renewal never replaces command keys. An unavailable reply only retries
 * this unresolved request; it cannot populate the usable grant cache. */
export function createViewAdmissions(options) {
    const grants = new Map(), pending = new Map();
    let next = 0n, closed = false;
    function finish(value, error, result) {
        pending.delete(value.request);
        clearTimeout(value.deadline);
        clearTimeout(value.retry);
        if (error)
            value.reject(error);
        else
            value.resolve(result);
    }
    async function transmit(value) {
        if (closed || pending.get(value.request) !== value)
            return;
        try {
            await options.send({ $typeName: 'galaxy.v1.RenewAdmission', systemId: opaqueIdBytes(value.system), receiptHomeShardId: new Uint8Array(), requestId: value.request });
        }
        catch (error) {
            if (pending.get(value.request) === value)
                finish(value, error instanceof Error ? error : new Error(String(error)));
        }
    }
    function ensure(system) {
        if (closed)
            return Promise.reject(new Error('Admission owner closed'));
        const cached = grants.get(system);
        if (cached && cached.grant.notAfterServerMs > options.serverNow() + 30000n)
            return Promise.resolve(cached);
        for (const value of pending.values())
            if (value.system === system)
                return value.promise;
        if (pending.size === 4)
            return Promise.reject(new Error('Admission request capacity'));
        if (next === 2n ** 64n - 1n)
            return Promise.reject(new Error('Admission request identity exhausted'));
        let resolve, reject;
        const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
        const value = { system, request: ++next, resolve, reject, promise, deadline: setTimeout(() => finish(value, new Error('Scoped admission unavailable; retry later')), 5000) };
        pending.set(value.request, value);
        void transmit(value);
        return promise;
    }
    function receive(reply) {
        const value = pending.get(reply.requestId);
        if (!value)
            return;
        if (!reply.grant || !reply.scope) {
            clearTimeout(value.retry);
            value.retry = setTimeout(() => { void transmit(value); }, Math.max(100, reply.retryAfterMs));
            return;
        }
        const scope = reply.scope;
        if (opaqueIdAt(scope.worldId) !== options.world || opaqueIdAt(scope.systemId) !== value.system || opaqueIdAt(scope.shardId) !== opaqueIdAt(reply.grant.receiptHomeShardId))
            throw new Error('Scoped admission identity mismatch');
        // Explicit byte copies own only these fields, not the received frame.
        const result = { scope: create(AuthorityScopeSchema, { worldId: new Uint8Array(scope.worldId), shardId: new Uint8Array(scope.shardId), systemId: new Uint8Array(scope.systemId), ownerEpoch: scope.ownerEpoch, recoveryGeneration: scope.recoveryGeneration }), grant: create(AdmissionGrantSchema, { receiptHomeShardId: new Uint8Array(reply.grant.receiptHomeShardId), generation: reply.grant.generation, notAfterServerMs: reply.grant.notAfterServerMs, token: new Uint8Array(reply.grant.token) }) };
        if (grants.size === 32)
            grants.delete(grants.keys().next().value);
        grants.set(value.system, result);
        finish(value, undefined, result);
    }
    function invalidate() { grants.clear(); for (const value of [...pending.values()])
        finish(value, new Error('Admission visibility epoch changed')); }
    function expired(key) {
        for (const [system, value] of grants)
            if (value.grant.generation === key.admissionGeneration && opaqueIdAt(value.grant.receiptHomeShardId) === opaqueIdAt(key.receiptHomeShardId))
                grants.delete(system);
    }
    return { ensure, receive, invalidate, expired, dispose() { closed = true; invalidate(); }, inspect: () => ({ cached: grants.size, pending: pending.size }) };
}
//# sourceMappingURL=admissions.js.map