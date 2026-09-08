import { createServiceRegistry, memberKey } from './service-registry.js';
import { createServiceObservation } from './service-observation.js';
import { createServiceAdmission, eventQueueLifetime, serviceQueueClock } from './service-event-admission.js';
import { ServiceError } from './service-types.js';
export function serviceFailure(error) {
    return { code: error instanceof ServiceError ? error.code : 'TRANSPORT',
        message: (error instanceof Error ? error.message : String(error)).slice(0, 512) };
}
/** One broker-owned directory. Accepted owner work outlives a caller's wait. */
export function createServiceRouter(send) {
    const registry = createServiceRegistry(), observation = createServiceObservation();
    const pending = new Map(), admission = createServiceAdmission();
    const streams = new Map();
    let nextRoute = 0;
    const result = (host, packet, value, failure) => send(host, { type: 'result', binding: packet.binding, request: packet.request, value, failure });
    async function receive(host, packet, priority = 1) {
        try {
            await dispatch(host, packet, priority);
        }
        catch (error) {
            reject(host, packet, serviceFailure(error));
        }
    }
    function reject(host, packet, failure) {
        observation.record(packet.contract ?? 'registry', 'broker', 'failure', undefined, packet.context);
        if (packet.request !== undefined)
            result(host, packet, undefined, failure);
        else
            send(host, { type: 'result', binding: packet.binding, failure });
    }
    function dispatch(host, packet, priority) {
        switch (packet.type) {
            case 'register':
                registry.add(host, packet.declaration);
                result(host, packet);
                return;
            case 'inspect':
                result(host, packet, snapshot());
                return;
            case 'trace':
                observation.configure(packet.value);
                result(host, packet);
                return;
            case 'remove': {
                const member = registry.members.get(memberKey(host, packet.binding));
                if (member)
                    remove(member);
                result(host, packet);
                return;
            }
            default: return dispatchMember(registry.get(host, packet.binding), packet, priority);
        }
    }
    function dispatchMember(member, packet, priority) {
        switch (packet.type) {
            case 'ready':
                registry.ready(member);
                result(member.host, packet);
                return;
            case 'request': return request(member, packet, priority);
            case 'publish': return publish(member, packet, priority);
            case 'reply':
                reply(member, packet);
                return;
            case 'stream':
                registerStream(member, packet);
                return;
            default: throw new ServiceError('TRANSPORT', 'Unexpected service packet');
        }
    }
    function requireReady(member) {
        if (!member.ready)
            throw new ServiceError('NOT_READY', 'Service binding is not ready');
    }
    async function request(source, packet, priority) {
        requireReady(source);
        const edge = registry.edge(source, packet.contract);
        if (!edge.consumers.has(source) || !['command', 'query'].includes(edge.metadata.kind))
            throw new ServiceError('OWNERSHIP', 'Undeclared request');
        if (edge.providers.size !== 1)
            throw new ServiceError('OWNERSHIP', 'Command requires one owner');
        const owner = edge.providers.values().next().value;
        requireReady(owner);
        const route = admit(source, owner, packet);
        try {
            await deliver(source, owner, { ...packet, type: 'invoke', binding: owner.declaration.id, route }, priority);
        }
        catch (error) {
            release(route);
            throw error;
        }
    }
    function deliver(source, target, packet, priority, signal) {
        observation.record(packet.contract, source.declaration.identity.service, packet.type, packet.bytes, packet.context);
        return send(target.host, packet, priority, packet.stream ? `${source.incarnation}:${target.incarnation}:${packet.stream}` : undefined, signal);
    }
    function admit(source, owner, packet) {
        const capacity = registry.edge(owner, packet.contract).metadata.capacity;
        return retain(source, owner, packet, admission.tryAdmit(owner, packet.contract, capacity));
    }
    function retain(source, owner, packet, release) {
        const route = ++nextRoute;
        pending.set(route, { source, owner, request: packet.request, contract: packet.contract, context: packet.context, release });
        return route;
    }
    async function publish(source, packet, priority) {
        requireReady(source);
        const edge = registry.edge(source, packet.contract);
        if (!edge.providers.has(source) || edge.metadata.kind !== 'event')
            throw new ServiceError('OWNERSHIP', 'Undeclared publication');
        const scope = eventQueueLifetime([admission.lifetime(source)], packet.expiresAt);
        const targets = [...edge.consumers].filter(target => target.ready).sort((a, b) => a.key.localeCompare(b.key));
        try {
            for (const target of targets) {
                await publishTarget(source, target, packet, priority, edge.metadata.capacity, scope.signal);
            }
            result(source.host, packet);
        }
        catch (error) {
            if (scope.signal.aborted)
                throw scope.signal.reason;
            throw error;
        }
        finally {
            scope.close();
        }
    }
    async function publishTarget(source, target, packet, priority, maximum, signal) {
        if (registry.members.get(target.key) !== target)
            throw new ServiceError('DISPOSED', 'Service publication recipient was replaced');
        const free = await admission.admit(target, packet.contract, maximum, signal);
        if (registry.members.get(source.key) !== source || registry.members.get(target.key) !== target) {
            free();
            throw new ServiceError('DISPOSED', 'Service publication recipient was replaced');
        }
        if (packet.expiresAt !== undefined && serviceQueueClock() >= packet.expiresAt) {
            free();
            throw new ServiceError('EXPIRED', 'Disposable service event expired');
        }
        const route = retain(source, target, { ...packet, request: undefined }, free);
        try {
            await deliver(source, target, { ...packet, type: 'event', binding: target.declaration.id, route }, priority, signal);
        }
        catch (error) {
            release(route);
            throw error;
        }
    }
    function release(route) {
        const value = pending.get(route);
        if (!value)
            return;
        pending.delete(route);
        value.release();
        return value;
    }
    function reply(owner, packet) {
        const value = pending.get(packet.route);
        if (!value || value.owner !== owner)
            return;
        release(packet.route);
        if (packet.failure)
            observation.record(value.contract, owner.declaration.identity.service, 'failure', undefined, value.context);
        if (registry.members.get(value.source.key) !== value.source)
            return;
        if (value.request === undefined && !packet.failure)
            return;
        result(value.source.host, { type: 'result', binding: value.source.declaration.id, request: value.request }, packet.value, packet.failure);
    }
    function remove(member) {
        admission.remove(member);
        registry.remove(member);
        for (const [route, value] of pending) {
            // A vanished caller does not release the owner's admitted work/capacity.
            if (value.owner !== member)
                continue;
            release(route);
            if (registry.members.get(value.source.key) === value.source)
                result(value.source.host, { type: 'result', binding: value.source.declaration.id, request: value.request }, undefined, { code: 'DISPOSED', message: 'Service owner was disposed; accepted outcome may be unknown' });
        }
        for (const [key, value] of streams)
            if (value.binding === member.key)
                streams.delete(key);
    }
    function registerStream(member, packet) {
        requireReady(member);
        const edge = registry.edge(member, packet.contract);
        if (edge.metadata.kind !== 'stream' || edge.consumers.size !== 1)
            throw new ServiceError('OWNERSHIP', 'Direct stream requires one consumer');
        const value = packet.value;
        const key = `${member.key}:${value.id}`;
        if (value.disconnect) {
            streams.delete(key);
            return;
        }
        if (streams.size >= 256)
            throw new ServiceError('OVERLOADED', 'Direct stream registry is full');
        streams.set(key, { ...value, binding: member.key, contract: packet.contract });
    }
    function snapshot() {
        return { declared: Array.from(registry.members.values(), value => ({ ...value.declaration, binding: value.key })),
            connected: Array.from(registry.members.values(), value => ({ binding: value.key, declarationId: value.declaration.id,
                incarnation: value.incarnation, host: value.host, ready: value.ready })),
            ...observation.snapshot(), streams: Array.from(streams.values()), pending: pending.size };
    }
    return { receive, reject, snapshot,
        disconnect(host) { for (const member of registry.members.values())
            if (member.host === host)
                remove(member); },
        dispose() { admission.dispose(); registry.members.clear(); registry.edges.clear(); pending.clear(); streams.clear(); observation.clear(); },
    };
}
//# sourceMappingURL=service-router.js.map