import { matchesFleetMoveScene } from './fleet-move-input.js';
export function planetOrbitMenu(snapshot, target) {
    if (target.kind !== 'body' || !snapshot.selectedFleetId || !snapshot.sceneNode || snapshot.systemId == null)
        return null;
    const body = snapshot.bodies.find(body => body.index === target.index && body.catalogId === target.catalogId);
    if (!body || body.isSun)
        return null;
    return { kind: 'planet', name: body.name, order: { id: snapshot.selectedFleetId,
            node: { ...snapshot.sceneNode }, systemId: snapshot.systemId, bodyIndex: body.index, catalogId: body.catalogId } };
}
export function matchesPlanetOrbit(snapshot, order) {
    if (!matchesFleetMoveScene(snapshot, order) || snapshot?.selectedFleetId !== order.id)
        return false;
    return snapshot.bodies.some(body => body.index === order.bodyIndex && body.catalogId === order.catalogId && !body.isSun);
}
//# sourceMappingURL=fleet-orbit-input.js.map