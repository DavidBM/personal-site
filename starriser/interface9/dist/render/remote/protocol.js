export function isProjectionQuery(query) {
    return query.type === 'projectionDiagnostics' || query.type === 'projectionStatus' || query.type === 'projectionBarrier' || query.type === 'remoteShip'
        || query.type === 'focusRemoteShip' || query.type === 'followRemoteShip';
}
//# sourceMappingURL=protocol.js.map