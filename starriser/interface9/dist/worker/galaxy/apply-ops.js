/**
 * Single typed dispatcher for all OP mirrors (main / business / fleets).
 * Keeps dispatch logic in one place so new OP types cannot drift across worlds.
 */
export function applyOps(ops, handlers) {
    if (!Array.isArray(ops))
        return;
    for (const op of ops) {
        // Op is the discriminated union of the same typed handler keys. TypeScript
        // loses that key/payload correlation when indexing a union of callbacks.
        handlers[op.type]?.(op.payload);
    }
}
//# sourceMappingURL=apply-ops.js.map