/** One cancellable macrotask, created lazily; idle buses do not poll. */
export function createBusWakeup(run) {
    let channel = null;
    let pending = false;
    let disposed = false;
    return {
        schedule() {
            if (pending || disposed)
                return;
            if (!channel) {
                channel = new MessageChannel();
                channel.port1.onmessage = () => {
                    if (!pending || disposed)
                        return;
                    pending = false;
                    run();
                };
                channel.port1.start();
            }
            pending = true;
            channel.port2.postMessage(null);
        },
        cancel() { pending = false; },
        dispose() {
            disposed = true;
            pending = false;
            channel?.port1.close();
            channel?.port2.close();
            channel = null;
        },
    };
}
//# sourceMappingURL=bus-wakeup.js.map