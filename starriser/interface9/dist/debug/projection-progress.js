export function progressCursor(value) {
    if (!value)
        return;
    return { ...value.scope, subscriptionId: value.subscriptionId,
        ownerEpoch: String(value.scope.ownerEpoch), recoveryGeneration: String(value.scope.recoveryGeneration),
        streamGeneration: String(value.streamGeneration), sequence: String(value.sequence), systemRevision: String(value.systemRevision) };
}
//# sourceMappingURL=projection-progress.js.map