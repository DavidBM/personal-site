export const STRATEGIC_PAGE_SIZE = 32;
export function compareStrategic(a, b) {
    if (a.connectionGeneration !== b.connectionGeneration)
        return Math.sign(a.connectionGeneration - b.connectionGeneration);
    if (a.interestGeneration !== b.interestGeneration)
        return a.interestGeneration < b.interestGeneration ? -1 : 1;
    return a.sequence === b.sequence ? 0 : a.sequence < b.sequence ? -1 : 1;
}
export function strategicDisposed(error) {
    if (!error || typeof error !== 'object' || !('code' in error))
        return false;
    return error.code === 'DISPOSED' || error.code === 'CANCELED';
}
//# sourceMappingURL=strategic-contracts.js.map