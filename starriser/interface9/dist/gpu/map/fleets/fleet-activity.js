/** Report accepted guidance and sampled GPU state without inventing completion. */
export function routeActivity(route, sample) {
    const action = routeAction(route);
    if (route.status !== 'ready')
        return { action, micro: route.status === 'pending' ? 'Preparing route' : route.status };
    if (!sample || sample.token !== route.token)
        return { action, micro: 'Route ready · awaiting fresh GPU observation' };
    const phase = sample.departure === 2 ? (sample.speed > .0001 ? 'Travelling' : 'Turning / holding')
        : sample.departure < .5 ? `Aligning · ${Math.round(sample.quorum * 100)}% ready` : 'Travelling';
    return { action, micro: `${phase} · pace ${sample.speed.toFixed(3)} lab/s`, sampledAt: sample.observedMs };
}
export function automaticActivity(phase) {
    const labels = { inbound: 'Inbound warp command', outbound: 'Outbound warp command', orbit: 'Approach / orbit guidance', stage: 'Departure staging', hide: 'Outside visible system', pending: 'Awaiting visual command' };
    return { action: phase === 'orbit' ? 'Go to assigned planet' : phase === 'stage' ? 'Leave system' : 'System transfer', micro: labels[phase] ?? phase };
}
function routeAction(route) {
    const points = route.acceptedIntent?.waypoints ?? route.waypoints;
    return route.activeClosed ? 'Patrol' : (points?.length ?? 0) > 1 ? 'Waypoint route' : 'Move to coordinate';
}
//# sourceMappingURL=fleet-activity.js.map