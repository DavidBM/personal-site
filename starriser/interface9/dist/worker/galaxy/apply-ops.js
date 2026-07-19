/**
 * Single switch for all OP mirrors (main / business / fleets).
 * Keeps dispatch logic in one place so new OP types cannot drift across worlds.
 */
export function applyOps(ops, handlers) {
    if (!Array.isArray(ops))
        return;
    for (const op of ops) {
        switch (op.type) {
            case "addCluster":
                handlers.addCluster?.(op.payload);
                break;
            case "removeCluster":
                handlers.removeCluster?.(op.payload);
                break;
            case "addSolarSystem":
                handlers.addSolarSystem?.(op.payload);
                break;
            case "removeSolarSystem":
                handlers.removeSolarSystem?.(op.payload);
                break;
            case "connectSolarSystems":
                handlers.connectSolarSystems?.(op.payload);
                break;
            case "connectClusters":
                handlers.connectClusters?.(op.payload);
                break;
            case "removeConnection":
                handlers.removeConnection?.(op.payload);
                break;
        }
    }
}
//# sourceMappingURL=apply-ops.js.map