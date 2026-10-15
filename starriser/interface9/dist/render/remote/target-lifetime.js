/** Retain camera intent, never GPU objects, across an explicit source refresh.
 * Permission, selector and connection fences permanently revoke old leases. */
export function createRemoteTargetLifetime(lookup) {
    let epoch = 0, recovering = false;
    return {
        reset(preserve) { if (!preserve)
            epoch++; recovering = preserve; },
        ready() { recovering = false; },
        waiting: () => recovering,
        acquire(id) {
            if (!lookup(id))
                return;
            const owned = epoch;
            return {
                current: () => owned === epoch && !recovering ? lookup(id) : undefined,
                waiting: () => owned === epoch && recovering,
            };
        },
    };
}
//# sourceMappingURL=target-lifetime.js.map