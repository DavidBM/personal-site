// Type-checked against the schema without loading the protobuf runtime in feature workers.
export const GameplayOperation = { UNSPECIFIED: 0, JOURNEY: 1, ENCOUNTER: 2, BATTLE: 3, INDUSTRY: 4, DEVELOPMENT: 5, FLEET_STATUS: 6, SURVEY: 7, INCOMING: 8, ROUTE_PREVIEW: 9, TESTER_FLEET: 10, JOURNEY_PATH: 11, TESTER_OWNERS: 12 };
export function gameplayPayload(result, signal, limit) {
    signal.throwIfAborted();
    if (result.payload.byteLength > limit)
        throw new Error(`Gameplay response exceeds ${limit} bytes`);
    return result.payload;
}
//# sourceMappingURL=gameplay.js.map