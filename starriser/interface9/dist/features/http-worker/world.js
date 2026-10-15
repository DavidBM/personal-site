import { createWorldContentLoader } from '../../lib/world-content/loader.js';
import { createIndexedContentStore } from '../../lib/world-content/indexed-cache.js';
const owners = new Map();
/** Kept below the shared eight-command credit; one loader has one page lane. */
export async function worldRequest(args, signal) {
    const [id, operation, value] = args;
    if (operation === 'forget') {
        const cache = createIndexedContentStore({ scope: value });
        try {
            await cache.clear();
        }
        finally {
            cache.close();
        }
        return;
    }
    if (operation === 'open') {
        if (owners.has(id) || owners.size >= 4)
            throw new Error('World cache owner capacity');
        const options = value;
        owners.set(id, createWorldContentLoader({ ...options, persistence: options.persistenceScope ? createIndexedContentStore({ scope: options.persistenceScope }) : undefined }));
        return;
    }
    const owner = owners.get(id);
    if (!owner) {
        if (operation === 'dispose')
            return;
        throw new Error('World cache owner expired');
    }
    return operate(id, owner, operation, value, signal);
}
async function operate(id, owner, op, value, signal) {
    switch (op) {
        // load() returns cache-owned memory. Transfer exactly one owned copy, never detach a cache.
        case 'load': {
            const bytes = await owner.load(value, { signal });
            return bytes.byteLength >= 1024 ? bytes.slice() : bytes;
        }
        case 'system': return owner.loadSystem(value, { signal });
        case 'atlas': return owner.loadAtlas(value, { signal });
        case 'manifest': return owner.loadManifest(signal);
        case 'reconnect':
            owner.reconnect(value);
            return;
        case 'abandon':
            owner.abandon(value);
            return;
        case 'dispose':
            owners.delete(id);
            await owner.dispose(value === true);
            return;
        default: throw new Error('Unknown world content command');
    }
}
export async function disposeWorld(id, forget) {
    const owner = owners.get(id);
    owners.delete(id);
    await owner?.dispose(forget);
}
//# sourceMappingURL=world.js.map