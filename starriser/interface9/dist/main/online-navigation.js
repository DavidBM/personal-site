/** Navigation waits for the scene, then the render worker resolves the persistent
 * ID and takes follow ownership atomically. Main never retains a reusable slot. */
export async function followOnlineShip(options, shipId) {
    const { renderer, session, node } = options;
    function arrived() {
        const state = renderer.snapshot();
        return !!state && !state.director.playing && state.sceneNode?.clusterId === node.clusterId && state.sceneNode?.solarSystemId === node.solarSystemId;
    }
    // The director takes camera ownership itself. Clearing an idle follow would
    // create a follow-exit animation that could outlive the director's arrival.
    if (!arrived())
        options.navigate();
    const deadline = performance.now() + 5000;
    while (!arrived()) {
        if (!options.current())
            throw new Error('Online navigation was superseded');
        if (performance.now() >= deadline)
            throw new Error('The ship system scene did not become ready');
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (!options.current())
        throw new Error('Online navigation was superseded');
    const required = session.received();
    if (!required)
        throw new Error('Ship projection is not ready');
    await renderer.query({ type: 'followRemoteShip', id: shipId, required });
}
//# sourceMappingURL=online-navigation.js.map