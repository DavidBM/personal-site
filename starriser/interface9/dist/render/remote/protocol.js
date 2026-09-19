export function isProjectionQuery(query) {
    return query.type === 'projectionDiagnostics' || query.type === 'projectionStatus' || query.type === 'projectionBarrier' || query.type === 'remoteFleet'
        || query.type === 'focusRemoteFleet' || query.type === 'followRemoteFleet';
}
//# sourceMappingURL=protocol.js.map