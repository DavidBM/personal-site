import { MAX_MESSAGE_BYTES } from './limits.js';
export const SESSION_LIMITS = {
    readBytes: MAX_MESSAGE_BYTES * 4, readFrames: 16, sendBytes: 1024 * 1024, sendFrames: 32,
    pendingProjectionBytes: 1024 * 1024, pendingProjectionBatches: 64,
    pendingCommands: 128, handshakeMs: 5000, receiptMs: 10000, snapshotMs: 5000,
};
//# sourceMappingURL=session-contracts.js.map