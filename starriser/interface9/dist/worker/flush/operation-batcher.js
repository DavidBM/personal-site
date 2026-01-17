// OperationBatcher is a utility for batching operations and flushing them via a callback.
export class OperationBatcher {
    constructor({ batchSize = 100, onBatch } = {}) {
        this.batchSize = batchSize;
        this.onBatch = onBatch ?? null;
        this._batch = [];
    }
    /**
     * Add an operation to the batch. Flushes if batchSize reached.
     */
    add(op) {
        this._batch.push(op);
        if (this._batch.length >= this.batchSize) {
            this.flush();
        }
    }
    /**
     * Flush the current batch (if any) to the callback.
     */
    flush(force = false) {
        if (this._batch.length > 0 &&
            (force || this._batch.length >= this.batchSize)) {
            this.onBatch?.(this._batch.splice(0, this._batch.length));
        }
    }
    /**
     * Get the current in-memory batch (for possible inspection).
     */
    getBatch() {
        return this._batch;
    }
    /**
     * Remove all items from the batch (no callback).
     */
    reset() {
        this._batch.length = 0;
    }
}
export default OperationBatcher;
//# sourceMappingURL=operation-batcher.js.map