export function validStreamOptions(generation, maxBytes, maxBatches) {
    for (const value of [generation, maxBytes, maxBatches]) {
        if (!Number.isSafeInteger(value) || value < 1)
            throw new RangeError("Stream budgets and generation must be positive safe integers");
    }
}
//# sourceMappingURL=transfer-port.js.map