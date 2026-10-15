export function createPlanetSceneController(ports) {
    let generation = 0;
    return { set(target, open = !!target) {
            const current = ++generation;
            ports.show(open);
            if (!open || !target?.catalogId || !ports.live())
                return;
            void ports.prepare(target.systemId).then(() => {
                if (current === generation && ports.live())
                    ports.focus(target);
            }).catch(error => { if (current === generation)
                ports.error(error); });
        } };
}
//# sourceMappingURL=scene.js.map