import { createBattleVisuals } from './battle-visuals.js';
/** Each accepted battle owns its own visual lifetime. Tactical selection never
 * replaces another battle or clears the scene. Fleet lookups remain constant-time. */
export function createBattleScenes(existing, release, finished, clock) {
    const scenes = new Map(), fleets = new Map();
    function forget(id, scene) {
        if (scenes.get(id) !== scene)
            return;
        scenes.delete(id);
        for (const [fleet, owner] of fleets)
            if (owner === scene)
                fleets.delete(fleet);
    }
    function remove(id) { const scene = scenes.get(id); if (!scene)
        return; const ids = scene.ids(); scene.clear(); forget(id, scene); finished(ids); }
    function clear() { for (const scene of scenes.values())
        scene.clear(); scenes.clear(); fleets.clear(); }
    function claim(fleet, scene) {
        const prior = fleets.get(fleet);
        if (prior && prior !== scene)
            for (const [key, value] of scenes)
                if (value === prior) {
                    remove(key);
                    break;
                }
        fleets.set(fleet, scene);
    }
    function set(page, id) {
        if (!page) {
            if (id)
                remove(id);
            else
                clear();
            return;
        }
        let scene = scenes.get(page.battleId);
        if (!scene) {
            if (scenes.size >= 64)
                throw new Error('Scene battle capacity reached');
            scene = createBattleVisuals(existing, release, ids => { forget(page.battleId, scene); finished(ids); }, clock);
            scenes.set(page.battleId, scene);
        }
        for (const [fleet] of page.visuals ?? [])
            claim(fleet, scene);
        scene.set(page);
    }
    return { set, clear, ids: () => [...fleets.keys()], sync(node, now) { for (const scene of scenes.values())
            scene.sync(node, now); },
        path: (fleet, path) => fleets.get(fleet.id)?.path(fleet, path) ?? path,
        protects: (id) => fleets.get(id)?.protects(id) ?? false,
        visual: (id) => fleets.get(id)?.visual(id),
        handoff: (id, v) => fleets.get(id)?.handoff(id, v) ?? false,
        restore: (id) => fleets.get(id)?.restore(id),
        *entries() { for (const scene of scenes.values())
            yield* scene.entries(); }, };
}
//# sourceMappingURL=battle-scenes.js.map