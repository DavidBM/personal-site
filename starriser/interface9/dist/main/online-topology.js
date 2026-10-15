import { createOnlineMap } from './online-map.js';
/** One-shot compatibility helper. Live App retains createOnlineMap for the
 * entire connection so additional pages never renumber existing fleet nodes. */
export function createOnlineTopology(view) {
    const map = createOnlineMap();
    return { worldId: view.worldId, revision: view.revision, ops: map.replace(view), node: map.node };
}
//# sourceMappingURL=online-topology.js.map