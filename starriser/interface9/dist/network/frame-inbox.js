/** WebSocket lacks read backpressure. Bound retained frames, then close rather
 * than build a second unbounded browser-to-worker queue. */
export function createFrameInbox(maxBytes, maxFrames) {
    let frames = [];
    let head = 0;
    let bytes = 0;
    let closed = false;
    let failure;
    let waiter;
    return {
        push(frame) {
            if (closed)
                return;
            if (waiter) {
                const pending = waiter;
                waiter = undefined;
                pending.resolve(frame);
                return;
            }
            if (bytes + frame.byteLength > maxBytes || frames.length - head >= maxFrames)
                throw new Error('Network receive queue budget exceeded');
            frames.push(frame);
            bytes += frame.byteLength;
        },
        receive() {
            if (waiter)
                return Promise.reject(new Error('Concurrent transport receive is unsupported'));
            if (failure)
                return Promise.reject(failure);
            if (closed)
                return Promise.resolve(null);
            if (head < frames.length) {
                const frame = frames[head];
                frames[head++] = undefined;
                bytes -= frame.byteLength;
                if (head >= maxFrames || head === frames.length) {
                    frames = frames.slice(head);
                    head = 0;
                }
                return Promise.resolve(frame);
            }
            return new Promise((resolve, reject) => { waiter = { resolve, reject }; });
        },
        close(error) {
            if (closed)
                return;
            closed = true;
            failure = error;
            frames = [];
            head = 0;
            bytes = 0;
            if (error)
                waiter?.reject(error);
            else
                waiter?.resolve(null);
            waiter = undefined;
        },
    };
}
//# sourceMappingURL=frame-inbox.js.map