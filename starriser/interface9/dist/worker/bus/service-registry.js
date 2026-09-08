import { ServiceError } from './service-types.js';
const join = (a, b) => `${a.length}:${a}${b}`;
export const memberKey = join;
export function createServiceRegistry() {
    const members = new Map(), edges = new Map();
    let incarnation = 0;
    const key = (member, contract) => join(member.declaration.identity.scope, contract);
    function edge(member, contract) {
        const value = edges.get(key(member, contract));
        if (!value)
            throw new ServiceError('NOT_READY', 'Contract is not registered');
        return value;
    }
    function get(host, binding) {
        const value = members.get(memberKey(host, binding));
        if (!value)
            throw new ServiceError('DISPOSED', 'Service binding is unavailable');
        return value;
    }
    function add(host, declaration) {
        if (members.size >= 256)
            throw new ServiceError('OVERLOADED', 'Service registry capacity exceeded');
        const value = { key: memberKey(host, declaration.id), incarnation: ++incarnation, host, declaration, ready: false };
        if (members.has(value.key))
            throw new ServiceError('OWNERSHIP', 'Binding is already registered');
        const declared = new Map();
        for (const contract of [...declaration.provides, ...declaration.consumes]) {
            const current = declared.get(contract.id) ?? edges.get(key(value, contract.id))?.metadata;
            if (current && !sameContract(current, contract))
                throw new ServiceError('OWNERSHIP', 'Conflicting contract metadata');
            declared.set(contract.id, contract);
        }
        members.set(value.key, value);
        install(value, 'providers', declaration.provides);
        install(value, 'consumers', declaration.consumes);
    }
    function install(member, direction, contracts) {
        for (const contract of contracts) {
            const id = key(member, contract.id);
            let entry = edges.get(id);
            if (!entry) {
                entry = { metadata: contract, providers: new Set(), consumers: new Set() };
                edges.set(id, entry);
            }
            entry[direction].add(member);
        }
    }
    function remove(member) {
        const contracts = new Set([...member.declaration.provides, ...member.declaration.consumes].map(contract => contract.id));
        for (const contract of contracts) {
            const id = key(member, contract), entry = edges.get(id);
            entry.providers.delete(member);
            entry.consumers.delete(member);
            if (!entry.providers.size && !entry.consumers.size)
                edges.delete(id);
        }
        members.delete(member.key);
    }
    function ready(member) {
        for (const contract of [...member.declaration.provides, ...member.declaration.consumes]) {
            const entry = edge(member, contract.id);
            if ((contract.kind === 'command' || contract.kind === 'query') && entry.providers.size !== 1) {
                throw new ServiceError('OWNERSHIP', `Expected one owner for ${contract.id}; found ${entry.providers.size}`);
            }
            if (contract.kind === 'stream' && entry.consumers.size !== 1)
                throw new ServiceError('OWNERSHIP', 'Direct stream requires one consumer');
        }
        member.ready = true;
    }
    return { members, edges, get, add, remove, ready, edge };
}
function sameContract(a, b) {
    return a.kind === b.kind && a.ordered === b.ordered && a.capacity === b.capacity && a.priority === b.priority;
}
//# sourceMappingURL=service-registry.js.map