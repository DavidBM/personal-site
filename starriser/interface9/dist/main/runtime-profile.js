const moduleUrl = (path) => new URL(path, import.meta.url).href;
const shared = {
    render: moduleUrl('../render/worker-entry.js'),
    preview: moduleUrl('../features/fleets/domain/worker-entry.js'),
};
function worker(id, path) { return Object.freeze({ id, module: moduleUrl(path) }); }
export const BACKEND_RUNTIME = Object.freeze({
    id: 'backend', authority: 'online',
    workers: Object.freeze({ ...shared,
        startup: Object.freeze([worker('business', '../worker/business/online-business-worker.js')]),
        session: moduleUrl('../network/managed-worker.bundle.js'),
        features: moduleUrl('../features/http-worker/worker-entry.js'),
    }),
});
/** The mock is the existing in-memory generation/fleet sandbox. It does not
 * emulate server persistence, accounts, industry, or private player views. */
export const MOCK_RUNTIME = Object.freeze({
    id: 'mock', authority: 'offline',
    workers: Object.freeze({ ...shared, startup: Object.freeze([
            worker('galaxy', '../worker/galaxy/galaxy-worker.js'),
            worker('business', '../worker/business/business-worker.js'),
            worker('fleets', '../worker/fleets/fleets-worker.js'),
        ]) }),
});
export function requestedRuntime(search) {
    const params = new URLSearchParams(search), value = params.get('runtime');
    if (value !== null && value !== 'backend' && value !== 'mock')
        throw new Error('Unknown Galaxy runtime');
    if (value)
        return value;
    return params.get('offline') === '1' ? 'mock' : 'auto';
}
export function runtimeForAuthority(authority) {
    return authority === 'online' ? BACKEND_RUNTIME : MOCK_RUNTIME;
}
/** Take an immutable startup snapshot, including caller-supplied implementations.
 * A running App must never silently change authority or its worker modules. */
export function snapshotRuntime(profile) {
    if (profile.authority === 'online' && !profile.workers.session)
        throw new Error('Backend runtime needs a session worker');
    const ids = profile.workers.startup.map(worker => worker.id);
    if (new Set(ids).size !== ids.length)
        throw new Error('Duplicate runtime worker identity');
    return Object.freeze({ ...profile, workers: Object.freeze({ ...profile.workers,
            startup: Object.freeze(profile.workers.startup.map(worker => Object.freeze({ ...worker }))),
        }) });
}
//# sourceMappingURL=runtime-profile.js.map