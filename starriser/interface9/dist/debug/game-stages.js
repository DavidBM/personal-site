/** Explicit dependencies supplement the bus graph; ordinary calls are not inferred. */
export const GAME_STAGES = [
    { id: 'ui.intent', service: 'online-ui', source: 'js/main/online-entry.ts' },
    { id: 'network.command', service: 'network', source: 'js/network/session.ts' },
    { id: 'gateway.command', service: 'gateway', source: 'crates/server/src/session/mod.rs' },
    { id: 'system.command', service: 'system', source: 'crates/server/src/system/actor.rs' },
    { id: 'storage.queue', service: 'storage', source: 'crates/server/src/executor/worker.rs' },
    { id: 'storage.commit', service: 'storage', source: 'crates/server/src/executor/decisions.rs' },
    { id: 'peer.forward', service: 'placement', source: 'crates/server/src/placement/peer/home.rs' },
    { id: 'network.projection', service: 'network', source: 'js/network/session.ts' },
    { id: 'render.apply', service: 'render', source: 'js/render/remote/runtime-projection.ts' },
];
export const GAME_DEPENDENCIES = [
    { from: 'ui.intent', to: 'network.command', contract: 'shipOrders.move' },
    { from: 'network.command', to: 'gateway.command', contract: 'galaxy.v1.ClientMessage' },
    { from: 'gateway.command', to: 'system.command' },
    { from: 'gateway.command', to: 'peer.forward' },
    { from: 'peer.forward', to: 'gateway.command', contract: 'galaxy.v1.HomeRequest' },
    { from: 'system.command', to: 'storage.queue' },
    { from: 'storage.queue', to: 'storage.commit' },
    { from: 'system.command', to: 'network.projection', contract: 'galaxy.v1.SystemDelta' },
    { from: 'network.projection', to: 'render.apply', contract: 'shipProjection.batches' },
];
//# sourceMappingURL=game-stages.js.map