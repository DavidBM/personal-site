export function isProjectionQuery(query) {
    return query.type === 'selectedJourney' || query.type === 'remoteBattle' || query.type === 'remoteJourney' || query.type === 'remotePlanetClock' || query.type === 'remoteMovementContext' || query.type === 'previewRemoteMove' || query.type === 'clearRemoteMove' || query.type === 'projectionDiagnostics' || query.type === 'projectionStatus' || query.type === 'projectionBarrier' || query.type === 'remoteFleet'
        || query.type === 'focusRemoteFleet' || query.type === 'followRemoteFleet';
}
//# sourceMappingURL=protocol.js.map